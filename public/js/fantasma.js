// ===================================================
// RadioMap – Compartir Fantasma
// El anfitrión emite su vista; el invitado mira y puede hablar por walkie.
// ===================================================
(function (global) {
    "use strict";

    var TXT_WA = "Te comparto mi fantasma de RadioMap 👻. Desde este enlace podés seguir mi recorrido en tiempo real.";
    var STORAGE_KEY = "radiomap_fantasma";
    var api = null;
    var tokenActivo = "";
    var hostKeyActivo = "";
    var expActivo = 0;
    var compartiendo = false;
    var timerHost = 0;
    var timerReanudar = 0;
    var reanudarEnVuelo = false;
    var trail = [];
    var capas = { path: null, pathFondo: null, trail: null, dest: null };
    var ecos = [];
    var markerVivo = null;
    var lockMap = null;
    var ultimoPathKey = "";

    function $(id) {
        return api && api.$ ? api.$(id) : document.getElementById(id);
    }

    function tokenDeUrl() {
        try {
            return String(new URLSearchParams(window.location.search).get("fantasma") || "").trim();
        } catch (e) {
            return "";
        }
    }

    function esInvitado() {
        return !!tokenDeUrl();
    }

    function mostrar(el, si) {
        if (!el) return;
        el.classList.toggle("oculto", !si);
    }

    function urlPublica(token) {
        var path = window.location.pathname || "/";
        var origin = window.location.origin || "";
        return origin + path.replace(/\?.*$/, "").replace(/#.*$/, "") + "?fantasma=" + encodeURIComponent(token);
    }

    function abrirWhatsApp(token) {
        var url = urlPublica(token);
        var texto = TXT_WA + " " + url;
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

    function pintarBoton() {
        var btns = [$("btnFantasmaMapa"), $("btnFantasmaDock")];
        var i;
        for (i = 0; i < btns.length; i++) {
            var btn = btns[i];
            if (!btn) continue;
            btn.classList.toggle("activo", compartiendo);
            var txt = btn.querySelector("span:not(.atajo-ico)");
            if (txt && btn.id === "btnFantasmaMapa") {
                txt.textContent = compartiendo ? "Cortar fantasma" : "Compartir fantasma";
            } else if (txt) {
                txt.textContent = compartiendo ? "Cortar" : "Fantasma";
            }
            btn.title = compartiendo
                ? "Dejar de compartir tu recorrido"
                : "Compartir tu recorrido por WhatsApp";
            btn.setAttribute("aria-pressed", compartiendo ? "true" : "false");
        }
    }

    function escHtml(s) {
        return String(s || "").replace(/[&<>"']/g, function (c) {
            return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
        });
    }

    function iconoFantasma(snap) {
        var nom = escHtml((snap && snap.nombre) || "Fantasma");
        var svg = '<svg class="fantasma-auto-svg" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M5 16.5h14l1.2-4.2c.2-.6 0-1.2-.5-1.6L16 8.2H8L4.3 10.7c-.5.4-.7 1-.5 1.6L5 16.5z" fill="#1e4b7b" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>' +
            '<circle cx="7.2" cy="16.6" r="1.7" fill="#243848" stroke="#fff" stroke-width="1.2"/>' +
            '<circle cx="16.8" cy="16.6" r="1.7" fill="#243848" stroke="#fff" stroke-width="1.2"/>' +
            "</svg>";
        var inner = "";
        if (api.crearIcono) {
            var xy = { x: (snap && snap.iconoX) || 0, y: (snap && snap.iconoY) || 0 };
            var icoTmp = api.crearIcono(false, xy);
            inner = (icoTmp && icoTmp.options && icoTmp.options.html) || "";
        }
        return L.divIcon({
            className: "marker-auto marker-otro marker-fantasma-vivo",
            html: '<span class="fantasma-halo" aria-hidden="true"></span>' +
                '<div class="fantasma-auto">' + svg + inner + "</div>" +
                '<span class="fantasma-etiqueta">' + nom + "</span>",
            iconSize: [64, 86],
            iconAnchor: [32, 44]
        });
    }

    function rumboCss(el, deg) {
        if (!el || !Number.isFinite(Number(deg))) return;
        var rot = el.querySelector(".auto-rot") || el.querySelector(".fantasma-rot");
        if (rot) rot.style.transform = "rotate(" + Number(deg) + "deg)";
    }

    function quitarCapas() {
        ["path", "pathFondo", "trail", "dest"].forEach(function (k) {
            if (capas[k] && api.map) {
                api.map.removeLayer(capas[k]);
                capas[k] = null;
            }
        });
        ecos.forEach(function (m) {
            if (m && api.map) api.map.removeLayer(m);
        });
        ecos = [];
        if (markerVivo && api.map) {
            api.map.removeLayer(markerVivo);
            markerVivo = null;
        }
        ultimoPathKey = "";
    }

    function aligerar(pts, maxN) {
        if (!pts || pts.length <= maxN) return pts ? pts.slice() : [];
        var step = (pts.length - 1) / (maxN - 1);
        var out = [];
        var i;
        for (i = 0; i < maxN; i++) out.push(pts[Math.round(i * step)]);
        return out;
    }

    function pushTrail(lat, lng) {
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        var last = trail[trail.length - 1];
        if (last && api.metrosEntre) {
            if (api.metrosEntre(last, [lat, lng]) < 12) return;
        } else if (last) {
            var dlat = last[0] - lat;
            var dlng = last[1] - lng;
            if ((dlat * dlat + dlng * dlng) < 0.00000002) return;
        }
        trail.push([lat, lng]);
        if (trail.length > 80) trail.shift();
    }

    function snapshotHost() {
        var pos = api.posicion ? api.posicion() : null;
        if (!pos || !Number.isFinite(pos.lat)) return null;
        pushTrail(pos.lat, pos.lng);
        var nav = api.navegacion ? api.navegacion() : null;
        var dest = nav && nav.dest ? nav.dest : null;
        var path = nav && nav.path ? aligerar(nav.path, 120) : [];
        var ico = api.icono ? api.icono() : { x: 0, y: 0 };
        return {
            lat: pos.lat,
            lng: pos.lng,
            rumbo: pos.rumbo,
            vel: pos.velocidad || 0,
            clat: pos.lat,
            clng: pos.lng,
            zoom: 16,
            bearing: 0,
            navGps: !!api.navGps(),
            path: path,
            trail: trail.slice(),
            dest: dest && dest.length >= 2 ? [dest[0], dest[1]] : null,
            nombre: api.nombre ? api.nombre() : "Alguien",
            vehiculo: api.vehiculo ? api.vehiculo() : "",
            iconoX: ico.x || 0,
            iconoY: ico.y || 0
        };
    }

    function emitirVista() {
        if (!compartiendo || !api.socket) return;
        var snap = snapshotHost();
        if (!snap) return;
        api.socket.emit("fantasmaVista", snap);
        var ahora = Date.now();
        if (!emitirVista._save || ahora - emitirVista._save > 4000) {
            emitirVista._save = ahora;
            guardarSesion();
        }
    }

    function lockMapa(si) {
        var map = api.map;
        if (!map) return;
        if (!lockMap) {
            lockMap = {
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
            if (map.tap && map.tap.disable) map.tap.disable();
            if (map.touchRotate && map.touchRotate.disable) map.touchRotate.disable();
        } else if (lockMap) {
            if (lockMap.drag) map.dragging.enable();
            if (lockMap.touch) map.touchZoom.enable();
            if (lockMap.dbl) map.doubleClickZoom.enable();
            if (lockMap.scroll) map.scrollWheelZoom.enable();
            if (lockMap.box) map.boxZoom.enable();
            if (lockMap.key) map.keyboard.enable();
        }
    }

    function pintarPath(pts) {
        var key = pts && pts.length ? (pts.length + ":" + pts[0][0] + "," + pts[pts.length - 1][0]) : "";
        if (key === ultimoPathKey) return;
        ultimoPathKey = key;
        if (capas.path) api.map.removeLayer(capas.path);
        if (capas.pathFondo) api.map.removeLayer(capas.pathFondo);
        capas.path = null;
        capas.pathFondo = null;
        if (!pts || pts.length < 2) return;
        capas.pathFondo = L.polyline(pts, {
            color: "#fff",
            weight: 8,
            opacity: 0.72,
            interactive: false
        }).addTo(api.map);
        capas.path = L.polyline(pts, {
            color: "#1e4b7b",
            weight: 5,
            opacity: 0.88,
            interactive: false
        }).addTo(api.map);
    }

    function pintarTrail(pts) {
        if (capas.trail) {
            api.map.removeLayer(capas.trail);
            capas.trail = null;
        }
        if (!pts || pts.length < 2) return;
        capas.trail = L.polyline(pts, {
            color: "#8fb4d4",
            weight: 4,
            opacity: 0.55,
            dashArray: "1 10",
            lineCap: "round",
            interactive: false
        }).addTo(api.map);
    }

    function pintarDestino(dest) {
        if (!dest) {
            if (capas.dest) {
                api.map.removeLayer(capas.dest);
                capas.dest = null;
            }
            return;
        }
        if (!capas.dest) {
            capas.dest = L.circleMarker(dest, {
                radius: 7,
                color: "#fff",
                weight: 2,
                fillColor: "#1e4b7b",
                fillOpacity: 0.9,
                interactive: false
            }).addTo(api.map);
        } else {
            capas.dest.setLatLng(dest);
        }
    }

    function moverEcos(ll) {
        var i;
        var prev = ll;
        for (i = 0; i < ecos.length; i++) {
            var cur = ecos[i].getLatLng();
            ecos[i].setLatLng(prev);
            prev = cur;
        }
    }

    function asegurarEcos(ll) {
        var i;
        if (!ecos.length) {
            for (i = 0; i < 3; i++) {
                ecos.push(L.marker(ll, {
                    icon: L.divIcon({
                        className: "marker-fantasma-eco eco-" + i,
                        html: '<span class="fantasma-eco"></span>',
                        iconSize: [18, 18],
                        iconAnchor: [9, 9]
                    }),
                    interactive: false,
                    keyboard: false,
                    zIndexOffset: 800 - i
                }).addTo(api.map));
            }
            return;
        }
        for (i = 0; i < ecos.length; i++) {
            if (ecos[i] && ecos[i].getLatLng && ecos[i].getLatLng().lat === 0 && ecos[i].getLatLng().lng === 0) {
                ecos[i].setLatLng(ll);
            }
        }
    }

    function aplicarVista(snap) {
        if (!snap || !api.map) return;
        var lat = Number(snap.lat);
        var lng = Number(snap.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        var ll = [lat, lng];
        var z = Number(snap.zoom);
        if (!Number.isFinite(z) || z < 15) z = 16;
        if (z > 18) z = 18;
        api.map.setView(ll, z, { animate: false });
        if (!markerVivo) {
            markerVivo = L.marker(ll, {
                icon: iconoFantasma(snap),
                zIndexOffset: 2400,
                interactive: false,
                keyboard: false,
                title: snap.nombre || "Fantasma"
            }).addTo(api.map);
            markerVivo._iconKey = String(snap.iconoX || 0) + ":" + String(snap.iconoY || 0) + ":" + String(snap.nombre || "");
            asegurarEcos(ll);
        } else {
            moverEcos(markerVivo.getLatLng());
            markerVivo.setLatLng(ll);
            var key = String(snap.iconoX || 0) + ":" + String(snap.iconoY || 0) + ":" + String(snap.nombre || "");
            if (markerVivo._iconKey !== key) {
                markerVivo.setIcon(iconoFantasma(snap));
                markerVivo._iconKey = key;
            }
        }
        rumboCss(markerVivo.getElement(), snap.rumbo);
        pintarPath(snap.path);
        pintarTrail(snap.trail);
        pintarDestino(snap.dest);
        var nom = $("fantasmaBannerNom");
        if (nom && snap.nombre) nom.textContent = snap.nombre;
    }

    function setBannerInvitado(nombre, error, pausa) {
        var b = $("fantasmaBanner");
        var nom = $("fantasmaBannerNom");
        var sub = $("fantasmaBannerSub");
        mostrar(b, true);
        if (nom) nom.textContent = nombre || "alguien";
        if (sub) {
            if (error) sub.textContent = error;
            else if (pausa) sub.textContent = "Sin señal · el walkie sigue; cuando vuelva se retoma";
            else sub.textContent = "Walkie abierto · mantené el micrófono para hablarle";
        }
        if (b) {
            b.classList.toggle("error", !!error);
            b.classList.toggle("pausa", !!pausa && !error);
        }
        if (document.body) document.body.classList.toggle("fantasma-pausa", !!pausa && !error);
    }

    function iniciarHostTimer() {
        if (timerHost) clearInterval(timerHost);
        emitirVista();
        timerHost = setInterval(emitirVista, 350);
    }

    function detenerHostTimer() {
        if (timerHost) {
            clearInterval(timerHost);
            timerHost = 0;
        }
    }

    function guardarSesion() {
        try {
            if (!tokenActivo) {
                localStorage.removeItem(STORAGE_KEY);
                sessionStorage.removeItem(STORAGE_KEY);
                return;
            }
            var data = {
                token: tokenActivo,
                hostKey: hostKeyActivo || "",
                exp: expActivo || (Date.now() + 8 * 60 * 60 * 1000),
                trail: trail.slice(-80)
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            sessionStorage.removeItem(STORAGE_KEY);
        } catch (e) {}
    }

    function leerSesionGuardada() {
        var raw = "";
        try { raw = localStorage.getItem(STORAGE_KEY) || ""; } catch (e) { raw = ""; }
        if (!raw) {
            try { raw = sessionStorage.getItem(STORAGE_KEY) || ""; } catch (e2) { raw = ""; }
        }
        if (!raw) return null;
        try {
            if (raw.charAt(0) !== "{") {
                return { token: raw, hostKey: "", exp: Date.now() + 8 * 60 * 60 * 1000, trail: [] };
            }
            var o = JSON.parse(raw);
            if (!o || !o.token) return null;
            if (o.exp && Date.now() > Number(o.exp)) return null;
            return {
                token: String(o.token),
                hostKey: o.hostKey ? String(o.hostKey) : "",
                exp: Number(o.exp) || 0,
                trail: Array.isArray(o.trail) ? o.trail : []
            };
        } catch (e) {
            return null;
        }
    }

    function aplicarSesion(ses) {
        if (!ses || !ses.token) {
            tokenActivo = "";
            hostKeyActivo = "";
            expActivo = 0;
            return;
        }
        tokenActivo = ses.token;
        hostKeyActivo = ses.hostKey || "";
        expActivo = ses.exp || 0;
        if (ses.trail && ses.trail.length) trail = ses.trail.slice(-80);
    }

    function cortarLocal() {
        compartiendo = false;
        tokenActivo = "";
        hostKeyActivo = "";
        expActivo = 0;
        trail = [];
        guardarSesion();
        detenerHostTimer();
        pintarBoton();
    }

    function hostListo() {
        var pos = api && api.posicion ? api.posicion() : null;
        return !!(pos && Number.isFinite(pos.lat) && api.socket && api.socket.connected);
    }

    function programarReanudar() {
        if (timerReanudar || esInvitado() || !compartiendo || !tokenActivo) return;
        timerReanudar = setTimeout(function () {
            timerReanudar = 0;
            reanudarHost();
        }, 800);
    }

    function reanudarHost() {
        if (esInvitado() || !compartiendo || !tokenActivo) return;
        if (timerHost && api.socket && api.socket.connected) return;
        if (!hostListo()) {
            programarReanudar();
            return;
        }
        if (reanudarEnVuelo) return;
        reanudarEnVuelo = true;
        api.socket.emit("fantasmaCrear", { token: tokenActivo, hostKey: hostKeyActivo }, function (res) {
            reanudarEnVuelo = false;
            if (res && res.ok && res.token) {
                tokenActivo = res.token;
                if (res.hostKey) hostKeyActivo = res.hostKey;
                if (res.exp) expActivo = res.exp;
                guardarSesion();
                pintarBoton();
                iniciarHostTimer();
                return;
            }
            if (res && res.retry) {
                programarReanudar();
                return;
            }
            if (res && res.error && String(res.error).indexOf("ya no") >= 0) cortarLocal();
            else programarReanudar();
        });
    }

    function onGpsListo() {
        if (compartiendo && tokenActivo && !timerHost) reanudarHost();
    }

    function compartir() {
        if (esInvitado()) return;
        if (compartiendo) {
            if (!api.socket) {
                cortarLocal();
                return;
            }
            api.socket.emit("fantasmaCortar", {}, function () {
                cortarLocal();
            });
            return;
        }
        var pos = api.posicion ? api.posicion() : null;
        if (!pos || !Number.isFinite(pos.lat)) {
            alert("Esperá a que el GPS te ubique en el mapa.");
            return;
        }
        if (!api.socket || !api.socket.connected) {
            alert("Sin conexión. Probá de nuevo en un momento.");
            return;
        }
        var ses = leerSesionGuardada();
        api.socket.emit("fantasmaCrear", {
            token: tokenActivo || (ses && ses.token) || "",
            hostKey: hostKeyActivo || (ses && ses.hostKey) || ""
        }, function (res) {
            if (!res || !res.ok || !res.token) {
                alert((res && res.error) || "No se pudo compartir el fantasma.");
                return;
            }
            tokenActivo = res.token;
            hostKeyActivo = res.hostKey || hostKeyActivo;
            expActivo = res.exp || (Date.now() + 8 * 60 * 60 * 1000);
            compartiendo = true;
            if (!res.reanudado) trail = [];
            guardarSesion();
            pintarBoton();
            iniciarHostTimer();
            if (!res.reanudado) abrirWhatsApp(res.token);
        });
    }

    function salirInvitado() {
        try {
            var u = new URL(window.location.href);
            u.searchParams.delete("fantasma");
            window.location.href = u.pathname + (u.search || "") + u.hash;
        } catch (e) {
            window.location.href = "/";
        }
    }

    function marcarChromeInerte(si) {
        var sels = [".hud-top", ".comms-panel", ".radio-cerca"];
        var i;
        for (i = 0; i < sels.length; i++) {
            document.querySelectorAll(sels[i]).forEach(function (el) {
                try { el.inert = !!si; } catch (e) {}
            });
        }
        document.querySelectorAll(".mapa-atajos .atajo-pill, .dock-mapa .dock-item, .dock-mas-item").forEach(function (el) {
            try { el.inert = !!si; } catch (e2) {}
        });
    }

    function unirseComoInvitado() {
        var token = tokenDeUrl();
        if (!token || !api.socket) return;
        document.body.classList.add("modo-fantasma-invitado");
        marcarChromeInerte(true);
        lockMapa(true);
        setBannerInvitado("…", "");
        var portada = $("portada");
        if (portada) portada.classList.add("oculto");
        api.socket.emit("fantasmaUnirse", {
            token: token,
            nombre: api.nombre ? api.nombre() : ""
        }, function (res) {
            if (!res || !res.ok) {
                setBannerInvitado("RadioMap", (res && res.error) || "Ese fantasma ya no está al aire.");
                return;
            }
            if (res.vista) aplicarVista(res.vista);
            setBannerInvitado(res.nombre || (res.vista && res.vista.nombre) || "alguien", "", !!res.pausa);
            if (!res.vista && !markerVivo) {
                var sub = $("fantasmaBannerSub");
                if (sub && !res.pausa) sub.textContent = "Buscando su punto en el mapa…";
            }
        });
    }

    function engancharSocket() {
        if (!api.socket || api.socket._fantasmaOk) return;
        api.socket._fantasmaOk = true;
        api.socket.on("fantasmaVista", function (snap) {
            if (!esInvitado()) return;
            aplicarVista(snap);
            setBannerInvitado((snap && snap.nombre) || "alguien", "", snap && snap.vivo === false);
        });
        api.socket.on("fantasmaPausa", function (d) {
            if (!esInvitado()) return;
            setBannerInvitado((d && d.nombre) || "alguien", "", !!(d && d.pausa));
        });
        api.socket.on("fantasmaFin", function (d) {
            var motivo = d && d.motivo ? String(d.motivo) : "";
            if (esInvitado()) {
                if (motivo === "desconexion") {
                    setBannerInvitado("alguien", "", true);
                    return;
                }
                setBannerInvitado("RadioMap",
                    motivo === "expiro"
                        ? "Ese fantasma llegó al final del viaje (8 h). Pedile un enlace nuevo."
                        : "El fantasma se cortó. Quien lo compartió dejó de emitir.",
                    false);
                return;
            }
            cortarLocal();
        });
        api.socket.on("connect", function () {
            if (esInvitado()) unirseComoInvitado();
            else reanudarHost();
        });
    }

    function init(opts) {
        api = opts || {};
        if (!esInvitado()) {
            var saved = leerSesionGuardada();
            if (saved) {
                aplicarSesion(saved);
                compartiendo = true;
            }
        } else if (document.body) {
            document.body.classList.add("modo-fantasma-invitado");
            var portada = $("portada");
            if (portada) portada.classList.add("oculto");
        }
        pintarBoton();
        var btn = $("btnFantasmaMapa");
        if (btn) btn.addEventListener("click", compartir);
        var dock = $("btnFantasmaDock");
        if (dock) dock.addEventListener("click", compartir);
        var salir = $("btnFantasmaSalir");
        if (salir) salir.addEventListener("click", salirInvitado);
        engancharSocket();
        if (esInvitado()) unirseComoInvitado();
        else reanudarHost();
        document.addEventListener("visibilitychange", function () {
            if (document.visibilityState !== "visible") return;
            if (esInvitado()) unirseComoInvitado();
            else {
                reanudarHost();
                emitirVista();
            }
        });
        window.addEventListener("online", function () {
            if (esInvitado()) unirseComoInvitado();
            else reanudarHost();
        });
        window.addEventListener("pageshow", function () {
            if (esInvitado()) unirseComoInvitado();
            else reanudarHost();
        });
    }

    if (tokenDeUrl() && document.body) {
        document.body.classList.add("modo-fantasma-invitado");
        var p0 = document.getElementById("portada");
        if (p0) p0.classList.add("oculto");
    }

    global.RadioMapFantasma = {
        init: init,
        esInvitado: esInvitado,
        activo: function () { return compartiendo; },
        onGps: onGpsListo,
        consumeClick: function () { return esInvitado(); }
    };
})(window);
