// ===================================================
// RadioMap – Compartir Fantasma
// El anfitrión emite su vista; el invitado solo mira.
// ===================================================
(function (global) {
    "use strict";

    var TXT_WA = "Te comparto mi fantasma de RadioMap 👻. Desde este enlace podés seguir mi recorrido en tiempo real.";
    var api = null;
    var tokenActivo = "";
    var compartiendo = false;
    var timerHost = 0;
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

    function iconoFantasma() {
        return L.divIcon({
            className: "marker-fantasma-vivo",
            html: '<div class="fantasma-rot">' +
                '<span class="fantasma-halo" aria-hidden="true"></span>' +
                '<span class="fantasma-cuerpo" aria-hidden="true"></span>' +
                "</div>",
            iconSize: [44, 52],
            iconAnchor: [22, 30]
        });
    }

    function rumboCss(el, deg) {
        if (!el || !Number.isFinite(Number(deg))) return;
        var rot = el.querySelector(".fantasma-rot");
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
        var c = api.map.getCenter();
        var bearing = 0;
        if (typeof api.map.getBearing === "function") bearing = api.map.getBearing();
        var nav = api.navegacion ? api.navegacion() : null;
        var dest = nav && nav.dest ? nav.dest : null;
        var path = nav && nav.path ? aligerar(nav.path, 120) : [];
        return {
            lat: pos.lat,
            lng: pos.lng,
            rumbo: pos.rumbo,
            vel: pos.velocidad || 0,
            clat: c.lat,
            clng: c.lng,
            zoom: api.map.getZoom(),
            bearing: bearing,
            navGps: !!api.navGps(),
            path: path,
            trail: trail.slice(),
            dest: dest && dest.length >= 2 ? [dest[0], dest[1]] : null,
            nombre: api.nombre ? api.nombre() : "Alguien"
        };
    }

    function emitirVista() {
        if (!compartiendo || !api.socket) return;
        var snap = snapshotHost();
        if (!snap) return;
        api.socket.emit("fantasmaVista", snap);
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

    function asegurarEcos() {
        if (ecos.length) return;
        var i;
        for (i = 0; i < 3; i++) {
            ecos.push(L.marker([0, 0], {
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
    }

    function aplicarVista(snap) {
        if (!snap || !api.map) return;
        if (Number.isFinite(snap.clat) && Number.isFinite(snap.clng)) {
            api.map.setView([snap.clat, snap.clng], snap.zoom || api.map.getZoom(), { animate: false });
        }
        if (typeof api.map.setBearing === "function" && Number.isFinite(snap.bearing)) {
            api.map.setBearing(snap.bearing);
        }
        var ll = [snap.lat, snap.lng];
        if (!markerVivo) {
            markerVivo = L.marker(ll, {
                icon: iconoFantasma(),
                zIndexOffset: 1400,
                interactive: false,
                keyboard: false,
                title: snap.nombre || "Fantasma"
            }).addTo(api.map);
            asegurarEcos();
        } else {
            moverEcos(markerVivo.getLatLng());
            markerVivo.setLatLng(ll);
        }
        rumboCss(markerVivo.getElement(), snap.rumbo);
        pintarPath(snap.path);
        pintarTrail(snap.trail);
        pintarDestino(snap.dest);
        var nom = $("fantasmaBannerNom");
        if (nom && snap.nombre) nom.textContent = snap.nombre;
    }

    function setBannerInvitado(nombre, error) {
        var b = $("fantasmaBanner");
        var nom = $("fantasmaBannerNom");
        var sub = $("fantasmaBannerSub");
        mostrar(b, true);
        if (nom) nom.textContent = nombre || "alguien";
        if (sub) {
            sub.textContent = error
                ? error
                : "Solo lectura · estás mirando su recorrido";
        }
        if (b) b.classList.toggle("error", !!error);
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

    function guardarToken(token) {
        tokenActivo = token || "";
        try {
            if (tokenActivo) sessionStorage.setItem("radiomap_fantasma", tokenActivo);
            else sessionStorage.removeItem("radiomap_fantasma");
        } catch (e) {}
    }

    function leerTokenGuardado() {
        try {
            return sessionStorage.getItem("radiomap_fantasma") || "";
        } catch (e) {
            return "";
        }
    }

    function cortarLocal() {
        compartiendo = false;
        guardarToken("");
        trail = [];
        detenerHostTimer();
        pintarBoton();
    }

    function compartir() {
        if (esInvitado()) return;
        if (compartiendo) {
            if (!api.socket) return;
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
        api.socket.emit("fantasmaCrear", {}, function (res) {
            if (!res || !res.ok || !res.token) {
                alert((res && res.error) || "No se pudo compartir el fantasma.");
                return;
            }
            guardarToken(res.token);
            compartiendo = true;
            trail = [];
            pintarBoton();
            iniciarHostTimer();
            abrirWhatsApp(res.token);
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
        var sels = [".hud-top", ".habla-mapa", ".dock-mapa", ".comms-panel", ".radio-cerca"];
        var i;
        for (i = 0; i < sels.length; i++) {
            document.querySelectorAll(sels[i]).forEach(function (el) {
                try { el.inert = !!si; } catch (e) {}
            });
        }
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
        api.socket.emit("fantasmaUnirse", { token: token }, function (res) {
            if (!res || !res.ok) {
                setBannerInvitado("RadioMap", (res && res.error) || "Ese fantasma ya no está al aire.");
                return;
            }
            setBannerInvitado(res.nombre || "alguien", "");
        });
    }

    function engancharSocket() {
        if (!api.socket || api.socket._fantasmaOk) return;
        api.socket._fantasmaOk = true;
        api.socket.on("fantasmaVista", function (snap) {
            if (!esInvitado()) return;
            aplicarVista(snap);
        });
        api.socket.on("fantasmaFin", function () {
            if (esInvitado()) {
                setBannerInvitado("RadioMap", "El fantasma se cortó. Quien lo compartió dejó de emitir.");
                quitarCapas();
                return;
            }
            cortarLocal();
        });
        api.socket.on("connect", function () {
            if (esInvitado()) unirseComoInvitado();
            else if (compartiendo && tokenActivo) {
                api.socket.emit("fantasmaCrear", {}, function (res) {
                    if (res && res.ok) {
                        if (res.token) guardarToken(res.token);
                        iniciarHostTimer();
                    } else cortarLocal();
                });
            }
        });
    }

    function init(opts) {
        api = opts || {};
        if (!esInvitado()) {
            var saved = leerTokenGuardado();
            if (saved) {
                tokenActivo = saved;
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
        else if (compartiendo && tokenActivo && api.socket && api.socket.connected) {
            api.socket.emit("fantasmaCrear", {}, function (res) {
                if (res && res.ok) {
                    if (res.token) guardarToken(res.token);
                    iniciarHostTimer();
                } else cortarLocal();
            });
        }
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
        consumeClick: function () { return esInvitado(); }
    };
})(window);
