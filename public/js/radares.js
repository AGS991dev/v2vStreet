// ===================================================
// RadioMap – Radares fijos de velocidad máxima
// Catálogo estático (sin sockets). Cada cliente baja solo
// el manifiesto + las baldosas de su radio, o un catálogo
// único si el listado todavía es chico. Los markers se
// pintan en el dispositivo, nunca los emite el servidor.
// ===================================================
(function (global) {
    "use strict";

    var BASE = "static/radares/";
    var STORAGE = "radiomap_radares";
    var MAX_MARKERS = 72;
    var MOVE_M = 160;
    var LRU_MAX = 18;

    var api = null;
    var activo = false;
    var manifest = null;
    var catalogo = null;
    var tiles = {};
    var inflight = {};
    var lru = [];
    var capa = null;
    var markers = {};
    var ultimo = { lat: null, lng: null, km: null };
    var timer = 0;
    var rotateHook = false;

    function $(id) {
        return api && api.$ ? api.$(id) : document.getElementById(id);
    }

    function leerToggle() {
        try {
            var v = localStorage.getItem(STORAGE);
            if (v === null) return true;
            return v === "1";
        } catch (e) { return true; }
    }

    function guardarToggle() {
        try { localStorage.setItem(STORAGE, activo ? "1" : "0"); } catch (e) {}
    }

    function carreraOn() {
        return !!(api && api.carreraBloquea && api.carreraBloquea());
    }

    function seVen() {
        return !!(activo && !carreraOn() && api && api.map);
    }

    function posActual() {
        var p = api && api.posicion ? api.posicion() : null;
        if (!p || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) return null;
        return { lat: Number(p.lat), lng: Number(p.lng) };
    }

    function radioKm() {
        var n = api && api.radioKm ? Number(api.radioKm()) : 3;
        return Number.isFinite(n) && n > 0 ? Math.min(10, n) : 3;
    }

    function distKm(a, b) {
        if (api && api.calcularDistanciaKm) return api.calcularDistanciaKm(a.lat, a.lng, b.lat, b.lng);
        var dLat = (b.lat - a.lat) * Math.PI / 180;
        var dLng = (b.lng - a.lng) * Math.PI / 180;
        var s1 = Math.sin(dLat / 2);
        var s2 = Math.sin(dLng / 2);
        var h = s1 * s1 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * s2 * s2;
        return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    function qs(v) {
        return "?v=" + encodeURIComponent(v || "0");
    }

    function fetchJson(url) {
        return fetch(url, { cache: "force-cache" }).then(function (res) {
            if (!res.ok) throw new Error("radares " + res.status);
            return res.json();
        });
    }

    function parsePuntos(raw, fallbackTile) {
        var arr = raw && Array.isArray(raw.p) ? raw.p : [];
        var out = [];
        var i;
        for (i = 0; i < arr.length; i++) {
            var row = arr[i];
            if (!row || row.length < 4) continue;
            var lat = Number(row[1]);
            var lng = Number(row[2]);
            var vmax = parseInt(row[3], 10);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || !vmax) continue;
            out.push({
                id: String(row[0] || (fallbackTile + ":" + i)),
                lat: lat,
                lng: lng,
                vmax: vmax
            });
        }
        return out;
    }

    function tileDeg() {
        var d = manifest && Number(manifest.tileDeg);
        return Number.isFinite(d) && d > 0 ? d : 2;
    }

    function tilesParaRadio(pos, km) {
        var d = tileDeg();
        var pad = (km + 0.3) / 111.32;
        var lat0 = pos.lat - pad;
        var lat1 = pos.lat + pad;
        var lngPad = pad / Math.max(0.3, Math.cos(pos.lat * Math.PI / 180));
        var lng0 = pos.lng - lngPad;
        var lng1 = pos.lng + lngPad;
        var iy0 = Math.floor(lat0 / d);
        var iy1 = Math.floor(lat1 / d);
        var ix0 = Math.floor(lng0 / d);
        var ix1 = Math.floor(lng1 / d);
        var keys = [];
        var iy, ix, k;
        var conocidos = manifest && Array.isArray(manifest.tiles) ? manifest.tiles : null;
        var set = null;
        if (conocidos) {
            set = Object.create(null);
            for (iy = 0; iy < conocidos.length; iy++) set[conocidos[iy]] = 1;
        }
        for (iy = iy0; iy <= iy1; iy++) {
            for (ix = ix0; ix <= ix1; ix++) {
                k = iy + "_" + ix;
                if (set && !set[k]) continue;
                keys.push(k);
            }
        }
        return keys;
    }

    function tocarLru(key) {
        var i = lru.indexOf(key);
        if (i >= 0) lru.splice(i, 1);
        lru.push(key);
        while (lru.length > LRU_MAX) {
            var vieja = lru.shift();
            if (vieja && tiles[vieja] && inflight[vieja] == null) delete tiles[vieja];
        }
    }

    function asegurarManifest() {
        if (manifest) return Promise.resolve(manifest);
        return fetch(BASE + "manifest.json", { cache: "no-cache" }).then(function (res) {
            if (!res.ok) throw new Error("radares " + res.status);
            return res.json();
        }).then(function (m) {
            manifest = m || {};
            return manifest;
        });
    }

    function cargarCatalogo() {
        if (catalogo) return Promise.resolve(catalogo);
        var v = (manifest && manifest.v) || "0";
        return fetchJson(BASE + "catalogo.json" + qs(v)).then(function (raw) {
            catalogo = parsePuntos(raw, "c");
            return catalogo;
        });
    }

    function cargarTile(key) {
        if (tiles[key]) {
            tocarLru(key);
            return Promise.resolve(tiles[key]);
        }
        if (inflight[key]) return inflight[key];
        var v = (manifest && manifest.v) || "0";
        inflight[key] = fetchJson(BASE + "t/" + encodeURIComponent(key) + ".json" + qs(v)).then(function (raw) {
            tiles[key] = parsePuntos(raw, key);
            tocarLru(key);
            delete inflight[key];
            return tiles[key];
        }).catch(function () {
            tiles[key] = [];
            tocarLru(key);
            delete inflight[key];
            return tiles[key];
        });
        return inflight[key];
    }

    function puntosCargados() {
        if (catalogo && catalogo.length) return catalogo;
        var acc = [];
        var k;
        for (k in tiles) {
            if (Object.prototype.hasOwnProperty.call(tiles, k) && tiles[k] && tiles[k].length) {
                acc = acc.concat(tiles[k]);
            }
        }
        return acc.length ? acc : null;
    }

    function limiteCercano(lat, lng) {
        var pos = { lat: Number(lat), lng: Number(lng) };
        if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return null;
        var todos = puntosCargados();
        if (!todos) {
            asegurarManifest().then(function () {
                if (manifest && manifest.modo === "baldosas") {
                    return Promise.all(tilesParaRadio(pos, 1).map(cargarTile));
                }
                return cargarCatalogo();
            }).catch(function () {});
            return null;
        }
        var best = null;
        var i, r, d;
        for (i = 0; i < todos.length; i++) {
            r = todos[i];
            d = distKm(pos, r);
            if (d > 0.45) continue;
            if (!best || d < best.dist) best = { vmax: r.vmax, dist: d };
        }
        return best;
    }

    function puntosCercanos(pos, km) {
        var modo = manifest && manifest.modo;
        var promesa;
        if (modo === "baldosas") {
            promesa = Promise.all(tilesParaRadio(pos, km).map(cargarTile)).then(function (listas) {
                var acc = [];
                listas.forEach(function (arr) {
                    if (arr && arr.length) acc = acc.concat(arr);
                });
                return acc;
            });
        } else {
            promesa = cargarCatalogo();
        }
        return promesa.then(function (todos) {
            var radio = km + 0.05;
            var i, r, d, ok = [];
            for (i = 0; i < todos.length; i++) {
                r = todos[i];
                d = distKm(pos, r);
                if (d <= radio) ok.push({ id: r.id, lat: r.lat, lng: r.lng, vmax: r.vmax, dist: d });
            }
            ok.sort(function (a, b) { return a.dist - b.dist; });
            if (ok.length > MAX_MARKERS) ok = ok.slice(0, MAX_MARKERS);
            return ok;
        });
    }

    function htmlPin(vmax) {
        return '<div class="radar-pin" aria-hidden="true"><span class="radar-num">' +
            String(vmax) + "</span></div>";
    }

    function iconoDe(vmax) {
        return L.divIcon({
            className: "marker-radar",
            html: htmlPin(vmax),
            iconSize: [28, 28],
            iconAnchor: [14, 14],
            tooltipAnchor: [0, -14]
        });
    }

    function asegurarCapa() {
        if (capa || !api || !api.map) return;
        capa = L.layerGroup().addTo(api.map);
        if (!rotateHook) {
            rotateHook = true;
            api.map.on("rotate", enderezarPins);
        }
    }

    function enderezarPins() {
        if (!capa || !api || !api.map || !api.map.getBearing) return;
        var b = api.map.getBearing();
        if (!Number.isFinite(b)) b = 0;
        var rot = "rotate(" + (-b) + "deg)";
        capa.eachLayer(function (m) {
            var el = m.getElement && m.getElement();
            var pin = el && el.querySelector && el.querySelector(".radar-pin");
            if (pin) pin.style.transform = rot;
        });
    }

    function quitarTodos() {
        var id;
        for (id in markers) {
            if (!Object.prototype.hasOwnProperty.call(markers, id)) continue;
            if (capa && markers[id]) capa.removeLayer(markers[id]);
            delete markers[id];
        }
        if (capa && api && api.map && api.map.hasLayer && api.map.hasLayer(capa)) {
            api.map.removeLayer(capa);
        }
        capa = null;
        ultimo.lat = null;
        ultimo.lng = null;
        ultimo.km = null;
    }

    function syncMarkers(lista) {
        asegurarCapa();
        if (!capa) return;
        if (api.map && !api.map.hasLayer(capa)) capa.addTo(api.map);
        var vivos = Object.create(null);
        var i, r, m;
        for (i = 0; i < lista.length; i++) {
            r = lista[i];
            vivos[r.id] = 1;
            m = markers[r.id];
            if (m) continue;
            m = L.marker([r.lat, r.lng], {
                icon: iconoDe(r.vmax),
                keyboard: false,
                zIndexOffset: 220,
                riseOnHover: true,
                title: "Radar " + r.vmax + " km/h"
            });
            m.bindTooltip("Radar " + r.vmax + " km/h", {
                direction: "top",
                opacity: 0.92,
                className: "tip-radar"
            });
            m.addTo(capa);
            markers[r.id] = m;
        }
        for (i in markers) {
            if (!Object.prototype.hasOwnProperty.call(markers, i)) continue;
            if (vivos[i]) continue;
            capa.removeLayer(markers[i]);
            delete markers[i];
        }
        enderezarPins();
    }

    function refrescar(forzar) {
        if (!seVen()) {
            quitarTodos();
            pintarBoton();
            return;
        }
        var pos = posActual();
        if (!pos) {
            pintarBoton();
            return;
        }
        var km = radioKm();
        if (!forzar && ultimo.lat != null) {
            var moved = distKm(pos, { lat: ultimo.lat, lng: ultimo.lng }) * 1000;
            if (moved < MOVE_M && ultimo.km === km) return;
        }
        ultimo.lat = pos.lat;
        ultimo.lng = pos.lng;
        ultimo.km = km;
        asegurarManifest().then(function () {
            if (!seVen()) return;
            return puntosCercanos(pos, km);
        }).then(function (lista) {
            if (!seVen()) {
                quitarTodos();
                return;
            }
            if (!lista) return;
            syncMarkers(lista);
        }).catch(function () {});
        pintarBoton();
    }

    function pedirRefresco(forzar) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
            timer = 0;
            refrescar(!!forzar);
        }, forzar ? 40 : 280);
    }

    function pintarBoton() {
        var btn = $("btnRadares");
        if (!btn) return;
        btn.classList.toggle("on", activo);
        btn.setAttribute("aria-pressed", activo ? "true" : "false");
        btn.title = activo
            ? "Radares de velocidad visibles en el alcance de la radio. Tocá para ocultarlos."
            : "Mostrar radares de velocidad máxima dentro del alcance de la radio";
    }

    function alternar() {
        activo = !activo;
        guardarToggle();
        pintarBoton();
        pedirRefresco(true);
    }

    function onGps() {
        if (!seVen()) {
            if (capa) {
                quitarTodos();
                pintarBoton();
            }
            return;
        }
        pedirRefresco(false);
    }

    function onRadio() {
        if (!seVen()) return;
        pedirRefresco(true);
    }

    function onNavGps() {
        pedirRefresco(true);
    }

    function init(a) {
        api = a || {};
        activo = true;
        guardarToggle();
        var btn = $("btnRadares");
        if (btn) {
            btn.addEventListener("click", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                alternar();
            });
        }
        pintarBoton();
        asegurarManifest().then(function () {
            if (manifest && manifest.modo !== "baldosas") return cargarCatalogo();
        }).catch(function () {});
        if (seVen()) pedirRefresco(true);
    }

    global.RadioMapRadares = {
        init: init,
        onGps: onGps,
        onRadio: onRadio,
        onNavGps: onNavGps,
        activo: function () { return activo; },
        limiteCercano: limiteCercano
    };
})(window);
