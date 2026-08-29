// ===================================================
// RadioMap – Modo Carrera (etapa 1: práctica)
// Simulación local, sin Socket.IO.
// Futuro: grupal / privada sincronizan snapshot() por socket.
// ===================================================
(function (global) {
    "use strict";

    var DIST_MAX_KM = 5;
    var SENSACION = 2.2;
    var VMAX_KMH = 140;
    var ACEL = 16;
    var FRENO = 32;
    var COAST = 4.2;
    var CURVA_U_KMH = 15;
    var CURVA_90_KMH = 40;
    var CURVA_135_KMH = 60;
    var AVISO_CURVA_M = 260;
    var ZONA_CURVA_M = 9;
    var GIF_EXPLOSION = "img/explosion.gif";
    var GIF_MECANICO = "img/mecanico.gif";
    var CHOQUES_MAX = 3;
    var CHOQUE_FRENO_S = 1;
    var CHOQUE_EXPLOSION_MS = 2000;
    var CHOQUE_MECANICO_MS = 2000;

    var api = null;
    var fase = "idle";
    var modo = "practica";
    var puntoA = null;
    var puntoB = null;
    var ruta = null;
    var rutaArmada = null;
    var rutaSeq = 0;
    var vehiculo = null;
    var controles = { acel: false, freno: false };
    var capas = { a: null, b: null, linea: null, curvas: null };
    var raf = 0;
    var ultimoTs = 0;
    var t0 = 0;
    var tFin = 0;
    var mapLock = null;
    var cuentaTimers = [];
    var velChoqueKmh = null;
    var choques = 0;
    var choqueFx = null;
    var velFrenoInicio = 0;
    var tFreno = 0;
    var avisoChoque = null;
    var rival = null;
    var carreraId = null;
    var invitacionPendiente = null;
    var ultimoEmit = 0;
    var resultadoDuelo = null;
    var ultimoRivalSnap = null;
    var linkTokenActivo = "";
    var uniendoPorLink = false;
    var TXT_WA_CARRERA = "Te desafío a una carrera en RadioMap 🏁. Tocá el link, aceptá y largamos juntos:";

    function $(id) {
        return api && api.$ ? api.$(id) : document.getElementById(id);
    }

    function estado() {
        return fase;
    }

    function activo() {
        return fase !== "idle";
    }

    function bloqueaGps() {
        return fase === "cortina" || fase === "corriendo" || fase === "meta" || fase === "choque";
    }

    function ocultaRivales() {
        return bloqueaGps();
    }

    function rivalId() {
        return rival && rival.id ? rival.id : null;
    }

    function esRival(id) {
        return !!(id && rival && rival.id === id);
    }

    function esDuelo() {
        return modo === "duelo" && !!rivalId();
    }

    function socketEmit(ev, payload, ack) {
        if (!api.socket) return;
        if (typeof ack === "function") api.socket.emit(ev, payload, ack);
        else api.socket.emit(ev, payload);
    }

    function snapshot() {
        var ll = ruta && vehiculo ? ruta.puntoEn(vehiculo.s) : null;
        return {
            modo: modo,
            fase: fase,
            s: vehiculo ? vehiculo.s : 0,
            velKmh: vehiculo ? vehiculo.velMs * 3.6 : 0,
            lat: ll ? ll[0] : null,
            lng: ll ? ll[1] : null,
            choques: choques,
            choqueFx: choqueFx,
            ts: Date.now()
        };
    }

    function metros(a, b) {
        return api.calcularDistanciaKm(a[0], a[1], b[0], b[1]) * 1000;
    }

    function anguloDiff(a, b) {
        var d = Math.abs(Number(a) - Number(b)) % 360;
        if (d > 180) d = 360 - d;
        return d;
    }

    function longitudPath(pts) {
        var d = 0;
        for (var i = 1; i < pts.length; i++) d += metros(pts[i - 1], pts[i]);
        return d;
    }

    function puntoEnPath(pts, dist) {
        var restante = dist;
        for (var i = 1; i < pts.length; i++) {
            var seg = metros(pts[i - 1], pts[i]);
            if (restante <= seg) {
                var t = seg === 0 ? 1 : restante / seg;
                return [
                    pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
                    pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t
                ];
            }
            restante -= seg;
        }
        return pts[pts.length - 1];
    }

    function rumboEnPath(pts, dist) {
        var restante = Math.max(0, dist);
        for (var i = 1; i < pts.length; i++) {
            var seg = metros(pts[i - 1], pts[i]);
            if (restante <= seg || i === pts.length - 1) {
                return api.rumboEntre(pts[i - 1], pts[i]);
            }
            restante -= seg;
        }
        return api.rumboEntre(pts[0], pts[pts.length - 1]);
    }

    function limitePorGiro(deflexion) {
        if (deflexion >= 125) return CURVA_U_KMH;
        if (deflexion >= 52) return CURVA_90_KMH;
        if (deflexion >= 28) return CURVA_135_KMH;
        return 0;
    }

    function headingEn(pts, dist, total) {
        var d0 = Math.max(0, Math.min(total - 1, dist));
        var d1 = Math.min(total, d0 + 8);
        if (d1 - d0 < 3) d0 = Math.max(0, d1 - 8);
        return api.rumboEntre(puntoEnPath(pts, d0), puntoEnPath(pts, d1));
    }

    function giroEnVentana(pts, d, radio, total) {
        return anguloDiff(headingEn(pts, d - radio, total), headingEn(pts, d + radio, total));
    }

    function marcaCurva(c) {
        return {
            distM: c.distM,
            maxKmh: c.maxKmh,
            giro: c.giro,
            desdeM: Math.max(0, c.distM - ZONA_CURVA_M),
            hastaM: c.distM + ZONA_CURVA_M
        };
    }

    function detectarCurvas(pts) {
        if (!pts || pts.length < 3) return [];
        var total = longitudPath(pts);
        if (total < 40) return [];
        var crudas = [];
        var paso = 4;
        for (var d = 16; d <= total - 16; d += paso) {
            var g8 = giroEnVentana(pts, d, 8, total);
            var g14 = giroEnVentana(pts, d, 14, total);
            var g22 = giroEnVentana(pts, d, 22, total);
            if (g8 < 10 && g14 < 14) continue;
            var giro = Math.max(g8, g14, g22);
            var maxKmh = limitePorGiro(giro);
            if (!maxKmh) continue;
            crudas.push({ distM: d, maxKmh: maxKmh, giro: giro, g14: g14, g22: g22 });
        }
        if (!crudas.length) return [];
        var runs = [{ items: [crudas[0]] }];
        for (var k = 1; k < crudas.length; k++) {
            var run = runs[runs.length - 1];
            var last = run.items[run.items.length - 1];
            if (crudas[k].distM - last.distM < 10) {
                run.items.push(crudas[k]);
            } else {
                runs.push({ items: [crudas[k]] });
            }
        }
        var out = [];
        for (var i = 0; i < runs.length; i++) {
            var items = runs[i].items;
            var best = items[0];
            for (var j = 1; j < items.length; j++) {
                var cand = items[j];
                var mejorApex = cand.g14 > best.g14 + 2 ||
                    (Math.abs(cand.g14 - best.g14) <= 2 && cand.g22 > best.g22);
                if (mejorApex || (cand.g14 >= best.g14 - 2 && cand.maxKmh < best.maxKmh)) {
                    best = cand;
                }
            }
            out.push(marcaCurva(best));
        }
        var fused = [out[0]];
        for (var f = 1; f < out.length; f++) {
            var prev = fused[fused.length - 1];
            if (out[f].distM - prev.distM < 36) {
                if (out[f].giro > prev.giro || out[f].maxKmh < prev.maxKmh) {
                    fused[fused.length - 1] = marcaCurva(out[f]);
                }
            } else {
                fused.push(out[f]);
            }
        }
        return fused;
    }

    function crearRutaCalle(pts) {
        var distM = Math.max(longitudPath(pts), 1);
        var curvas = detectarCurvas(pts);
        return {
            a: pts[0],
            b: pts[pts.length - 1],
            distM: distM,
            km: distM / 1000,
            puntos: pts,
            curvas: curvas,
            puntoEn: function (s) {
                return puntoEnPath(pts, Math.max(0, Math.min(1, s)) * distM);
            },
            rumboEn: function (s) {
                return rumboEnPath(pts, Math.max(0, Math.min(1, s)) * distM);
            },
            anguloEn: function (s) {
                var dist = Math.max(0, Math.min(1, s)) * distM;
                var c = this.curvaActual(dist);
                return c ? c.giro : 0;
            },
            curvaActual: function (dist) {
                var best = null;
                for (var i = 0; i < curvas.length; i++) {
                    var d = Math.abs(curvas[i].distM - dist);
                    if (d <= ZONA_CURVA_M && (!best || d < best.d)) {
                        best = { d: d, curva: curvas[i] };
                    }
                }
                return best ? best.curva : null;
            },
            proximaCurva: function (dist) {
                var best = null;
                for (var i = 0; i < curvas.length; i++) {
                    var adelante = curvas[i].distM - dist;
                    if (adelante > 4 && adelante <= AVISO_CURVA_M) {
                        if (!best || adelante < best.adelante) {
                            best = { curva: curvas[i], adelante: adelante };
                        }
                    }
                }
                return best ? best.curva : null;
            },
            vmaxEn: function (dist) {
                return VMAX_KMH;
            }
        };
    }

    function avisoDe(curva, tipo) {
        if (!curva) return null;
        return {
            distM: curva.distM,
            maxKmh: curva.maxKmh,
            giro: curva.giro,
            tipo: tipo
        };
    }

    function evaluarRuta(r, s, velMs) {
        var dist = s * r.distM;
        var actual = r.curvaActual(dist);
        var prox = r.proximaCurva(dist);
        var kmh = velMs * 3.6;
        var choca = !!(actual && Math.round(kmh) > actual.maxKmh);
        return {
            velMs: velMs,
            estable: !choca,
            aviso: actual ? avisoDe(actual, "ahora") : avisoDe(prox, "proxima"),
            choca: choca,
            curva: actual
        };
    }

    function aplicarFisica(dt, v, pedales, r) {
        var acc = -COAST;
        if (pedales.freno) acc = -FRENO;
        else if (pedales.acel) acc = ACEL;
        var vmax = VMAX_KMH / 3.6;
        var vel = Math.max(0, Math.min(vmax, v.velMs + acc * dt));
        var ev = evaluarRuta(r, v.s, vel);
        vel = ev.velMs;
        var ds = r.distM > 1 ? (vel * dt * SENSACION) / r.distM : 1;
        return {
            velMs: vel,
            s: Math.max(0, Math.min(1, v.s + ds)),
            aviso: ev.aviso,
            choca: ev.choca,
            curva: ev.curva
        };
    }

    function textoKm(km) {
        if (km < 1) return Math.round(km * 1000) + " m";
        return km.toFixed(1).replace(".", ",") + " km";
    }

    function textoTiempo(ms) {
        var s = Math.max(0, Math.round(ms / 1000));
        var m = Math.floor(s / 60);
        var r = s % 60;
        if (m <= 0) return r + " s";
        return m + " min " + (r < 10 ? "0" : "") + r + " s";
    }

    function iconoAB(letra, cls) {
        return L.divIcon({
            className: "carrera-pin " + cls,
            html: '<span>' + letra + "</span>",
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });
    }

    function iconoMeta() {
        return L.divIcon({
            className: "carrera-pin meta",
            html: '<span class="carrera-bandera" title="Meta">' +
                '<svg viewBox="0 0 32 40" aria-hidden="true">' +
                '<path d="M7 38V5" fill="none" stroke="#1f2430" stroke-width="2.2" stroke-linecap="round"/>' +
                '<g transform="translate(8,5)">' +
                '<rect width="5.5" height="5.5" fill="#111"/><rect x="5.5" width="5.5" height="5.5" fill="#fff"/>' +
                '<rect x="11" width="5.5" height="5.5" fill="#111"/><rect x="16.5" width="5.5" height="5.5" fill="#fff"/>' +
                '<rect y="5.5" width="5.5" height="5.5" fill="#fff"/><rect x="5.5" y="5.5" width="5.5" height="5.5" fill="#111"/>' +
                '<rect x="11" y="5.5" width="5.5" height="5.5" fill="#fff"/><rect x="16.5" y="5.5" width="5.5" height="5.5" fill="#111"/>' +
                '<rect y="11" width="5.5" height="5.5" fill="#111"/><rect x="5.5" y="11" width="5.5" height="5.5" fill="#fff"/>' +
                '<rect x="11" y="11" width="5.5" height="5.5" fill="#111"/><rect x="16.5" y="11" width="5.5" height="5.5" fill="#fff"/>' +
                '</g></svg></span>',
            iconSize: [34, 42],
            iconAnchor: [7, 40]
        });
    }

    function iconoFx(tipo) {
        if (tipo === "mecanico") {
            return L.divIcon({
                className: "carrera-choque carrera-mecanico",
                html: '<img src="' + GIF_MECANICO + '" alt="" width="80" height="80">',
                iconSize: [80, 80],
                iconAnchor: [40, 70]
            });
        }
        return L.divIcon({
            className: "carrera-choque carrera-explosion",
            html: '<img src="' + GIF_EXPLOSION + '" alt="" width="72" height="72">',
            iconSize: [72, 72],
            iconAnchor: [36, 36]
        });
    }

    function subpathMetros(pts, fromM, toM) {
        var total = longitudPath(pts);
        var a = Math.max(0, Math.min(total, fromM));
        var b = Math.max(a + 2, Math.min(total, toM));
        var out = [];
        for (var d = a; d < b; d += 3) out.push(puntoEnPath(pts, d));
        out.push(puntoEnPath(pts, b));
        return out;
    }

    function quitarCapas() {
        ["a", "b", "linea", "curvas"].forEach(function (k) {
            if (capas[k]) {
                api.map.removeLayer(capas[k]);
                capas[k] = null;
            }
        });
    }

    function pintarCurvasRojas(pts, curvas) {
        if (capas.curvas) {
            api.map.removeLayer(capas.curvas);
            capas.curvas = null;
        }
        if (!pts || !curvas || !curvas.length) return;
        var grupo = L.layerGroup();
        for (var i = 0; i < curvas.length; i++) {
            var c = curvas[i];
            var desde = Number.isFinite(c.desdeM) ? c.desdeM : c.distM - ZONA_CURVA_M;
            var hasta = Number.isFinite(c.hastaM) ? c.hastaM : c.distM + ZONA_CURVA_M;
            var tramo = subpathMetros(pts, desde, hasta);
            if (tramo.length < 2) continue;
            L.polyline(tramo, {
                color: "#dc2626",
                weight: 8,
                opacity: 0.95,
                lineCap: "round",
                lineJoin: "round",
                interactive: false
            }).addTo(grupo);
        }
        capas.curvas = grupo.addTo(api.map);
    }

    function pintarCircuito(path, curvas) {
        quitarCapas();
        if (!puntoA) return;
        capas.a = L.marker(puntoA, {
            icon: iconoAB("A", "salida"),
            zIndexOffset: 1200,
            interactive: false
        }).addTo(api.map);
        if (!puntoB) return;
        capas.b = L.marker(puntoB, {
            icon: iconoMeta(),
            zIndexOffset: 1200,
            interactive: false
        }).addTo(api.map);
        var pts = path && path.length >= 2 ? path : null;
        if (!pts) return;
        capas.linea = L.polyline(pts, {
            color: "#f5a623",
            weight: 6,
            opacity: 0.92,
            lineCap: "round",
            lineJoin: "round",
            interactive: false
        }).addTo(api.map);
        pintarCurvasRojas(pts, curvas);
        api.map.fitBounds(L.latLngBounds(pts).pad(0.28), { animate: true, maxZoom: 16 });
    }

    function setBanner(titulo, detalle, aviso) {
        var t = $("carreraBannerTitulo");
        var d = $("carreraBannerDet");
        var a = $("carreraAviso");
        var hud = $("carreraHudSel");
        if (t) t.textContent = titulo || "";
        if (d) d.textContent = detalle || "";
        if (a) {
            a.textContent = aviso || "";
            a.classList.toggle("oculto", !aviso);
        }
        if (hud) hud.setAttribute("data-fase", fase || "");
    }

    function mostrar(el, si) {
        if (!el) return;
        el.classList.toggle("oculto", !si);
    }

    function setHudSel(mostrarSel) {
        mostrar($("carreraHudSel"), mostrarSel);
        mostrar($("btnCarreraLargar"), fase === "listo");
        mostrar($("btnCarreraRehacer"), fase === "listo");
        mostrar($("btnCarreraWhatsApp"), fase === "listo");
        if (fase === "listo") pintarListaRivales();
        else mostrar($("carreraListaRivales"), false);
    }

    function tokenCarreraDeUrl() {
        try {
            return String(new URLSearchParams(window.location.search).get("carrera") || "").trim();
        } catch (e) {
            return "";
        }
    }

    function urlCarreraPublica(token) {
        var path = window.location.pathname || "/";
        var origin = window.location.origin || "";
        return origin + path.replace(/\?.*$/, "").replace(/#.*$/, "") + "?carrera=" + encodeURIComponent(token);
    }

    function abrirWhatsAppCarrera(token) {
        var url = urlCarreraPublica(token);
        var texto = TXT_WA_CARRERA + " " + url;
        var wa = "https://api.whatsapp.com/send?text=" + encodeURIComponent(texto);
        var win = window.open(wa, "_blank");
        if (!win && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(texto).then(function () {
                alert("WhatsApp no se abrió. Copiamos el mensaje para que lo pegues.");
            }).catch(function () {
                prompt("Copiá este mensaje y envialo por WhatsApp:", texto);
            });
        } else if (!win) {
            prompt("Copiá este mensaje y envialo por WhatsApp:", texto);
        }
    }

    function iconoRandomLocal() {
        var cols = 15;
        var rows = 8;
        if (api && api.iconoGrilla) {
            var g = api.iconoGrilla();
            if (g) {
                cols = Math.max(1, g.cols || cols);
                rows = Math.max(1, g.rows || rows);
            }
        }
        return {
            x: Math.floor(Math.random() * cols),
            y: Math.floor(Math.random() * rows)
        };
    }

    function prepararPerfilInvitadoCarrera() {
        var nomEl = $("nombre");
        var nom = "";
        try { nom = (localStorage.getItem("nombre") || "").trim(); } catch (e) { nom = ""; }
        if (nomEl && nomEl.value) nom = String(nomEl.value).trim() || nom;
        if (nom) return false;
        if (nomEl) nomEl.value = "Invitado";
        try { localStorage.setItem("nombre", "Invitado"); } catch (e2) {}
        var xy = iconoRandomLocal();
        if (api && typeof api.guardarIconoLocal === "function") {
            api.guardarIconoLocal(xy.x, xy.y);
        } else {
            try { localStorage.setItem("v2v_icono", JSON.stringify(xy)); } catch (e3) {}
        }
        if (api && typeof api.actualizarPerfilLocal === "function") api.actualizarPerfilLocal();
        return true;
    }

    function entrarMapaParaCarrera() {
        try {
            localStorage.setItem("radiomap_entro", "1");
            localStorage.setItem("baliza_entro", "1");
        } catch (e) {}
        var portada = $("portada");
        if (portada) portada.classList.add("oculto");
        if (api && typeof api.iniciarGps === "function") api.iniciarGps();
        if (api && typeof api.emitirTelemetria === "function") api.emitirTelemetria(true);
    }

    function setupActivo() {
        return fase === "eligiendo_a" || fase === "eligiendo_b" || fase === "armando" || fase === "listo" || fase === "esperando";
    }

    function claseCuerpo() {
        document.body.classList.toggle("modo-carrera-setup", setupActivo());
        document.body.classList.toggle("modo-carrera", bloqueaGps());
        mostrar($("btnCarrera"), fase === "idle");
        mostrar($("btnCarreraDock"), fase === "idle");
        mostrar($("carreraHudSel"), setupActivo());
        mostrar($("carreraVel"), fase === "corriendo" || fase === "meta" || fase === "choque");
        mostrar($("carreraPedales"), fase === "corriendo");
        mostrar($("btnCarreraSalir"), fase === "corriendo");
        mostrar($("btnCarreraPtt"), fase === "corriendo" || fase === "esperando" || fase === "meta" || fase === "choque");
        mostrar($("carreraMeta"), fase === "meta" || (fase === "choque" && choqueFx !== "frenando"));
        setHudSel(fase === "eligiendo_a" || fase === "eligiendo_b" || fase === "listo" || fase === "esperando");
        var hud = $("carreraHudSel");
        if (hud) hud.setAttribute("data-fase", fase || "");
        var meta = $("carreraMeta");
        if (meta) {
            meta.classList.toggle("choque", fase === "choque");
            meta.classList.toggle("choque-fatal", fase === "choque" && choques >= CHOQUES_MAX);
        }
        mostrar($("btnCarreraVolver"), fase === "meta" || (fase === "choque" && choques >= CHOQUES_MAX));
    }

    function escHtml(s) {
        return String(s || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function pintarListaRivales() {
        var caja = $("carreraListaRivales");
        if (!caja) return;
        if (fase !== "listo") {
            caja.innerHTML = "";
            caja.classList.add("oculto");
            return;
        }
        var lista = api.conectados ? api.conectados() : [];
        caja.classList.remove("oculto");
        if (!lista.length) {
            caja.innerHTML = '<p class="carrera-rivales-vacio">Nadie conectado cerca. Invitá por WhatsApp o largá en práctica.</p>';
            return;
        }
        caja.innerHTML = lista.map(function (p) {
            var nom = escHtml(p.nombre || "Invitado");
            var extra = p.vehiculo ? ("<small>" + escHtml(p.vehiculo) + "</small>") : "";
            return '<button type="button" class="carrera-rival" data-id="' + escHtml(p.id) + '">' +
                "<span><strong>" + nom + "</strong>" + extra + "</span><em>Desafiar</em></button>";
        }).join("");
        caja.querySelectorAll(".carrera-rival").forEach(function (btn) {
            btn.addEventListener("click", function () {
                desafiar(btn.getAttribute("data-id"));
            });
        });
    }

    function invitarPorWhatsApp() {
        if (fase !== "listo" || !rutaArmada) return;
        socketEmit("carreraInvitarLink", {
            path: rutaArmada.puntos,
            a: rutaArmada.a,
            b: rutaArmada.b,
            km: rutaArmada.km
        }, function (res) {
            if (!res || !res.ok || !res.token) {
                setBanner(
                    "Circuito listo",
                    textoKm(rutaArmada.km) + " · desafiá a alguien o largá práctica",
                    (res && res.error) || "No se pudo armar el link."
                );
                claseCuerpo();
                return;
            }
            linkTokenActivo = res.token;
            modo = "duelo";
            rival = { id: "", nombre: "Invitado", vehiculo: "", link: true };
            fase = "esperando";
            setBanner(
                "Esperando por WhatsApp",
                "Cuando acepten el link, largan juntos el 1 vs 1."
            );
            claseCuerpo();
            abrirWhatsAppCarrera(res.token);
        });
    }

    function unirsePorLinkCarrera() {
        var token = tokenCarreraDeUrl();
        if (!token || !api || !api.socket || uniendoPorLink) return;
        uniendoPorLink = true;
        prepararPerfilInvitadoCarrera();
        entrarMapaParaCarrera();
        if (api && typeof api.emitirTelemetria === "function") api.emitirTelemetria(true);
        socketEmit("carreraUnirseLink", { token: token }, function (res) {
            uniendoPorLink = false;
            if (!res || !res.ok) {
                var err = (res && res.error) || "";
                if (/mapa|conexión|conectado/i.test(err)) {
                    setTimeout(unirsePorLinkCarrera, 900);
                    return;
                }
                alert(err || "Ese desafío ya no está. Pedile un link nuevo.");
                return;
            }
            if (res.invitacion && !invitacionPendiente) mostrarModalDuelo(res.invitacion);
        });
    }

    function tituloModo() {
        return esDuelo() ? "Carrera · 1 vs 1" : "Carrera · práctica";
    }

    function pintarVel(aviso) {
        var caja = $("carreraVel");
        var n = $("carreraVelNum");
        var kmh = velChoqueKmh != null
            ? velChoqueKmh
            : (vehiculo ? Math.round(vehiculo.velMs * 3.6) : 0);
        if (n) n.textContent = String(kmh);
        if (caja) caja.classList.toggle("choque", fase === "choque");
        var el = $("carreraCurvaAviso");
        if (!el) return;
        var txt = $("carreraCurvaTxt");
        var num = $("carreraCurvaNum");
        if (aviso && aviso.maxKmh && fase === "corriendo") {
            if (txt) txt.textContent = aviso.tipo === "ahora" ? "Giro máx." : "Próxima curva";
            if (num) num.textContent = String(aviso.maxKmh);
            el.classList.toggle("ahora", aviso.tipo === "ahora");
            el.classList.remove("oculto");
        } else {
            if (txt) txt.textContent = "";
            if (num) num.textContent = "";
            el.classList.remove("ahora");
            el.classList.add("oculto");
        }
    }

    function aplicarRumboMarker(id, rumbo) {
        if (!id || !Number.isFinite(Number(rumbo))) return;
        if (typeof api.aplicarRumbo !== "function") return;
        api.aplicarRumbo(id, rumbo);
        requestAnimationFrame(function () {
            if (typeof api.aplicarRumbo === "function") api.aplicarRumbo(id, rumbo);
        });
    }

    function moverAuto(ll, rumbo) {
        var m = api.markers[api.miId];
        if (!m) return;
        m.setLatLng(ll);
        if (m.closeTooltip) m.closeTooltip();
        if (m.closePopup) m.closePopup();
        aplicarRumboMarker(api.miId, rumbo);
        api.map.setView(ll, Math.max(api.map.getZoom(), 17), { animate: false });
    }

    function asegurarMarker() {
        var m = api.markers[api.miId];
        var ll = puntoA;
        if (!m && api.crearIcono) {
            m = L.marker(ll, {
                icon: api.crearIcono(true, api.iconoDeAuto ? api.iconoDeAuto({ id: api.miId }) : null),
                zIndexOffset: 2000,
                title: "YO"
            }).addTo(api.map);
            api.markers[api.miId] = m;
        }
        if (m) {
            m.setLatLng(ll);
            m.setZIndexOffset(2000);
            if (m.closeTooltip) m.closeTooltip();
            if (m.closePopup) m.closePopup();
        }
        return m;
    }

    function marcarRivalEl(m) {
        if (!m) return;
        var el = m.getElement && m.getElement();
        if (el) el.classList.add("marker-carrera-rival");
    }

    function asegurarRival() {
        if (!rival || !rival.id || !api.crearIcono) return null;
        var ll = ruta ? ruta.puntoEn(0) : puntoA;
        var m = api.markers[rival.id];
        var xy = api.iconoDeAuto ? api.iconoDeAuto(rival) : { x: rival.iconoX || 0, y: rival.iconoY || 0 };
        if (!m) {
            m = L.marker(ll, {
                icon: api.crearIcono(false, xy),
                zIndexOffset: 1800,
                title: rival.nombre || "Rival"
            }).addTo(api.map);
            api.markers[rival.id] = m;
        } else {
            m.setLatLng(ll);
            m.setZIndexOffset(1800);
        }
        if (m.closeTooltip) m.closeTooltip();
        if (m.closePopup) m.closePopup();
        marcarRivalEl(m);
        if (ruta) aplicarRumboMarker(rival.id, ruta.rumboEn(vehiculo ? vehiculo.s : 0));
        return m;
    }

    function moverRivalSnap(snap) {
        if (!rival || !snap) return;
        ultimoRivalSnap = snap;
        var m = api.markers[rival.id];
        if (!m) m = asegurarRival();
        if (!m) return;
        if (Number.isFinite(Number(snap.lat)) && Number.isFinite(Number(snap.lng))) {
            m.setLatLng([Number(snap.lat), Number(snap.lng)]);
        }
        var rumboSnap = Number(snap.rumbo);
        if (!Number.isFinite(rumboSnap) && ruta && Number.isFinite(Number(snap.s))) {
            rumboSnap = ruta.rumboEn(Number(snap.s));
        }
        aplicarRumboMarker(rival.id, rumboSnap);
        marcarRivalEl(m);
        aplicarFxRival(m, snap);
    }

    function aplicarFxRival(m, snap) {
        if (!m || !snap) return;
        var fx = snap.choqueFx || (snap.fase === "choque" ? "explosion" : null);
        if (fx === "explosion" || fx === "mecanico") {
            if (m._carreraFx !== fx) {
                m.setIcon(iconoFx(fx));
                m._carreraFx = fx;
                m._iconoSrc = null;
            }
            return;
        }
        if (m._carreraFx) {
            var xy = api.iconoDeAuto ? api.iconoDeAuto(rival) : { x: rival.iconoX || 0, y: rival.iconoY || 0 };
            if (api.crearIcono) m.setIcon(api.crearIcono(false, xy));
            m._carreraFx = null;
            marcarRivalEl(m);
        }
    }

    function emitirEstado(forzar) {
        if (!esDuelo() || !carreraId || !ruta || !vehiculo) return;
        var ahora = Date.now();
        if (!forzar && ahora - ultimoEmit < 90) return;
        ultimoEmit = ahora;
        var ll = ruta.puntoEn(vehiculo.s);
        socketEmit("carreraEstado", {
            carreraId: carreraId,
            s: vehiculo.s,
            velKmh: vehiculo.velMs * 3.6,
            lat: ll[0],
            lng: ll[1],
            rumbo: ruta.rumboEn(vehiculo.s),
            fase: fase,
            choques: choques,
            choqueFx: choqueFx
        });
    }

    function lockMapa(si) {
        var map = api.map;
        if (!mapLock) {
            mapLock = {
                drag: map.dragging.enabled(),
                touch: map.touchZoom.enabled(),
                dbl: map.doubleClickZoom.enabled(),
                scroll: map.scrollWheelZoom.enabled(),
                box: map.boxZoom.enabled(),
                key: map.keyboard.enabled()
            };
        }
        if (si) {
            map.dragging.disable();
            map.touchZoom.disable();
            map.doubleClickZoom.disable();
            map.scrollWheelZoom.disable();
            map.boxZoom.disable();
            map.keyboard.disable();
        } else if (mapLock) {
            if (mapLock.drag) map.dragging.enable();
            if (mapLock.touch) map.touchZoom.enable();
            if (mapLock.dbl) map.doubleClickZoom.enable();
            if (mapLock.scroll) map.scrollWheelZoom.enable();
            if (mapLock.box) map.boxZoom.enable();
            if (mapLock.key) map.keyboard.enable();
        }
    }

    function curvaEnTramo(r, from, to) {
        var curvas = r && r.curvas ? r.curvas : [];
        var best = null;
        var mid = (from + to) / 2;
        for (var i = 0; i < curvas.length; i++) {
            var c = curvas[i];
            var ini = c.distM - ZONA_CURVA_M;
            var fin = c.distM + ZONA_CURVA_M;
            if (from < fin && to >= ini) {
                var d = Math.abs(c.distM - mid);
                if (!best || d < best.d) best = { d: d, curva: c };
            }
        }
        return best ? best.curva : null;
    }

    function ponerFx(tipo, ll) {
        var m = api.markers[api.miId];
        if (!m) return;
        m.setIcon(iconoFx(tipo));
        if (ll) m.setLatLng(ll);
        m.setZIndexOffset(2500);
        if (m.closeTooltip) m.closeTooltip();
        if (m.closePopup) m.closePopup();
        m._iconoSrc = null;
        m._carreraFx = tipo;
    }

    function restaurarIconoAuto() {
        var m = api.markers[api.miId];
        if (!m || !api.crearIcono) return;
        m.setIcon(api.crearIcono(true, api.iconoDeAuto ? api.iconoDeAuto({ id: api.miId }) : null));
        m.setZIndexOffset(1000);
        m._carreraFx = null;
        if (ruta) aplicarRumboMarker(api.miId, ruta.rumboEn(vehiculo ? vehiculo.s : 0));
    }

    function pintarPopupChoque() {
        var tit = $("carreraMetaTitulo");
        var txt = $("carreraMetaTxt");
        var tiempo = $("carreraMetaTiempo");
        var fatal = choques >= CHOQUES_MAX;
        if (tit) tit.textContent = "¡CHOQUE!";
        if (txt) {
            var base = avisoChoque && avisoChoque.maxKmh
                ? ("El giro máximo era a " + avisoChoque.maxKmh + " km/h.")
                : "Pasaste el giro más rápido de lo permitido.";
            txt.textContent = fatal
                ? (base + " Se acabaron los choques.")
                : (base + " Choque " + choques + " de " + CHOQUES_MAX + ".");
        }
        if (tiempo) tiempo.textContent = (velChoqueKmh != null ? velChoqueKmh : 0) + " km/h";
    }

    function chocar(aviso) {
        if (fase !== "corriendo" || choqueFx) return;
        choques += 1;
        avisoChoque = aviso || null;
        velChoqueKmh = Math.round((vehiculo && vehiculo.velMs ? vehiculo.velMs : 0) * 3.6);
        velFrenoInicio = vehiculo && vehiculo.velMs ? vehiculo.velMs : 0;
        tFreno = 0;
        controles.acel = false;
        controles.freno = false;
        fase = "choque";
        choqueFx = "frenando";
        pintarVel(null);
        claseCuerpo();
        emitirEstado(true);
        if (!raf) {
            ultimoTs = 0;
            raf = requestAnimationFrame(loop);
        }
    }

    function iniciarExplosionChoque() {
        if (fase !== "choque") return;
        choqueFx = "explosion";
        vehiculo.velMs = 0;
        var ll = ruta.puntoEn(vehiculo.s);
        ponerFx("explosion", ll);
        pintarPopupChoque();
        pintarVel(null);
        claseCuerpo();
        emitirEstado(true);
        programar(function () {
            if (fase !== "choque" || choqueFx !== "explosion") return;
            if (choques >= CHOQUES_MAX) return;
            iniciarMecanicoChoque();
        }, CHOQUE_EXPLOSION_MS);
    }

    function iniciarMecanicoChoque() {
        if (fase !== "choque") return;
        choqueFx = "mecanico";
        var ll = ruta.puntoEn(vehiculo.s);
        ponerFx("mecanico", ll);
        pintarPopupChoque();
        claseCuerpo();
        emitirEstado(true);
        programar(function () {
            if (fase !== "choque" || choqueFx !== "mecanico") return;
            reanudarTrasChoque();
        }, CHOQUE_MECANICO_MS);
    }

    function reanudarTrasChoque() {
        if (fase !== "choque") return;
        if (resultadoDuelo === "ganaste" || resultadoDuelo === "perdiste") {
            cerrarChoquePorResultado();
            return;
        }
        choqueFx = null;
        avisoChoque = null;
        velChoqueKmh = null;
        fase = "corriendo";
        vehiculo.velMs = 0;
        controles.acel = false;
        controles.freno = false;
        restaurarIconoAuto();
        moverAuto(ruta.puntoEn(vehiculo.s), ruta.rumboEn(vehiculo.s));
        pintarVel(null);
        claseCuerpo();
        ultimoTs = 0;
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(loop);
        emitirEstado(true);
    }

    function cerrarChoquePorResultado() {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        choqueFx = null;
        velChoqueKmh = null;
        vehiculo.velMs = 0;
        controles.acel = false;
        controles.freno = false;
        restaurarIconoAuto();
        fase = "meta";
        tFin = Date.now();
        var tit = $("carreraMetaTitulo");
        var txt = $("carreraMetaTxt");
        var tiempo = $("carreraMetaTiempo");
        if (resultadoDuelo === "ganaste") {
            if (tit) tit.textContent = "¡GANASTE!";
            if (txt) txt.textContent = "El rival se bajó.";
        } else {
            if (tit) tit.textContent = "Segundo";
            if (txt) txt.textContent = "El rival llegó antes.";
        }
        if (tiempo) tiempo.textContent = textoTiempo(tFin - t0);
        claseCuerpo();
        emitirEstado(true);
    }

    function loop(ts) {
        if (fase === "choque" && choqueFx === "frenando") {
            raf = requestAnimationFrame(loop);
            if (!ultimoTs) {
                ultimoTs = ts;
                return;
            }
            var dtF = Math.min(0.05, (ts - ultimoTs) / 1000);
            ultimoTs = ts;
            tFreno += dtF;
            var k = Math.min(1, tFreno / CHOQUE_FRENO_S);
            vehiculo.velMs = Math.max(0, velFrenoInicio * (1 - k));
            var ds = ruta.distM > 1 ? (vehiculo.velMs * dtF * SENSACION) / ruta.distM : 0;
            vehiculo.s = Math.max(0, Math.min(1, vehiculo.s + ds));
            moverAuto(ruta.puntoEn(vehiculo.s), ruta.rumboEn(vehiculo.s));
            pintarVel(null);
            emitirEstado(false);
            if (vehiculo.s >= 1) {
                if (raf) cancelAnimationFrame(raf);
                raf = 0;
                choqueFx = null;
                terminar();
                return;
            }
            if (k >= 1) {
                if (raf) cancelAnimationFrame(raf);
                raf = 0;
                iniciarExplosionChoque();
            }
            return;
        }
        if (fase !== "corriendo") return;
        raf = requestAnimationFrame(loop);
        if (!ultimoTs) {
            ultimoTs = ts;
            return;
        }
        var dt = Math.min(0.05, (ts - ultimoTs) / 1000);
        ultimoTs = ts;
        var distAntes = vehiculo.s * ruta.distM;
        var next = aplicarFisica(dt, vehiculo, controles, ruta);
        vehiculo.velMs = next.velMs;
        vehiculo.s = next.s;
        var distAhora = vehiculo.s * ruta.distM;
        var ll = ruta.puntoEn(vehiculo.s);
        moverAuto(ll, ruta.rumboEn(vehiculo.s));
        pintarVel(next.aviso);
        emitirEstado(false);
        var curvaHit = curvaEnTramo(ruta, distAntes, distAhora) || next.curva;
        var kmh = next.velMs * 3.6;
        if (curvaHit && Math.round(kmh) > curvaHit.maxKmh) {
            chocar(curvaHit);
            return;
        }
        if (vehiculo.s >= 1) terminar();
    }

    function terminar() {
        if (fase !== "corriendo" && fase !== "choque") return;
        if (fase === "choque" && choqueFx) return;
        fase = "meta";
        choqueFx = null;
        avisoChoque = null;
        velChoqueKmh = null;
        vehiculo.velMs = 0;
        vehiculo.s = 1;
        tFin = Date.now();
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        controles.acel = false;
        controles.freno = false;
        restaurarIconoAuto();
        moverAuto(ruta.puntoEn(1), ruta.rumboEn(1));
        pintarVel();
        var tit = $("carreraMetaTitulo");
        var txt = $("carreraMetaTxt");
        var tiempo = $("carreraMetaTiempo");
        if (tit) tit.textContent = resultadoDuelo === "ganaste" ? "¡GANASTE!" : (resultadoDuelo === "perdiste" ? "Segundo" : "¡META!");
        if (txt) {
            txt.textContent = esDuelo()
                ? (resultadoDuelo === "ganaste" ? "Llegaste primero." : (resultadoDuelo === "perdiste" ? "El rival llegó antes." : "Práctica terminada"))
                : "Práctica terminada";
        }
        if (tiempo) tiempo.textContent = textoTiempo(tFin - t0);
        claseCuerpo();
        emitirEstado(true);
    }

    function limpiarCuenta() {
        cuentaTimers.forEach(function (id) { clearTimeout(id); });
        cuentaTimers = [];
    }

    function programar(fn, ms) {
        cuentaTimers.push(setTimeout(fn, ms));
    }

    function setCortina(kicker, titulo, cuenta) {
        var k = $("carreraCortinaKicker");
        var t = $("carreraCortinaTitulo");
        var c = $("carreraCortina");
        if (k) k.textContent = kicker || "";
        if (t) t.textContent = titulo || "";
        if (c) c.classList.toggle("cuenta", !!cuenta);
    }

    function largar() {
        if (fase !== "listo" || !rutaArmada) return;
        modo = "practica";
        rival = null;
        carreraId = null;
        resultadoDuelo = null;
        prepararLargada(rutaArmada, Date.now() + 3500);
    }

    function desactivarNavGpsPrevio() {
        if (api && typeof api.desactivarNavGps === "function") api.desactivarNavGps();
    }

    function prepararLargada(r, tLargada) {
        ruta = r;
        vehiculo = { s: 0, velMs: 0 };
        velChoqueKmh = null;
        choques = 0;
        choqueFx = null;
        avisoChoque = null;
        velFrenoInicio = 0;
        tFreno = 0;
        controles.acel = false;
        controles.freno = false;
        ultimoEmit = 0;
        ultimoRivalSnap = null;
        desactivarNavGpsPrevio();
        fase = "cortina";
        claseCuerpo();
        if (api.cerrarComms) api.cerrarComms();
        lockMapa(true);
        if (typeof api.setMapaBearing === "function") api.setMapaBearing(0);
        asegurarMarker();
        restaurarIconoAuto();
        if (esDuelo()) asegurarRival();
        moverAuto(ruta.puntoEn(0), ruta.rumboEn(0));
        var kicker = esDuelo() ? "1 vs 1" : "Práctica";
        var cortina = $("carreraCortina");
        mostrar(cortina, true);
        if (cortina) cortina.classList.add("on");
        setCortina(kicker, "CARRERA", false);
        limpiarCuenta();
        var t0c = Date.now();
        var fin = Number(tLargada) || (t0c + 3500);
        function en(msRel, fn) {
            var wait = Math.max(0, (fin - 3500 + msRel) - Date.now());
            programar(fn, wait);
        }
        en(650, function () {
            if (fase !== "cortina") return;
            setCortina("", "3", true);
        });
        en(1300, function () {
            if (fase !== "cortina") return;
            setCortina("", "2", true);
        });
        en(1950, function () {
            if (fase !== "cortina") return;
            setCortina("", "1", true);
        });
        en(2600, function () {
            if (fase !== "cortina") return;
            setCortina("", "¡YA!", true);
        });
        programar(function () {
            if (fase !== "cortina") return;
            if (cortina) cortina.classList.remove("on");
            programar(function () {
                mostrar(cortina, false);
                setCortina(kicker, "CARRERA", false);
                if (fase !== "cortina") return;
                fase = "corriendo";
                t0 = Date.now();
                tFin = 0;
                ultimoTs = 0;
                claseCuerpo();
                moverAuto(ruta.puntoEn(0), ruta.rumboEn(0));
                pintarVel();
                raf = requestAnimationFrame(loop);
                emitirEstado(true);
            }, 80);
        }, Math.max(0, fin - Date.now()));
    }

    function limpiarCircuito() {
        puntoA = null;
        puntoB = null;
        ruta = null;
        rutaArmada = null;
        rutaSeq += 1;
        vehiculo = null;
        velChoqueKmh = null;
        choques = 0;
        choqueFx = null;
        avisoChoque = null;
        velFrenoInicio = 0;
        tFreno = 0;
        rival = null;
        carreraId = null;
        resultadoDuelo = null;
        ultimoRivalSnap = null;
        modo = "practica";
        quitarCapas();
        var caja = $("carreraVel");
        if (caja) caja.classList.remove("choque");
        var meta = $("carreraMeta");
        if (meta) {
            meta.classList.remove("choque");
            meta.classList.remove("choque-fatal");
        }
        pintarVel(null);
    }

    function salir() {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        limpiarCuenta();
        if (carreraId || rival || linkTokenActivo || fase === "esperando") socketEmit("carreraSalir");
        ocultarModalDuelo();
        invitacionPendiente = null;
        linkTokenActivo = "";
        restaurarIconoAuto();
        fase = "idle";
        modo = "practica";
        rival = null;
        carreraId = null;
        controles.acel = false;
        controles.freno = false;
        lockMapa(false);
        if (typeof api.detenerPtt === "function") api.detenerPtt();
        mostrar($("carreraCortina"), false);
        var cortina = $("carreraCortina");
        if (cortina) {
            cortina.classList.remove("on");
            cortina.classList.remove("cuenta");
        }
        setCortina("Práctica", "CARRERA", false);
        limpiarCircuito();
        claseCuerpo();
        if (typeof api.alSalir === "function") api.alSalir();
    }

    function empezarPractica() {
        if (fase !== "idle") return;
        if (invitacionPendiente) responderDuelo(false);
        desactivarNavGpsPrevio();
        if (api.cerrarComms) api.cerrarComms();
        if (api.cerrarModales) api.cerrarModales();
        if (typeof api.setMapaBearing === "function") api.setMapaBearing(0);
        fase = "eligiendo_a";
        limpiarCircuito();
        setBanner("Carrera", "Tocá el mapa para marcar la SALIDA.");
        claseCuerpo();
    }

    function rechazarRuta(msg) {
        puntoB = null;
        rutaArmada = null;
        fase = "eligiendo_b";
        pintarCircuito();
        setBanner("Carrera", "Tocá la META · máximo 5 km.", msg);
        claseCuerpo();
    }

    function pedirRutaCalle(a, b) {
        rutaSeq += 1;
        var seq = rutaSeq;
        if (!api.rutaPorCalle) {
            rechazarRuta("No se pudo armar la ruta por calle. Probá otros puntos.");
            return;
        }
        api.rutaPorCalle(a, b).then(function (path) {
            if (seq !== rutaSeq) return;
            if (!path || path.length < 2) {
                rechazarRuta("No se pudo armar la ruta por calle. Probá otros puntos.");
                return;
            }
            var r = crearRutaCalle(path);
            if (r.km > DIST_MAX_KM) {
                rechazarRuta("El recorrido por calle supera los 5 km.");
                return;
            }
            rutaArmada = r;
            puntoB = r.b;
            fase = "listo";
            pintarCircuito(r.puntos, r.curvas);
            setBanner("Circuito listo", textoKm(r.km) + " · desafiá a alguien o largá práctica");
            claseCuerpo();
        }).catch(function () {
            if (seq !== rutaSeq) return;
            rechazarRuta("No se pudo armar la ruta por calle. Probá otros puntos.");
        });
    }

    function desafiar(id) {
        if (fase !== "listo" || !rutaArmada || !id) return;
        var lista = api.conectados ? api.conectados() : [];
        var ficha = null;
        for (var i = 0; i < lista.length; i++) {
            if (lista[i].id === id) ficha = lista[i];
        }
        socketEmit("carreraDesafiar", {
            rivalId: id,
            path: rutaArmada.puntos,
            a: rutaArmada.a,
            b: rutaArmada.b,
            km: rutaArmada.km
        }, function (res) {
            if (!res || !res.ok) {
                setBanner("Circuito listo", textoKm(rutaArmada.km) + " · por calle", (res && res.error) || "No se pudo desafiar.");
                claseCuerpo();
                return;
            }
            linkTokenActivo = "";
            modo = "duelo";
            rival = res.rival || ficha || { id: id, nombre: "Invitado" };
            fase = "esperando";
            setBanner(
                "Esperando a " + (rival.nombre || "Invitado"),
                "Si acepta, largan juntos el 1 vs 1."
            );
            claseCuerpo();
        });
    }

    function ocultarModalDuelo() {
        var m = $("modalCarreraDuelo");
        if (m) m.classList.add("oculto");
    }

    function mostrarModalDuelo(inv) {
        invitacionPendiente = inv;
        var tit = $("carreraDueloTitulo");
        var txt = $("carreraDueloTxt");
        if (tit) tit.textContent = (inv.nombre || "Alguien") + " te desafía";
        if (txt) {
            var km = inv.km ? ("Circuito de " + textoKm(inv.km) + ".") : "Carrera 1 vs 1.";
            txt.textContent = km + " Si aceptás, largan juntos.";
        }
        var m = $("modalCarreraDuelo");
        if (m) m.classList.remove("oculto");
    }

    function responderDuelo(aceptar) {
        var inv = invitacionPendiente;
        ocultarModalDuelo();
        invitacionPendiente = null;
        if (!inv) return;
        socketEmit("carreraResponder", { aceptar: !!aceptar }, function () {});
    }

    function yoSoyHost(data) {
        return !!(data && data.host && api.miId && data.host.id === api.miId);
    }

    function entrarDuelo(data) {
        if (!data || !data.path) return;
        ocultarModalDuelo();
        invitacionPendiente = null;
        linkTokenActivo = "";
        if (api.cerrarComms) api.cerrarComms();
        if (api.cerrarModales) api.cerrarModales();
        modo = "duelo";
        carreraId = data.carreraId;
        resultadoDuelo = null;
        rival = yoSoyHost(data) ? data.rival : data.host;
        puntoA = data.a || data.path[0];
        puntoB = data.b || data.path[data.path.length - 1];
        rutaArmada = crearRutaCalle(data.path);
        pintarCircuito(rutaArmada.puntos, rutaArmada.curvas);
        prepararLargada(rutaArmada, data.tLargada);
    }

    function onInvitacion(data) {
        if (!data || !data.de) return;
        if (bloqueaGps() || fase === "esperando") {
            socketEmit("carreraResponder", { aceptar: false });
            return;
        }
        mostrarModalDuelo(data);
    }

    function onCancelada(data) {
        ocultarModalDuelo();
        invitacionPendiente = null;
        if (fase === "esperando") {
            modo = "practica";
            rival = null;
            linkTokenActivo = "";
            fase = "listo";
            var motivo = data && data.motivo;
            var aviso = "El desafío se canceló.";
            if (motivo === "rechazo") aviso = "No aceptó el desafío.";
            else if (motivo === "timeout") aviso = "Se agotó el tiempo de espera.";
            else if (motivo === "expiro") aviso = "El link de WhatsApp venció.";
            setBanner(
                "Circuito listo",
                rutaArmada ? (textoKm(rutaArmada.km) + " · desafiá a alguien o largá práctica") : "Elegí de nuevo",
                aviso
            );
            claseCuerpo();
        }
    }

    function onLinkListo(data) {
        if (fase !== "esperando") return;
        if (data && data.rival) {
            rival = data.rival;
            setBanner(
                "Esperando a " + (rival.nombre || "Invitado"),
                "Abrió el link. Si acepta, largan juntos."
            );
        }
    }

    function onResultado(data) {
        if (!data) return;
        resultadoDuelo = data.resultado || resultadoDuelo;
        if (fase === "choque" && choqueFx && (resultadoDuelo === "ganaste" || resultadoDuelo === "perdiste")) {
            limpiarCuenta();
            cerrarChoquePorResultado();
            if (resultadoDuelo === "ganaste") {
                var txtWin = $("carreraMetaTxt");
                if (txtWin) {
                    txtWin.textContent = data.motivo === "abandono" || data.motivo === "desconexion"
                        ? "El rival se bajó."
                        : "Llegaste primero.";
                }
            }
            return;
        }
        if (fase === "meta" || fase === "choque") {
            var tit = $("carreraMetaTitulo");
            var txt = $("carreraMetaTxt");
            if (resultadoDuelo === "ganaste") {
                if (tit) tit.textContent = "¡GANASTE!";
                if (txt) txt.textContent = data.motivo === "abandono" || data.motivo === "desconexion"
                    ? "El rival se bajó."
                    : "Llegaste primero.";
            } else if (resultadoDuelo === "perdiste") {
                if (tit) tit.textContent = "Segundo";
                if (txt) txt.textContent = "El rival llegó antes.";
            }
        }
    }

    function onFin() {
        carreraId = null;
    }

    function engancharSocket() {
        var s = api.socket;
        if (!s || s._carreraOk) return;
        s._carreraOk = true;
        s.on("carreraInvitacion", onInvitacion);
        s.on("carreraInicio", entrarDuelo);
        s.on("carreraCancelada", onCancelada);
        s.on("carreraLinkListo", onLinkListo);
        s.on("carreraRival", moverRivalSnap);
        s.on("carreraRivalChoque", function (d) {
            if (!d) return;
            moverRivalSnap({
                lat: d.lat,
                lng: d.lng,
                rumbo: d.rumbo,
                fase: "choque",
                choqueFx: d.choqueFx || "explosion"
            });
        });
        s.on("carreraResultado", onResultado);
        s.on("carreraFin", onFin);
        s.on("connect", function () {
            if (tokenCarreraDeUrl()) unirsePorLinkCarrera();
        });
    }

    function refrescarRivales() {
        if (fase === "listo") pintarListaRivales();
    }

    function consumeClick(ev) {
        if (!activo() || bloqueaGps()) return activo();
        if (fase !== "eligiendo_a" && fase !== "eligiendo_b" && fase !== "armando") return false;
        var lat = ev.latlng && ev.latlng.lat;
        var lng = ev.latlng && ev.latlng.lng;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
        var p = [lat, lng];
        if (fase === "eligiendo_a") {
            puntoA = p;
            puntoB = null;
            rutaArmada = null;
            fase = "eligiendo_b";
            pintarCircuito();
            setBanner("Carrera", "Tocá la META · máximo 5 km.");
            claseCuerpo();
            return true;
        }
        var km = api.calcularDistanciaKm(puntoA[0], puntoA[1], p[0], p[1]);
        if (km < 0.08) {
            setBanner(
                "Carrera",
                "Tocá la META · máximo 5 km.",
                "Separá un poco más la salida y la meta."
            );
            claseCuerpo();
            return true;
        }
        if (km > DIST_MAX_KM) {
            puntoB = null;
            rutaArmada = null;
            pintarCircuito();
            setBanner(
                "Carrera",
                "Tocá la META · máximo 5 km.",
                "La distancia máxima entre salida y meta es de 5 km."
            );
            claseCuerpo();
            return true;
        }
        puntoB = p;
        rutaArmada = null;
        fase = "armando";
        pintarCircuito();
        setBanner("Armando circuito…", "Siguiendo las calles.");
        claseCuerpo();
        pedirRutaCalle(puntoA, p);
        return true;
    }

    function teclaEscape() {
        if (!activo()) return false;
        if (fase === "corriendo" || fase === "cortina" || fase === "meta" || fase === "choque") {
            salir();
            return true;
        }
        if (fase === "eligiendo_a" || fase === "eligiendo_b" || fase === "armando" || fase === "listo" || fase === "esperando") {
            salir();
            return true;
        }
        return false;
    }

    function pedal(cual, down) {
        if (fase !== "corriendo") return;
        if (cual === "acel") controles.acel = !!down;
        if (cual === "freno") controles.freno = !!down;
    }

    function engancharPedal(el, cual) {
        if (!el) return;
        var on = function (ev) {
            ev.preventDefault();
            if (el.setPointerCapture && ev.pointerId != null) {
                try { el.setPointerCapture(ev.pointerId); } catch (e) {}
            }
            pedal(cual, true);
            el.classList.add("on");
        };
        var off = function (ev) {
            if (ev) ev.preventDefault();
            pedal(cual, false);
            el.classList.remove("on");
        };
        el.addEventListener("pointerdown", on);
        el.addEventListener("pointerup", off);
        el.addEventListener("pointercancel", off);
        el.addEventListener("pointerleave", function (ev) {
            if (el.hasPointerCapture && ev.pointerId != null && el.hasPointerCapture(ev.pointerId)) off(ev);
        });
        el.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
    }

    function init(opts) {
        api = opts || {};
        var btn = $("btnCarrera");
        if (btn) btn.addEventListener("click", empezarPractica);
        var dock = $("btnCarreraDock");
        if (dock) dock.addEventListener("click", empezarPractica);
        var cancel = $("btnCarreraCancelar");
        if (cancel) cancel.addEventListener("click", salir);
        var rehacer = $("btnCarreraRehacer");
        if (rehacer) rehacer.addEventListener("click", empezarPractica);
        var largarBtn = $("btnCarreraLargar");
        if (largarBtn) largarBtn.addEventListener("click", largar);
        var waBtn = $("btnCarreraWhatsApp");
        if (waBtn) waBtn.addEventListener("click", invitarPorWhatsApp);
        var volver = $("btnCarreraVolver");
        if (volver) volver.addEventListener("click", salir);
        var salirRun = $("btnCarreraSalir");
        if (salirRun) salirRun.addEventListener("click", salir);
        engancharPedal($("btnCarreraFreno"), "freno");
        engancharPedal($("btnCarreraAcel"), "acel");
        var aceptar = $("btnCarreraAceptar");
        if (aceptar) aceptar.addEventListener("click", function () { responderDuelo(true); });
        var rechazar = $("btnCarreraRechazar");
        if (rechazar) rechazar.addEventListener("click", function () { responderDuelo(false); });
        var fondo = $("fondoCarreraDuelo");
        if (fondo) fondo.addEventListener("click", function () { responderDuelo(false); });
        engancharSocket();
        if (tokenCarreraDeUrl()) {
            prepararPerfilInvitadoCarrera();
            entrarMapaParaCarrera();
            if (api.socket && api.socket.connected) unirsePorLinkCarrera();
        }
        claseCuerpo();
    }

    global.RadioMapCarrera = {
        init: init,
        consumeClick: consumeClick,
        teclaEscape: teclaEscape,
        activo: activo,
        bloqueaGps: bloqueaGps,
        ocultaRivales: ocultaRivales,
        snapshot: snapshot,
        estado: estado,
        rivalId: rivalId,
        esRival: esRival,
        carreraId: function () { return carreraId; },
        participantes: function () {
            var ids = [];
            if (api && api.miId) ids.push(api.miId);
            if (rival && rival.id && ids.indexOf(rival.id) < 0) ids.push(rival.id);
            return ids;
        },
        refrescarRivales: refrescarRivales,
        debugCircuito: function () {
            var r = ruta || rutaArmada;
            if (!r) return null;
            return {
                fase: fase,
                distM: r.distM,
                curvas: r.curvas,
                s: vehiculo ? vehiculo.s : 0,
                velKmh: vehiculo ? vehiculo.velMs * 3.6 : 0
            };
        }
    };
})(window);
