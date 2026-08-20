// ===================================================
// V2V - SISTEMA PRINCIPAL FRONTEND
// Archivo: main.js
// ===================================================

(function () {
    "use strict";

    const CAMPOS = ["nombre", "vehiculo", "placa", "seguro", "contacto"];
    const GEO_OPTS = { enableHighAccuracy: true, maximumAge: 4000, timeout: 12000 };
    const GEO_PRIMERA = { enableHighAccuracy: false, maximumAge: 60000, timeout: 7000 };
    const GPS_LENTO_KMH = 10;
    const GPS_MUERTO_LENTO_M = 28;
    const GPS_MUERTO_RAPIDO_M = 12;
    const RUTA_MIN_M = 40;
    const MIC_OPTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
    const ICONO_KEY = "v2v_icono";
    const ICONO_CACHE = "20260820d";
    const ICO_MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>';
    const ICO_PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.6-7-11a7 7 0 1 1 14 0c0 6.4-7 11-7 11z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.2" fill="none" stroke="currentColor" stroke-width="1.75"/></svg>';

    function yaEntroMapa() {
        return localStorage.getItem("radiomap_entro") === "1" || localStorage.getItem("baliza_entro") === "1";
    }

    const miId = obtenerId();
    const socket = io({
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 4000,
        timeout: 20000
    });

    const map = L.map("map", {
        zoomControl: true,
        closePopupOnClick: false
    }).setView([-34.6037, -58.3816], 13);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap &copy; CARTO",
        maxZoom: 19
    }).addTo(map);

    const FICHA_BASE = {
        permanent: true,
        interactive: true,
        opacity: 1,
        className: "ficha"
    };

    const markers = {};
    const movimientos = {};
    const historialPrivado = {};
    const cacheSnap = {};
    const cacheRuta = {};
    let autos = {};
    let gpsSeq = 0;
    let miPosicion = null;
    let contactoActivo = null;
    let yaCentramos = false;
    let seguirMe = true;
    let noLeidos = 0;
    let ultimoEnvio = { ts: 0, lat: null, lng: null };
    let ultimoGpsCrudo = null;
    let gpsWatchId = null;
    let circuloRadio = null;
    let vistaRadio = false;
    let tabActiva = "general";
    let pttStream = null;
    let pttRecorder = null;
    let pttChunks = [];
    let pttModo = "general";
    let pttTimer = null;
    let pttActivo = false;
    let pttTranscripcion = "";
    let pttReconocimiento = null;
    let audioCtxPtt = null;
    let pttAckHecho = false;
    let popupsVisibles = true;
    let fichasForzadas = {};
    let introPaso = 0;
    let introGpsResuelto = false;
    let iconoCfg = { src: "static/iconos/autos.png", cols: 15, rows: 8, celdaCm: 2, celdaPx: 128 };
    let iconoMosaicoListo = false;
    let mosaicoImg = null;
    const recortesCelda = {};
    let radioTimer = null;

    function debeMostrarFicha(id) {
        if (fichasForzadas[id] === "cerrada") return false;
        if (fichasForzadas[id] === "abierta") return true;
        if (id === miId) return true;
        return popupsVisibles;
    }

    function abrirFicha(id) {
        fichasForzadas[id] = "abierta";
        const marker = markers[id];
        if (!marker) return;
        marker.openTooltip();
        requestAnimationFrame(function () { engancharFicha(marker, id); });
    }

    function cerrarFicha(id) {
        fichasForzadas[id] = "cerrada";
        const marker = markers[id];
        if (marker) marker.closeTooltip();
    }

    function engancharClickMarker(marker, id) {
        if (!marker || marker._clickFicha) return;
        marker._clickFicha = true;
        marker.on("click", function (ev) {
            L.DomEvent.stopPropagation(ev);
            abrirFicha(id);
        });
    }
    function fichaOpts(soyYo) {
        return Object.assign({}, FICHA_BASE, {
            direction: soyYo ? "bottom" : "top",
            offset: soyYo ? [0, 14] : [0, -16],
            className: "ficha" + (soyYo ? " ficha-propia" : "")
        });
    }

    function crearIcono(soyYo, xy) {
        xy = clampIcono(xy && xy.x, xy && xy.y);
        const rec = recorteCelda(xy.x, xy.y);
        const size = tamanioMarker(rec.w, rec.h);
        return L.divIcon({
            className: "marker-auto" + (soyYo ? " marker-propio" : " marker-otro"),
            html: '<div class="auto-rot"><img class="auto-cuerpo" alt="" width="' + size[0] + '" height="' + size[1] + '" src="' + rec.url + '"></div>',
            iconSize: size,
            iconAnchor: [Math.round(size[0] / 2), Math.round(size[1] / 2)]
        });
    }

    iniciarPerfil();
    iniciarMosaico();
    bindUi();
    if (yaEntroMapa()) iniciarGps();
    setTimeout(function () { map.invalidateSize(); }, 250);

    map.on("dragstart", function () {
        seguirMe = false;
    });

    // ===================================================
    // Identidad persistente (sobrevive reconexiones)
    // ===================================================
    function obtenerId() {
        let id = localStorage.getItem("v2v_id");
        if (!id) {
            id = "v" + Math.random().toString(36).slice(2) + Date.now().toString(36);
            localStorage.setItem("v2v_id", id);
        }
        return id;
    }

    function esc(texto) {
        return String(texto == null ? "" : texto)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function $(id) {
        return document.getElementById(id);
    }

    function iniciarPerfil() {
        CAMPOS.forEach(function (id) {
            const el = $(id);
            const val = localStorage.getItem(id);
            if (val) el.value = val;
            el.addEventListener("input", function () {
                localStorage.setItem(id, el.value);
                actualizarResumenPerfil();
                emitirTelemetria(true);
            });
        });
        actualizarResumenPerfil();
        pintarPreviewIcono();
    }

    function actualizarResumenPerfil() {
        const nombre = $("nombre").value.trim();
        const vehiculo = $("vehiculo").value.trim();
        $("perfilNombre").textContent = nombre || "Tu perfil";
        $("perfilHint").textContent = vehiculo
            ? vehiculo.toUpperCase()
            : "Tocá para completar tus datos";
        const badge = $("perfilEstado");
        if (badge) {
            if (miPosicion) badge.classList.remove("oculto");
            else badge.classList.add("oculto");
        }
    }

    function datosPropios() {
        const data = { id: miId };
        CAMPOS.forEach(function (c) {
            data[c] = $(c).value.trim();
        });
        const xy = leerIconoLocal();
        data.iconoX = xy.x;
        data.iconoY = xy.y;
        return data;
    }

    // ===================================================
    // Icono mosaico (x, y) persistido en localStorage
    // Carpeta: public/static/iconos/ — foto en autos.png
    // ===================================================
    function clampIcono(x, y) {
        const cols = Math.max(1, iconoCfg.cols || 1);
        const rows = Math.max(1, iconoCfg.rows || 1);
        return {
            x: Math.max(0, Math.min(cols - 1, Math.round(Number(x) || 0))),
            y: Math.max(0, Math.min(rows - 1, Math.round(Number(y) || 0)))
        };
    }

    function leerIconoLocal() {
        try {
            const raw = localStorage.getItem(ICONO_KEY);
            if (raw) {
                const o = JSON.parse(raw);
                if (o && Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.y))) {
                    return clampIcono(o.x, o.y);
                }
            }
        } catch (e) {}
        return { x: 0, y: 0 };
    }

    function guardarIconoLocal(x, y) {
        const xy = clampIcono(x, y);
        localStorage.setItem(ICONO_KEY, JSON.stringify({ x: xy.x, y: xy.y }));
        return xy;
    }

    function iconoDeAuto(a) {
        if (a && Number.isFinite(Number(a.iconoX)) && Number.isFinite(Number(a.iconoY))) {
            return clampIcono(a.iconoX, a.iconoY);
        }
        if (a && a.id === miId) return leerIconoLocal();
        return { x: 0, y: 0 };
    }

    function iniciarMosaico() {
        fetch("static/iconos/mosaico.json?v=" + ICONO_CACHE)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (cfg) {
                if (cfg && typeof cfg === "object") {
                    const cols = parseInt(cfg.cols, 10);
                    const rows = parseInt(cfg.rows, 10);
                    const celda = parseFloat(cfg.celdaCm);
                    const celdaPx = parseInt(cfg.celdaPx, 10);
                    if (cols > 0) iconoCfg.cols = cols;
                    if (rows > 0) iconoCfg.rows = rows;
                    if (celda > 0) iconoCfg.celdaCm = celda;
                    if (celdaPx > 0) iconoCfg.celdaPx = celdaPx;
                    if (cfg.archivo) {
                        iconoCfg.src = "static/iconos/" + String(cfg.archivo).replace(/^.*[\\/]/, "");
                    }
                }
            })
            .catch(function () {})
            .then(function () {
                const candidatos = [
                    iconoCfg.src,
                    "static/iconos/autos.png",
                    "static/iconos/autos.jpg",
                    "static/iconos/autos.webp",
                    "static/iconos/autos.svg"
                ];
                const vistos = {};
                const lista = [];
                candidatos.forEach(function (s) {
                    if (s && !vistos[s]) {
                        vistos[s] = true;
                        lista.push(s);
                    }
                });
                probarMosaico(lista, 0);
            });
    }

    function probarMosaico(lista, i) {
        if (i >= lista.length) {
            const hint = $("mosaicoHint");
            if (hint) hint.textContent = "Falta la foto mosaico en static/iconos/autos.png";
            return;
        }
        const src = lista[i];
        const img = new Image();
        img.onload = function () {
            mosaicoImg = img;
            Object.keys(recortesCelda).forEach(function (k) { delete recortesCelda[k]; });
            iconoCfg.src = src;
            aplicarCssMosaico(src);
            pintarPreviewIcono();
            Object.keys(markers).forEach(function (id) {
                const a = autos[id] || (id === miId ? datosPropios() : null);
                const marker = markers[id];
                if (marker) marker._iconoSrc = "";
                aplicarIconoEnMarker(id, iconoDeAuto(a));
            });
        };
        img.onerror = function () {
            probarMosaico(lista, i + 1);
        };
        img.src = src + (src.indexOf("?") >= 0 ? "&" : "?") + "v=" + ICONO_CACHE;
    }

    function urlCssMosaico(src) {
        const limpio = String(src || "").replace(/^\.\//, "");
        const abs = (limpio.charAt(0) === "/" ? limpio : "/" + limpio) + "?v=" + ICONO_CACHE;
        return 'url("' + abs + '")';
    }

    function tamanioCeldaPx() {
        if (mosaicoImg && mosaicoImg.naturalWidth) {
            return {
                w: mosaicoImg.naturalWidth / iconoCfg.cols,
                h: mosaicoImg.naturalHeight / iconoCfg.rows
            };
        }
        const lado = iconoCfg.celdaPx || 128;
        return { w: lado, h: lado };
    }

    function recorteCelda(x, y) {
        const xy = clampIcono(x, y);
        const clave = xy.x + "," + xy.y;
        if (recortesCelda[clave]) return recortesCelda[clave];
        const t = tamanioCeldaPx();
        const sx = Math.round(xy.x * t.w);
        const sy = Math.round(xy.y * t.h);
        const sw = Math.max(1, Math.round((xy.x + 1) * t.w) - sx);
        const sh = Math.max(1, Math.round((xy.y + 1) * t.h) - sy);
        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        if (mosaicoImg) ctx.drawImage(mosaicoImg, sx, sy, sw, sh, 0, 0, sw, sh);
        let url = "";
        try {
            url = canvas.toDataURL("image/png");
        } catch (e) {
            url = "";
        }
        const rec = { url: url, w: sw, h: sh };
        if (mosaicoImg) recortesCelda[clave] = rec;
        return rec;
    }

    function tamanioMarker(w, h) {
        const max = 48;
        const s = Math.min(1, max / Math.max(w, h, 1));
        return [Math.max(18, Math.round(w * s)), Math.max(18, Math.round(h * s))];
    }

    function aplicarCssMosaico(src) {
        const root = document.documentElement;
        root.style.setProperty("--icono-cols", String(iconoCfg.cols));
        root.style.setProperty("--icono-rows", String(iconoCfg.rows));
        root.style.setProperty("--icono-mosaico", urlCssMosaico(src));
        const foto = $("mosaicoFoto");
        if (foto) foto.src = src + (src.indexOf("?") >= 0 ? "&" : "?") + "v=" + ICONO_CACHE;
        document.body.classList.add("mosaico-listo");
        iconoMosaicoListo = true;
    }

    function aplicarIconoEnMarker(id, xy) {
        xy = clampIcono(xy && xy.x, xy && xy.y);
        const marker = markers[id];
        if (!marker) return;
        const rec = recorteCelda(xy.x, xy.y);
        if (marker._iconoSrc === rec.url && marker._iconoXY && marker._iconoXY.x === xy.x && marker._iconoXY.y === xy.y) {
            return;
        }
        const rumbo = (autos[id] && Number.isFinite(Number(autos[id].rumbo)))
            ? autos[id].rumbo
            : (id === miId && miPosicion ? miPosicion.rumbo : null);
        marker.setIcon(crearIcono(id === miId, xy));
        marker._iconoXY = { x: xy.x, y: xy.y };
        marker._iconoSrc = rec.url;
        requestAnimationFrame(function () { aplicarRumbo(id, rumbo); });
    }

    function pintarPreviewIcono() {
        const el = $("iconoPreview");
        const xy = leerIconoLocal();
        if (el) {
            const rec = recorteCelda(xy.x, xy.y);
            let img = el.querySelector("img");
            if (!img) {
                img = document.createElement("img");
                img.alt = "";
                el.appendChild(img);
            }
            img.src = rec.url;
        }
    }

    function abrirModalIcono() {
        armarGrillaMosaico();
        $("modalIcono").classList.remove("oculto");
    }

    function cerrarModalIcono() {
        $("modalIcono").classList.add("oculto");
    }

    function armarGrillaMosaico() {
        const grid = $("mosaicoGrid");
        const foto = $("mosaicoFoto");
        const xy = leerIconoLocal();
        if (foto && iconoCfg.src) {
            foto.src = iconoCfg.src + (iconoCfg.src.indexOf("?") >= 0 ? "&" : "?") + "v=" + ICONO_CACHE;
        }
        grid.innerHTML = "";
        grid.style.setProperty("--icono-cols", String(iconoCfg.cols));
        grid.style.setProperty("--icono-rows", String(iconoCfg.rows));
        let y;
        let x;
        for (y = 0; y < iconoCfg.rows; y++) {
            for (x = 0; x < iconoCfg.cols; x++) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "mosaico-celda" + (x === xy.x && y === xy.y ? " elegida" : "");
                btn.setAttribute("aria-label", "Icono columna " + x + ", fila " + y);
                btn.title = "x=" + x + ", y=" + y;
                (function (cx, cy) {
                    btn.addEventListener("click", function () {
                        elegirIcono(cx, cy);
                    });
                })(x, y);
                grid.appendChild(btn);
            }
        }
        const hint = $("mosaicoHint");
        if (hint && iconoMosaicoListo) {
            hint.textContent = "Mosaico " + iconoCfg.cols + " × " + iconoCfg.rows + ". Tocá un auto.";
        }
    }

    function elegirIcono(x, y) {
        const xy = guardarIconoLocal(x, y);
        pintarPreviewIcono();
        aplicarIconoEnMarker(miId, xy);
        emitirTelemetria(true);
        cerrarModalIcono();
    }

    // ===================================================
    // GPS: al iniciar va a tu punto y el marker sigue las coords
    // ===================================================
    function iniciarGps() {
        if (!navigator.geolocation) {
            mostrarAvisoGps("Tu navegador no permite geolocalización.");
            avisarGpsErrorIntro("Tu navegador no permite ubicación.");
            return;
        }
        navigator.geolocation.getCurrentPosition(function (pos) {
            ocultarAvisoGps();
            onPosicion(pos, true);
            avisarGpsListoIntro();
            empezarWatchGps();
        }, function (err) {
            onGpsError(err);
            if (!err || err.code !== 1) empezarWatchGps();
        }, GEO_PRIMERA);
    }

    function empezarWatchGps() {
        if (!navigator.geolocation) return;
        if (gpsWatchId != null) return;
        gpsWatchId = navigator.geolocation.watchPosition(function (pos) {
            ocultarAvisoGps();
            onPosicion(pos, false);
            avisarGpsListoIntro();
        }, onGpsError, GEO_OPTS);
    }

    function onGpsError(err) {
        if (err && err.code === 1) {
            mostrarAvisoGps("Para verte en el mapa, permití el acceso a la ubicación.");
            avisarGpsErrorIntro("Sin problema. Si más tarde lo permitís, aparecés en el mapa al toque.");
        } else {
            avisarGpsErrorIntro("No pudimos leer el GPS ahora. Podés entrar igual y activarlo después.");
        }
    }

    function mostrarAvisoGps(texto) {
        $("avisoGps").classList.remove("oculto");
        $("avisoGps").querySelector("p").textContent = texto;
    }

    function ocultarAvisoGps() {
        $("avisoGps").classList.add("oculto");
    }

    function onPosicion(pos, forzarCentro) {
        const cruda = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            velocidad: aKmh(pos.coords.speed),
            rumbo: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
            precision: pos.coords.accuracy || null
        };

        if (!forzarCentro && !aceptarGps(cruda)) return;

        ultimoGpsCrudo = cruda;
        const seq = ++gpsSeq;

        anclarACalle(cruda.lat, cruda.lng).then(function (snap) {
            if (seq !== gpsSeq) return;
            const p = elegirPuntoGps(cruda, snap);
            aplicarPosicionPropia(p[0], p[1], cruda, forzarCentro);
        }).catch(function () {
            if (seq !== gpsSeq) return;
            aplicarPosicionPropia(cruda.lat, cruda.lng, cruda, forzarCentro);
        });
    }

    function aceptarGps(cruda) {
        if (!ultimoGpsCrudo && !miPosicion) return true;
        const ref = ultimoGpsCrudo
            ? [ultimoGpsCrudo.lat, ultimoGpsCrudo.lng]
            : [miPosicion.lat, miPosicion.lng];
        const m = metrosEntre(ref, [cruda.lat, cruda.lng]);
        const acc = Math.max(cruda.precision || 20, (ultimoGpsCrudo && ultimoGpsCrudo.precision) || 20);
        const lento = cruda.velocidad < GPS_LENTO_KMH;
        const umbral = lento
            ? Math.min(55, Math.max(GPS_MUERTO_LENTO_M, acc * 0.85))
            : Math.max(GPS_MUERTO_RAPIDO_M, acc * 0.4);
        return m >= umbral;
    }

    function elegirPuntoGps(cruda, snap) {
        const raw = [cruda.lat, cruda.lng];
        if (!snap) return raw;
        const desvio = metrosEntre(raw, snap);
        if (desvio > 40) return raw;
        if (miPosicion && cruda.velocidad < GPS_LENTO_KMH) {
            const saltoSnap = metrosEntre([miPosicion.lat, miPosicion.lng], snap);
            const saltoRaw = metrosEntre([miPosicion.lat, miPosicion.lng], raw);
            if (saltoSnap > saltoRaw * 1.6 && saltoSnap > 25) return raw;
        }
        return snap;
    }

    function aplicarPosicionPropia(lat, lng, extra, forzarCentro) {
        let rumbo = extra.rumbo;
        if (miPosicion) {
            const m = metrosEntre([miPosicion.lat, miPosicion.lng], [lat, lng]);
            if ((!Number.isFinite(rumbo) || extra.velocidad < 4) && m >= 18) {
                rumbo = rumboEntre([miPosicion.lat, miPosicion.lng], [lat, lng]);
            } else if (!Number.isFinite(rumbo) && Number.isFinite(miPosicion.rumbo)) {
                rumbo = miPosicion.rumbo;
            }
        }

        miPosicion = {
            lat: lat,
            lng: lng,
            velocidad: extra.velocidad,
            rumbo: rumbo,
            precision: extra.precision
        };
        actualizarResumenPerfil();

        if (!yaCentramos || forzarCentro) {
            yaCentramos = true;
            map.setView([lat, lng], 16);
            map.invalidateSize();
            actualizarCirculoRadio(false);
        } else if (circuloRadio) {
            circuloRadio.setLatLng([lat, lng]);
        }

        actualizarMarker({
            id: miId,
            lat: lat,
            lng: lng,
            velocidad: miPosicion.velocidad,
            rumbo: miPosicion.rumbo,
            precision: miPosicion.precision,
            nombre: $("nombre").value.trim() || "Vos",
            vehiculo: $("vehiculo").value.trim(),
            placa: $("placa").value.trim(),
            seguro: $("seguro").value.trim(),
            contacto: $("contacto").value.trim()
        });

        if (debeEmitir(lat, lng)) emitirTelemetria(false);
        renderizarContactos();
        aplicarRumbo(miId, rumbo);
    }

    function aKmh(ms) {
        if (ms == null || isNaN(ms) || ms < 0) return 0;
        return Math.round(ms * 3.6);
    }

    function debeEmitir(lat, lng) {
        const ahora = Date.now();
        if (!ultimoEnvio.lat) return true;
        if (ahora - ultimoEnvio.ts > 5000) return true;
        const metros = calcularDistanciaKm(ultimoEnvio.lat, ultimoEnvio.lng, lat, lng) * 1000;
        return metros >= 18;
    }

    function emitirTelemetria(forzar) {
        if (!miPosicion || !socket.connected) return;
        if (!forzar && !debeEmitir(miPosicion.lat, miPosicion.lng) && Date.now() - ultimoEnvio.ts < 2000) {
            return;
        }
        const data = datosPropios();
        data.lat = miPosicion.lat;
        data.lng = miPosicion.lng;
        data.velocidad = miPosicion.velocidad || 0;
        data.rumbo = miPosicion.rumbo;
        data.precision = miPosicion.precision;
        socket.emit("telemetria", data);
        ultimoEnvio = { ts: Date.now(), lat: data.lat, lng: data.lng };
    }

    // Heartbeat: si estás quieto, igual avisás que seguís online
    setInterval(function () {
        emitirTelemetria(true);
    }, 3000);

    // ===================================================
    // Distancia
    // ===================================================
    function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function metrosEntre(a, b) {
        return calcularDistanciaKm(a[0], a[1], b[0], b[1]) * 1000;
    }

    function rumboEntre(a, b) {
        const dLon = (b[1] - a[1]) * Math.PI / 180;
        const lat1 = a[0] * Math.PI / 180;
        const lat2 = b[0] * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    function textoRumbo(deg) {
        if (!Number.isFinite(Number(deg))) return "—";
        const dirs = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
        const n = Math.round(Number(deg) / 45) % 8;
        return dirs[n] + " · " + Math.round(Number(deg)) + "°";
    }

    function aplicarRumbo(id, deg) {
        if (!Number.isFinite(Number(deg))) return;
        const marker = markers[id];
        if (!marker) return;
        const el = marker.getElement();
        if (!el) return;
        const rot = el.querySelector(".auto-rot");
        if (rot) rot.style.transform = "rotate(" + Number(deg) + "deg)";
        if (autos[id]) autos[id].rumbo = Number(deg);
        if (id === miId && miPosicion) miPosicion.rumbo = Number(deg);
    }

    function clavePunto(lat, lng) {
        return Number(lat).toFixed(4) + "," + Number(lng).toFixed(4);
    }

    function anclarACalle(lat, lng) {
        const clave = clavePunto(lat, lng);
        if (cacheSnap[clave]) return Promise.resolve(cacheSnap[clave]);
        const lnglat = Number(lng) + "," + Number(lat);
        return fetch("/api/osrm/nearest?lnglat=" + encodeURIComponent(lnglat))
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j || j.code !== "Ok" || !j.waypoints || !j.waypoints[0]) {
                    return [lat, lng];
                }
                const p = j.waypoints[0].location;
                const snap = [p[1], p[0]];
                if (Object.keys(cacheSnap).length > 400) {
                    delete cacheSnap[Object.keys(cacheSnap)[0]];
                }
                cacheSnap[clave] = snap;
                return snap;
            })
            .catch(function () { return [lat, lng]; });
    }

    function rutaPorCalle(desde, hasta) {
        const clave = clavePunto(desde[0], desde[1]) + ">" + clavePunto(hasta[0], hasta[1]);
        if (cacheRuta[clave]) return Promise.resolve(cacheRuta[clave]);
        const from = Number(desde[1]) + "," + Number(desde[0]);
        const to = Number(hasta[1]) + "," + Number(hasta[0]);
        return fetch("/api/osrm/ruta?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to))
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j || j.code !== "Ok" || !j.routes || !j.routes[0]) {
                    return [desde, hasta];
                }
                const path = j.routes[0].geometry.coordinates.map(function (c) {
                    return [c[1], c[0]];
                });
                if (path.length < 2) return [desde, hasta];
                cacheRuta[clave] = path;
                return path;
            })
            .catch(function () { return [desde, hasta]; });
    }

    function longitudPath(pts) {
        let d = 0;
        for (let i = 1; i < pts.length; i++) d += metrosEntre(pts[i - 1], pts[i]);
        return d;
    }

    function puntoEnPath(pts, dist) {
        let restante = dist;
        for (let i = 1; i < pts.length; i++) {
            const seg = metrosEntre(pts[i - 1], pts[i]);
            if (restante <= seg) {
                const t = seg === 0 ? 1 : restante / seg;
                return [
                    pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
                    pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t
                ];
            }
            restante -= seg;
        }
        return pts[pts.length - 1];
    }

    function estadoMovimiento(id) {
        if (!movimientos[id]) movimientos[id] = { seq: 0, raf: null };
        return movimientos[id];
    }

    function cancelarMovimiento(id) {
        const est = movimientos[id];
        if (!est) return;
        est.seq += 1;
        if (est.raf) {
            cancelAnimationFrame(est.raf);
            est.raf = null;
        }
    }

    function animarPorCalle(id, marker, path) {
        const est = estadoMovimiento(id);
        if (est.raf) cancelAnimationFrame(est.raf);
        const total = Math.max(longitudPath(path), 1);
        const duration = Math.max(350, Math.min(2000, total * 80));
        const t0 = performance.now();
        const soyYo = id === miId;
        const seq = est.seq;

        function frame(now) {
            if (est.seq !== seq) return;
            const t = Math.min(1, (now - t0) / duration);
            const p = puntoEnPath(path, total * t);
            const adelantado = puntoEnPath(path, Math.min(total, total * t + 4));
            if (metrosEntre(p, adelantado) > 0.4) aplicarRumbo(id, rumboEntre(p, adelantado));
            marker.setLatLng(p);
            if (soyYo && circuloRadio) circuloRadio.setLatLng(p);
            if (debeMostrarFicha(id) && !marker.isTooltipOpen()) marker.openTooltip();
            if (soyYo && seguirMe) map.setView(p, map.getZoom(), { animate: false });
            if (t < 1) {
                est.raf = requestAnimationFrame(frame);
            } else {
                est.raf = null;
            }
        }
        est.raf = requestAnimationFrame(frame);
    }

    function moverPorCalle(id, marker, dest) {
        const actual = marker.getLatLng();
        const origen = [actual.lat, actual.lng];
        const metros = metrosEntre(origen, dest);
        if (metros < RUTA_MIN_M) {
            marker.setLatLng(dest);
            return;
        }
        if (metros > 1200) {
            anclarACalle(dest[0], dest[1]).then(function (snap) {
                marker.setLatLng(snap);
            });
            return;
        }

        const est = estadoMovimiento(id);
        const seq = ++est.seq;
        if (est.raf) {
            cancelAnimationFrame(est.raf);
            est.raf = null;
        }

        rutaPorCalle(origen, dest).then(function (path) {
            if (est.seq !== seq || !markers[id]) return;
            const largo = longitudPath(path);
            if (largo > metros * 1.4) {
                marker.setLatLng(dest);
                return;
            }
            animarPorCalle(id, marker, path);
        });
    }

    function radioKmActual() {
        return parseFloat($("radioFiltro").value) || 5;
    }

    function ocultarCirculoRadio() {
        if (radioTimer) {
            clearTimeout(radioTimer);
            radioTimer = null;
        }
        if (circuloRadio) {
            map.removeLayer(circuloRadio);
            circuloRadio = null;
        }
        vistaRadio = false;
    }

    function actualizarCirculoRadio(ajustarZoom) {
        if (!miPosicion) return;
        const metros = radioKmActual() * 1000;
        const centro = [miPosicion.lat, miPosicion.lng];

        if (!circuloRadio) {
            circuloRadio = L.circle(centro, {
                radius: metros,
                color: "#3aa0c8",
                weight: 2,
                opacity: 0.9,
                fillColor: "#7ec8e3",
                fillOpacity: 0.18,
                interactive: false,
                pane: "overlayPane"
            }).addTo(map);
            circuloRadio.bringToBack();
        } else {
            circuloRadio.setLatLng(centro);
            circuloRadio.setRadius(metros);
        }

        if (ajustarZoom) {
            vistaRadio = true;
            seguirMe = true;
            map.fitBounds(circuloRadio.getBounds(), {
                padding: [36, 36],
                maxZoom: 16,
                animate: true
            });
        }

        if (radioTimer) clearTimeout(radioTimer);
        radioTimer = setTimeout(ocultarCirculoRadio, 4000);
    }

    function textoDistancia(km) {
        if (km < 1) return Math.round(km * 1000) + " m";
        return km.toFixed(1) + " km";
    }

    function textoHace(ts) {
        if (!ts) return "";
        const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
        if (s < 5) return "ahora";
        if (s < 60) return "hace " + s + " s";
        return "hace " + Math.round(s / 60) + " min";
    }

    // ===================================================
    // Markers + popup útil
    // ===================================================
    function fichaHtml(a) {
        const soyYo = a.id === miId;
        let distHtml = "";
        if (!soyYo && miPosicion && a.lat && a.lng) {
            distHtml = "<p>" + esc(textoDistancia(calcularDistanciaKm(miPosicion.lat, miPosicion.lng, a.lat, a.lng))) + "</p>";
        }
        const tel = (a.contacto || "").replace(/[^\d+]/g, "");
        const nombre = a.nombre || (soyYo ? "Vos" : "Sin nombre");
        const destino = soyYo ? "RADIO" : nombre;
        const walkie =
            '<button type="button" class="btn-ficha btn-walkie" data-accion="walkie">' +
                '<span class="walkie-mic" aria-hidden="true">' +
                    '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>' +
                "</span>" +
                '<span class="walkie-idle">' +
                    "<strong>Mantené para hablar</strong>" +
                    "<small>Walkie a " + esc(destino) + "</small>" +
                "</span>" +
                '<span class="walkie-on">' +
                    "<strong>Hablando</strong>" +
                    "<small>Soltá para enviar</small>" +
                "</span>" +
            "</button>";
        const extra = soyYo
            ? ""
            : '<div class="acciones-sec">' +
              '<button type="button" class="btn-ficha" data-accion="mensaje">Escribir</button>' +
              (tel ? '<a href="tel:' + esc(tel) + '">Llamar</a>' : "") +
              "</div>";

        return (
            '<div class="v2v-popup" data-id="' + esc(a.id) + '">' +
                '<div class="v2v-popup-top">' +
                    '<p class="para">' + (soyYo ? "Tu radio · RADIO te oye" : "Directo a esta persona") + "</p>" +
                    '<button type="button" class="btn-cerrar-ficha" data-accion="cerrar" title="Cerrar" aria-label="Cerrar">' +
                        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>' +
                    "</button>" +
                "</div>" +
                "<h4>" + esc(nombre) + "</h4>" +
                "<p>" + esc(a.vehiculo || "Vehículo") + (a.placa ? " · " + esc(a.placa) : "") + "</p>" +
                "<p><b>" + esc(Math.round(a.velocidad || 0)) + " km/h</b> · " + esc(textoRumbo(a.rumbo)) + "</p>" +
                distHtml +
                '<div class="acciones">' + walkie + extra + "</div>" +
            "</div>"
        );
    }

    function engancharFicha(marker, id) {
        const tip = marker.getTooltip();
        const root = tip && tip.getElement();
        if (!root) return;
        root.querySelectorAll("[data-accion]").forEach(function (btn) {
            const accion = btn.getAttribute("data-accion");
            if (accion === "walkie") {
                btn.onpointerdown = function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ctxPtt();
                    if (btn.setPointerCapture) btn.setPointerCapture(ev.pointerId);
                    if (id === miId) empezarPtt("general");
                    else {
                        seleccionarContacto(id, true);
                        empezarPtt("privado");
                    }
                    btn.classList.add("grabando");
                };
                btn.onpointerup = function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    btn.classList.remove("grabando");
                    detenerPtt();
                };
                btn.onpointercancel = function () {
                    btn.classList.remove("grabando");
                    detenerPtt();
                };
                btn.oncontextmenu = function (ev) { ev.preventDefault(); };
                return;
            }
            if (accion === "cerrar") {
                btn.onclick = function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    cerrarFicha(id);
                };
                return;
            }
            btn.onclick = function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                const auto = autos[id] || (id === miId ? Object.assign(datosPropios(), miPosicion, { id: miId }) : null);
                if (!auto) return;
                if (accion === "centrar") {
                    map.setView([auto.lat, auto.lng], Math.max(map.getZoom(), 16));
                    if (id === miId) seguirMe = true;
                }
                if (accion === "mensaje") {
                    seleccionarContacto(id);
                    abrirComms();
                    mostrarTab("privado");
                }
            };
        });
    }

    function actualizarMarker(a) {
        if (!a || !Number.isFinite(Number(a.lat)) || !Number.isFinite(Number(a.lng))) return;
        const latlng = [Number(a.lat), Number(a.lng)];
        const soyYo = a.id === miId;

        if (!markers[a.id]) {
            const marker = L.marker(latlng, {
                icon: crearIcono(soyYo, iconoDeAuto(a)),
                zIndexOffset: soyYo ? 1000 : 0,
                title: a.nombre || (soyYo ? "Vos" : "Vehículo")
            }).addTo(map);
            marker.bindTooltip(fichaHtml(a), fichaOpts(soyYo));
            markers[a.id] = marker;
            engancharClickMarker(marker, a.id);
            aplicarIconoEnMarker(a.id, iconoDeAuto(a));
            requestAnimationFrame(function () {
                aplicarRumbo(a.id, a.rumbo);
                aplicarIconoEnMarker(a.id, iconoDeAuto(a));
                if (debeMostrarFicha(a.id)) {
                    marker.openTooltip();
                    engancharFicha(marker, a.id);
                } else {
                    marker.closeTooltip();
                }
            });
            anclarACalle(latlng[0], latlng[1]).then(function (snap) {
                if (markers[a.id]) {
                    markers[a.id].setLatLng(snap);
                    if (debeMostrarFicha(a.id)) {
                        markers[a.id].openTooltip();
                        engancharFicha(markers[a.id], a.id);
                    }
                }
            });
            return;
        }

        moverPorCalle(a.id, markers[a.id], latlng);
        aplicarRumbo(a.id, a.rumbo);
        aplicarIconoEnMarker(a.id, iconoDeAuto(a));
        refrescarFicha(a.id, a);
    }

    function refrescarFicha(id, a) {
        const m = markers[id];
        if (!m || pttActivo) return;
        if (!m.getTooltip()) m.bindTooltip(fichaHtml(a), fichaOpts(id === miId));
        else m.setTooltipContent(fichaHtml(a));
        if (debeMostrarFicha(id)) {
            m.openTooltip();
            requestAnimationFrame(function () { engancharFicha(m, id); });
        } else {
            m.closeTooltip();
        }
    }

    function aplicarVisibilidadPopups() {
        Object.keys(markers).forEach(function (id) {
            const m = markers[id];
            if (!m) return;
            if (debeMostrarFicha(id)) {
                m.openTooltip();
                requestAnimationFrame(function () {
                    engancharFicha(m, id);
                    const tip = m.getTooltip();
                    if (tip) tip.update();
                });
            } else {
                m.closeTooltip();
            }
        });
    }

    function quitarVehiculo(id) {
        cancelarMovimiento(id);
        delete movimientos[id];
        if (markers[id]) {
            map.removeLayer(markers[id]);
            delete markers[id];
        }
        delete autos[id];
        delete fichasForzadas[id];
        if (contactoActivo === id) {
            contactoActivo = null;
            $("contactoSeleccionado").textContent = "Ese vehículo se desconectó.";
        }
        renderizarContactos();
    }

    function aplicarEstadoGlobal(estado) {
        autos = estado && typeof estado === "object" ? estado : {};
        Object.keys(markers).forEach(function (id) {
            if (id !== miId && !autos[id]) quitarVehiculo(id);
        });
        Object.keys(autos).forEach(function (id) {
            actualizarMarker(autos[id]);
        });
        renderizarContactos();
        actualizarResumenRed();
    }

    // ===================================================
    // Contactos (aside)
    // ===================================================
    function renderizarContactos() {
        const contenedor = $("listaContactos");
        contenedor.innerHTML = "";

        if (!miPosicion) {
            contenedor.innerHTML = '<p class="vacio">Activá la ubicación para armar la RADIO.</p>';
            actualizarResumenRed();
            return;
        }

        const radioKm = parseFloat($("radioFiltro").value);
        const lista = [];

        Object.keys(autos).forEach(function (id) {
            if (id === miId) return;
            const a = autos[id];
            if (!a.lat || !a.lng) return;
            const dist = calcularDistanciaKm(miPosicion.lat, miPosicion.lng, a.lat, a.lng);
            if (dist <= radioKm) lista.push({ id: id, a: a, dist: dist });
        });

        lista.sort(function (x, y) { return x.dist - y.dist; });

        if (!lista.length) {
            contenedor.innerHTML = '<p class="vacio">Nadie dentro de ' + radioKm + " km. Compartí el enlace de RadioMap con el grupo.</p>";
            actualizarResumenRed(0);
            return;
        }

        lista.forEach(function (item, idx) {
            const div = document.createElement("div");
            const primero = idx === 0;
            div.className = "contacto" + (contactoActivo === item.id ? " activo" : "") + (primero ? " mas-cerca" : "");
            div.innerHTML =
                "<div><strong>" + esc(item.a.nombre || "Sin nombre") + "</strong>" +
                (primero ? '<em class="tag-cerca">Más cerca de vos</em>' : "") +
                "<small>" + esc(item.a.vehiculo || "Vehículo") +
                (item.a.placa ? " · " + esc(item.a.placa) : "") + "</small></div>" +
                '<div class="acciones-mini">' +
                '<span class="dist">' + ICO_PIN + " " + esc(textoDistancia(item.dist)) + "</span>" +
                '<button type="button" class="btn-icon-lista" title="Mantené para hablarle a ' + esc(item.a.nombre || "esta persona") + '">' +
                    ICO_MIC +
                    "<em>Mantené</em>" +
                "</button>" +
                "</div>";
            div.addEventListener("click", function () {
                seleccionarContacto(item.id);
                mostrarTab("privado");
                abrirComms();
            });
            const btnW = div.querySelector(".btn-icon-lista");
            btnW.addEventListener("pointerdown", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                ctxPtt();
                seleccionarContacto(item.id, true);
                empezarPtt("privado");
                btnW.classList.add("grabando");
            });
            btnW.addEventListener("pointerup", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                btnW.classList.remove("grabando");
                detenerPtt();
            });
            btnW.addEventListener("pointercancel", function () {
                btnW.classList.remove("grabando");
                detenerPtt();
            });
            contenedor.appendChild(div);
        });

        actualizarResumenRed(lista.length);
    }

    function actualizarResumenRed(cerca) {
        const total = Object.keys(autos).filter(function (id) { return id !== miId; }).length;
        const n = typeof cerca === "number" ? cerca : total;
        $("resumenRed").textContent = n === 1
            ? "1 vehículo en la RADIO"
            : (n + " vehículos en la RADIO");
        actualizarDestinoUI(n);
    }

    function actualizarDestinoUI(cerca) {
        const radio = radioKmActual();
        const n = typeof cerca === "number" ? cerca : Object.keys(autos).filter(function (id) { return id !== miId; }).length;
        const detalle = "RADIO · " + radio + " km" + (n ? " · " + n + (n === 1 ? " auto" : " autos") : "");
        if ($("destinoNombre")) $("destinoNombre").textContent = detalle;
        if ($("destinoKicker")) $("destinoKicker").textContent = "Walkie y avisos van a";
        if ($("destinoConvoyDetalle")) $("destinoConvoyDetalle").textContent = detalle;
        if ($("txtV2V")) $("txtV2V").placeholder = "Aviso a RADIO (" + radio + " km)…";
        if (contactoActivo && autos[contactoActivo] && $("lblEnviarPrivado")) {
            const nom = autos[contactoActivo].nombre || "esa persona";
            $("lblEnviarPrivado").textContent = "A " + nom;
            $("txtPrivado").placeholder = "Mensaje a " + nom + "…";
        }
    }

    function seleccionarContacto(id, silencioso) {
        const a = autos[id];
        if (!a) return;
        contactoActivo = id;
        $("contactoSeleccionado").textContent =
            (a.nombre || "Sin nombre") + " · " + (a.vehiculo || "Vehículo") +
            (a.placa ? " · " + a.placa : "");
        if ($("lblEnviarPrivado")) $("lblEnviarPrivado").textContent = "A " + (a.nombre || "esa persona");
        if ($("txtPrivado")) $("txtPrivado").placeholder = "Mensaje a " + (a.nombre || "esa persona") + "…";
        pintarHistorialPrivado(id);
        renderizarContactos();
        if (!silencioso && markers[id]) {
            if (debeMostrarFicha(id)) markers[id].openTooltip();
            map.setView([a.lat, a.lng], Math.max(map.getZoom(), 15));
        }
    }

    function pintarHistorialPrivado(id) {
        const cont = $("msgsPrivado");
        cont.innerHTML = "";
        (historialPrivado[id] || []).forEach(function (m) {
            agregarMensaje(cont, m.nombre, m.texto, m.propio, m.ts);
        });
    }

    function formatearFechaHora(ts) {
        const d = new Date(Number(ts) || Date.now());
        if (!Number.isFinite(d.getTime())) return "";
        const p = function (n) { return (n < 10 ? "0" : "") + n; };
        return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() +
            " " + p(d.getHours()) + ":" + p(d.getMinutes());
    }

    function textoDeAudio(transcripcion) {
        const t = String(transcripcion || "").trim();
        return t ? "audio: " + t : "audio: (sin transcripción)";
    }

    function agregarMensaje(cont, nombre, texto, propio, ts) {
        const div = document.createElement("div");
        div.className = "msg" + (propio ? " propio" : "");
        const hora = ts
            ? '<span class="hora">' + esc(formatearFechaHora(ts)) + "</span>"
            : "";
        div.innerHTML = '<span class="meta">' + esc(nombre) + "</span>" +
            '<span class="cuerpo">' + esc(texto) + "</span>" + hora;
        cont.appendChild(div);
        cont.scrollTop = cont.scrollHeight;
    }

    // ===================================================
    // Chat
    // ===================================================
    function enviarV2V() {
        const txt = $("txtV2V");
        const texto = txt.value.trim();
        if (!texto) return;
        socket.emit("mensajeV2V", { texto: texto });
        txt.value = "";
    }

    function enviarPrivado() {
        const txt = $("txtPrivado");
        const texto = txt.value.trim();
        if (!texto || !contactoActivo) return;
        socket.emit("mensajePrivado", { id: contactoActivo, mensaje: texto });
        const item = {
            nombre: $("nombre").value.trim() || "Vos",
            texto: texto,
            propio: true
        };
        historialPrivado[contactoActivo] = historialPrivado[contactoActivo] || [];
        historialPrivado[contactoActivo].push(item);
        agregarMensaje($("msgsPrivado"), item.nombre, item.texto, true);
        txt.value = "";
    }

    function vozATexto(callback) {
        const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Rec) {
            alert("El dictado por voz no está disponible en este navegador.");
            return;
        }
        const rec = new Rec();
        rec.lang = "es-AR";
        rec.onresult = function (e) {
            const texto = e.results[0][0].transcript;
            if (callback) callback(texto);
        };
        rec.start();
    }

    function textoAVoz(texto) {
        if (!window.speechSynthesis) return;
        const u = new SpeechSynthesisUtterance(texto);
        u.lang = "es-AR";
        speechSynthesis.speak(u);
    }

    // ===================================================
    // Walkie-talkie (PTT)
    // ===================================================
    function mimeGrabacion() {
        if (typeof MediaRecorder === "undefined") return "";
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
        if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
        if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) return "audio/ogg;codecs=opus";
        return "";
    }

    function ctxPtt() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (!audioCtxPtt) audioCtxPtt = new AC();
        if (audioCtxPtt.state === "suspended") audioCtxPtt.resume();
        return audioCtxPtt;
    }

    function tonoPtt(ctx, freq, t0, dur, type, vol) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + dur + 0.03);
    }

    function sonidoPtt(ok) {
        const ctx = ctxPtt();
        if (!ctx) return;
        const t = ctx.currentTime + 0.01;
        if (ok) {
            tonoPtt(ctx, 880, t, 0.08, "square", 0.07);
            tonoPtt(ctx, 1320, t + 0.09, 0.11, "square", 0.055);
        } else {
            tonoPtt(ctx, 220, t, 0.18, "sawtooth", 0.08);
            tonoPtt(ctx, 140, t + 0.16, 0.2, "square", 0.07);
        }
    }

    function avisarEnvioPtt(ok) {
        if (pttAckHecho) return;
        pttAckHecho = true;
        sonidoPtt(ok);
    }

    function emitirAudioConAck(evento, payload) {
        if (!socket.connected) {
            avisarEnvioPtt(false);
            return;
        }
        const fin = function (err, res) {
            avisarEnvioPtt(!err && res && res.ok);
        };
        try {
            socket.timeout(4000).emit(evento, payload, fin);
        } catch (e) {
            socket.emit(evento, payload);
            avisarEnvioPtt(true);
        }
    }

    function crearGrabador(stream) {
        const mime = mimeGrabacion();
        const opts = { audioBitsPerSecond: 24000 };
        if (mime) opts.mimeType = mime;
        try {
            return new MediaRecorder(stream, opts);
        } catch (e) {
            try {
                return mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
            } catch (e2) {
                return new MediaRecorder(stream);
            }
        }
    }

    function streamMicVivo() {
        return pttStream && pttStream.getTracks().some(function (t) { return t.readyState === "live"; });
    }

    function setAvisoAudio(texto) {
        const el = $("avisoAudio");
        if (!texto) {
            el.classList.add("oculto");
            el.textContent = "";
            return;
        }
        el.textContent = texto;
        el.classList.remove("oculto");
    }

    function marcarHablando(id, on) {
        const m = markers[id];
        if (!m) return;
        const el = m.getElement();
        if (el) el.classList.toggle("hablando", !!on);
    }

    function bindPtt(el, modo) {
        if (!el) return;
        el.addEventListener("pointerdown", function (ev) {
            ev.preventDefault();
            ctxPtt();
            if (el.setPointerCapture) el.setPointerCapture(ev.pointerId);
            empezarPtt(modo);
        });
        el.addEventListener("pointerup", function (ev) {
            ev.preventDefault();
            detenerPtt();
        });
        el.addEventListener("pointercancel", function () { detenerPtt(); });
        el.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
    }

    function resolverModoPtt(modo) {
        if (modo === "privado") return "privado";
        return "general";
    }

    function empezarPtt(modo) {
        if (pttActivo) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
            alert("Este navegador no permite walkie-talkie.");
            return;
        }
        const canal = resolverModoPtt(modo);
        if (canal === "privado" && !contactoActivo) {
            alert("Elegí un auto del mapa o de la lista para hablarle.");
            return;
        }
        ctxPtt();
        pttModo = canal;
        pttActivo = true;
        pttChunks = [];
        pttTranscripcion = "";
        pttAckHecho = false;
        document.querySelectorAll(".btn-ptt, .btn-ptt-mapa").forEach(function (b) {
            b.classList.add("grabando");
        });
        if (canal === "privado") {
            const dest = autos[contactoActivo];
            const nom = (dest && dest.nombre) || "esa persona";
            setAvisoAudio("Mantené para hablar a " + nom + " — soltá para enviar");
            if ($("destinoKicker")) $("destinoKicker").textContent = "Transmitiendo en directo a";
            if ($("destinoNombre")) $("destinoNombre").textContent = nom;
        } else {
            setAvisoAudio("Mantené para hablar a RADIO — soltá para enviar");
            actualizarDestinoUI();
            if ($("destinoKicker")) $("destinoKicker").textContent = "Transmitiendo a";
        }

        const arrancar = function (stream) {
            if (!pttActivo) return;
            pttStream = stream;
            pttRecorder = crearGrabador(stream);
            pttRecorder.ondataavailable = function (e) {
                if (e.data && e.data.size) pttChunks.push(e.data);
            };
            pttRecorder.onstop = enviarAudioGrabado;
            try {
                pttRecorder.start(80);
            } catch (e) {
                pttRecorder.start();
            }
            empezarTranscripcionPtt();
            pttTimer = setTimeout(detenerPtt, 12000);
        };

        if (streamMicVivo()) arrancar(pttStream);
        else {
            navigator.mediaDevices.getUserMedia(MIC_OPTS).then(arrancar).catch(function () {
                pttActivo = false;
                detenerTranscripcionPtt();
                document.querySelectorAll(".btn-ptt, .btn-ptt-mapa").forEach(function (b) {
                    b.classList.remove("grabando");
                });
                setAvisoAudio("");
                avisarEnvioPtt(false);
                alert("No se pudo usar el micrófono.");
            });
        }
    }

    function detenerPtt() {
        if (!pttActivo) return;
        pttActivo = false;
        if (pttTimer) {
            clearTimeout(pttTimer);
            pttTimer = null;
        }
        document.querySelectorAll(".btn-ptt, .btn-ptt-mapa").forEach(function (b) {
            b.classList.remove("grabando");
        });
        setAvisoAudio("");
        actualizarDestinoUI();
        if (pttRecorder && pttRecorder.state === "recording") pttRecorder.stop();
        else if (!pttChunks.length) avisarEnvioPtt(false);
    }

    function empezarTranscripcionPtt() {
        const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Rec) return;
        detenerTranscripcionPtt();
        pttTranscripcion = "";
        const rec = new Rec();
        rec.lang = "es-AR";
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = function (e) {
            let final = "";
            let interino = "";
            for (let i = 0; i < e.results.length; i++) {
                const t = e.results[i][0].transcript;
                if (e.results[i].isFinal) final += (final ? " " : "") + t;
                else interino += (interino ? " " : "") + t;
            }
            pttTranscripcion = (final + (interino ? " " : "") + interino).trim();
        };
        rec.onerror = function () {};
        try {
            rec.start();
            pttReconocimiento = rec;
        } catch (e) {
            pttReconocimiento = null;
        }
    }

    function detenerTranscripcionPtt() {
        if (!pttReconocimiento) return;
        try { pttReconocimiento.stop(); } catch (e) {}
        pttReconocimiento = null;
    }

    function enviarAudioGrabado() {
        const mime = (pttRecorder && pttRecorder.mimeType) || mimeGrabacion() || "audio/webm";
        const blob = new Blob(pttChunks, { type: mime });
        pttChunks = [];
        const dicho = pttTranscripcion;
        detenerTranscripcionPtt();
        if (blob.size < 200) {
            avisarEnvioPtt(false);
            return;
        }
        pttAckHecho = false;
        const texto = textoDeAudio(dicho);
        const ts = Date.now();
        blob.arrayBuffer().then(function (buf) {
            if (pttModo === "privado" && contactoActivo) {
                emitirAudioConAck("audioPrivado", { id: contactoActivo, mime: mime, audio: buf, texto: dicho });
                const item = { nombre: $("nombre").value.trim() || "Vos", texto: texto, propio: true, ts: ts };
                historialPrivado[contactoActivo] = historialPrivado[contactoActivo] || [];
                historialPrivado[contactoActivo].push(item);
                agregarMensaje($("msgsPrivado"), item.nombre, item.texto, true, ts);
            } else {
                emitirAudioConAck("audioV2V", { mime: mime, audio: buf, texto: dicho });
                agregarMensaje($("msgsV2V"), $("nombre").value.trim() || "Vos", texto, true, ts);
            }
        }).catch(function () {
            avisarEnvioPtt(false);
        });
    }

    function reproducirAudio(data) {
        if (!data || !data.audio) return;
        const mime = data.mime || "audio/webm";
        const blob = new Blob([data.audio], { type: mime });
        const url = URL.createObjectURL(blob);
        const audio = new Audio();
        audio.preload = "auto";
        audio.playsInline = true;
        audio.src = url;
        setAvisoAudio((data.nombre || "Alguien") + " está hablando");
        marcarHablando(data.de, true);
        audio.onended = function () {
            URL.revokeObjectURL(url);
            setAvisoAudio("");
            marcarHablando(data.de, false);
        };
        audio.onerror = function () {
            URL.revokeObjectURL(url);
            setAvisoAudio("");
            marcarHablando(data.de, false);
        };
        const play = audio.play();
        if (play && play.catch) {
            play.catch(function () {
                setAvisoAudio("Tocá la pantalla para oír el audio");
            });
        }
    }


    // ===================================================
    // Socket.IO
    // ===================================================
    socket.on("connect", function () {
        setEstado(true);
        emitirTelemetria(true);
    });

    socket.on("disconnect", function () {
        setEstado(false);
    });

    socket.on("connect_error", function () {
        setEstado(false);
    });

    socket.on("telemetria_global", aplicarEstadoGlobal);

    socket.on("telemetria", function (auto) {
        if (!auto || !auto.id) return;
        autos[auto.id] = auto;
        actualizarMarker(auto);
        renderizarContactos();
    });

    socket.on("vehiculo_desconectado", function (id) {
        if (!id || id === miId) return;
        quitarVehiculo(id);
    });

    socket.on("mensajeV2V", function (msg) {
        const payload = typeof msg === "string"
            ? { nombre: "V2V", texto: msg }
            : msg;
        agregarMensaje(
            $("msgsV2V"),
            payload.nombre || "Anónimo",
            payload.texto || "",
            payload.de === miId
        );
    });

    socket.on("mensajePrivado", function (data) {
        const de = data.de || data.id;
        const texto = data.mensaje || "";
        const nombre = data.nombre || "Alguien";
        historialPrivado[de] = historialPrivado[de] || [];
        historialPrivado[de].push({ nombre: nombre, texto: texto, propio: false });

        if (contactoActivo === de) {
            agregarMensaje($("msgsPrivado"), nombre, texto, false);
        } else {
            noLeidos += 1;
            actualizarBadge();
            if (!contactoActivo) seleccionarContacto(de, true);
        }
        textoAVoz(nombre + " dice: " + texto);
    });

    socket.on("audioV2V", function (data) {
        agregarMensaje(
            $("msgsV2V"),
            data.nombre || "Anónimo",
            textoDeAudio(data.texto),
            false,
            data.ts
        );
        reproducirAudio(data);
    });

    socket.on("audioPrivado", function (data) {
        const de = data.de;
        const texto = textoDeAudio(data.texto);
        const ts = data.ts || Date.now();
        historialPrivado[de] = historialPrivado[de] || [];
        historialPrivado[de].push({ nombre: data.nombre || "Alguien", texto: texto, propio: false, ts: ts });
        if (contactoActivo === de) {
            agregarMensaje($("msgsPrivado"), data.nombre || "Alguien", texto, false, ts);
        } else {
            noLeidos += 1;
            actualizarBadge();
            if (!contactoActivo) seleccionarContacto(de, true);
        }
        reproducirAudio(data);
    });

    function setEstado(ok) {
        const el = $("estadoConexion");
        el.className = "estado hud-btn " + (ok ? "estado-on" : "estado-off");
        el.innerHTML = ok
            ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M5 12h2M17 12h2M12 5v2M12 17v2" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>En vivo<span class="punto-rec" aria-hidden="true"></span>'
            : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7l8 10L20 7" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>Reconectando…';
    }

    function actualizarBadge() {
        const badge = $("badgePrivado");
        if (noLeidos > 0 && contactoActivo) {
            // si ya está leyendo, no acumular visible de más
        }
        if (noLeidos > 0) {
            badge.textContent = String(noLeidos);
            badge.classList.remove("oculto");
        } else {
            badge.classList.add("oculto");
        }
    }

    // ===================================================
    // Intro stepper (GPS y mic antes de entrar al mapa)
    // ===================================================
    function portadaVisible() {
        const el = $("portada");
        return !!(el && !el.classList.contains("oculto"));
    }

    function descubrirBarraPermisos() {
        const el = $("portada");
        if (el) el.classList.add("pidiendo-permiso");
    }

    function taparBarraPermisos() {
        const el = $("portada");
        if (el) el.classList.remove("pidiendo-permiso");
    }

    function consultarPermiso(nombre) {
        if (!navigator.permissions || !navigator.permissions.query) {
            return Promise.resolve("unknown");
        }
        try {
            return navigator.permissions.query({ name: nombre }).then(function (s) {
                return s.state || "unknown";
            }).catch(function () { return "unknown"; });
        } catch (e) {
            return Promise.resolve("unknown");
        }
    }

    function avisarGpsListoIntro() {
        if (introGpsResuelto) return;
        introGpsResuelto = true;
        taparBarraPermisos();
        const btn = $("btnPermitirGps");
        if (btn) btn.disabled = false;
        if (!portadaVisible() || introPaso !== 1) return;
        if ($("estadoGps")) $("estadoGps").textContent = "Listo. Ya te vemos en el mapa.";
        if ($("stepAyuda")) $("stepAyuda").textContent = "Ubicación ok. Ahora el micrófono para el walkie.";
        setTimeout(function () { mostrarPasoIntro(2); }, 450);
    }

    function avisarGpsErrorIntro(texto) {
        taparBarraPermisos();
        const btn = $("btnPermitirGps");
        if (btn) btn.disabled = false;
        if (!portadaVisible() || introPaso !== 1) return;
        if ($("estadoGps")) $("estadoGps").textContent = texto;
        if ($("stepAyuda")) $("stepAyuda").textContent = "Podés seguir igual con «Ahora no, seguir». El GPS se puede activar después.";
    }

    function pedirGpsIntro() {
        const estado = $("estadoGps");
        const btn = $("btnPermitirGps");
        if (btn) btn.disabled = false;
        descubrirBarraPermisos();
        if (estado) estado.textContent = "Mirá arriba, junto a la dirección: ahí aparece Permitir. No es un cartel en el medio.";
        if ($("stepAyuda")) $("stepAyuda").textContent = "Si no ves nada, tocá el candado al lado de la URL y permití la ubicación.";
        iniciarGps();
        consultarPermiso("geolocation").then(function (state) {
            if (introGpsResuelto || introPaso !== 1) return;
            if (state === "denied") {
                avisarGpsErrorIntro("La ubicación está bloqueada. Tocá el candado junto a la dirección → Ubicación → Permitir, y volvé a tocar el botón.");
            } else if (state === "granted") {
                if (estado) estado.textContent = "Ya estaba autorizado. Buscando tu punto en el mapa…";
            }
        });
        setTimeout(function () {
            if (introGpsResuelto || introPaso !== 1) return;
            taparBarraPermisos();
            if (btn) btn.disabled = false;
            if (estado) estado.textContent = "No llegó el permiso o el GPS tardó. Mirá el candado de la barra de direcciones, o seguí igual.";
            if ($("stepAyuda")) $("stepAyuda").textContent = "Tocá de nuevo «Permitir ubicación» o «Ahora no, seguir».";
            empezarWatchGps();
        }, 8000);
    }

    function mostrarEntrarMapa() {
        $("btnPermitirGps").classList.add("oculto");
        $("btnPermitirMic").classList.add("oculto");
        $("btnSaltarPermiso").classList.add("oculto");
        $("btnStepEmpezar").classList.add("oculto");
        $("btnEntrar").classList.remove("oculto");
        document.querySelectorAll(".stepper-puntos li").forEach(function (li) {
            li.classList.add("ok");
            li.classList.remove("on");
        });
        const ultimo = document.querySelector(".stepper-puntos li[data-i='2']");
        if (ultimo) ultimo.classList.add("on");
    }

    function mostrarPasoIntro(n) {
        introPaso = n;
        [0, 1, 2].forEach(function (i) {
            const el = $("step" + i);
            if (el) el.classList.toggle("oculto", i !== n);
        });
        document.querySelectorAll(".stepper-puntos li").forEach(function (li) {
            const i = Number(li.getAttribute("data-i"));
            li.classList.toggle("on", i === n);
            li.classList.toggle("ok", i < n);
        });
        $("btnStepEmpezar").classList.toggle("oculto", n !== 0);
        $("btnPermitirGps").classList.toggle("oculto", n !== 1);
        $("btnPermitirMic").classList.toggle("oculto", n !== 2);
        $("btnEntrar").classList.add("oculto");
        $("btnSaltarPermiso").classList.toggle("oculto", n === 0);
        $("btnSaltarPermiso").textContent = n === 1 ? "Ahora no, seguir" : "Prefiero después";
        const ayudas = [
            "Sin apuro: en un momento dejamos todo listo para el mapa.",
            "El pedido sale arriba, junto a la dirección del sitio. Tocá Permitir ahí.",
            "Igual que antes: el micrófono se pide arriba, junto a la dirección. Tocá Permitir."
        ];
        if ($("stepAyuda")) $("stepAyuda").textContent = ayudas[n];
        if (n !== 1 && n !== 2) taparBarraPermisos();
    }

    function pedirMicrofonoIntro() {
        const estado = $("estadoMic");
        const btn = $("btnPermitirMic");
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            if (estado) estado.textContent = "Este navegador no deja usar el micrófono. Igual podés entrar al mapa.";
            mostrarEntrarMapa();
            return;
        }
        if (btn) btn.disabled = false;
        descubrirBarraPermisos();
        if (estado) estado.textContent = "Mirá arriba, junto a la dirección: ahí aparece Permitir micrófono.";
        if ($("stepAyuda")) $("stepAyuda").textContent = "Si no ves un cartel, tocá el candado al lado de la URL.";
        consultarPermiso("microphone").then(function (state) {
            if (introPaso !== 2) return;
            if (state === "denied") {
                taparBarraPermisos();
                if (estado) estado.textContent = "El micrófono está bloqueado. Tocá el candado junto a la dirección → Micrófono → Permitir.";
                if (btn) btn.disabled = false;
            } else if (state === "granted") {
                if (estado) estado.textContent = "Ya estaba autorizado. Abriendo el micrófono…";
            }
        });
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            taparBarraPermisos();
            pttStream = stream;
            if (estado) estado.textContent = "Listo. El walkie ya no te va a interrumpir al usarlo.";
            if ($("stepAyuda")) $("stepAyuda").textContent = "GPS y mic listos. Entrá al mapa y hablá cuando quieras.";
            if (btn) btn.disabled = false;
            mostrarEntrarMapa();
        }).catch(function () {
            taparBarraPermisos();
            if (estado) estado.textContent = "Sin problema: cuando quieras hablar, el navegador te lo vuelve a pedir.";
            if ($("stepAyuda")) $("stepAyuda").textContent = "Podés entrar igual. El walkie pide el mic la primera vez que lo uses.";
            if (btn) btn.disabled = false;
            mostrarEntrarMapa();
        });
        setTimeout(function () {
            if (introPaso !== 2 || (pttStream && pttStream.getTracks().some(function (t) { return t.readyState === "live"; }))) return;
            taparBarraPermisos();
            if (btn) btn.disabled = false;
            if (estado && estado.textContent.indexOf("Listo") !== 0) {
                estado.textContent = "No llegó el permiso. Mirá el candado de la barra de direcciones, o seguí igual.";
            }
        }, 8000);
    }

    function entrarAlMapa() {
        taparBarraPermisos();
        localStorage.setItem("radiomap_entro", "1");
        localStorage.setItem("baliza_entro", "1");
        $("portada").classList.add("oculto");
        ctxPtt();
        setTimeout(function () { map.invalidateSize(); }, 80);
    }

    // ===================================================
    // UI
    // ===================================================
    function bindUi() {
        if (yaEntroMapa()) {
            $("portada").classList.add("oculto");
        } else {
            mostrarPasoIntro(0);
        }
        $("btnStepEmpezar").addEventListener("click", function () {
            mostrarPasoIntro(1);
        });
        $("btnPermitirGps").addEventListener("click", function () {
            pedirGpsIntro();
        });
        $("btnPermitirMic").addEventListener("click", pedirMicrofonoIntro);
        $("btnSaltarPermiso").addEventListener("click", function () {
            taparBarraPermisos();
            if (introPaso === 1) mostrarPasoIntro(2);
            else mostrarEntrarMapa();
        });
        $("btnEntrar").addEventListener("click", entrarAlMapa);
        $("btnQueEs").addEventListener("click", function () {
            $("portada").classList.remove("oculto");
            mostrarPasoIntro(0);
        });
        $("chkPopups").addEventListener("change", function () {
            popupsVisibles = $("chkPopups").checked;
            aplicarVisibilidadPopups();
            setTimeout(aplicarVisibilidadPopups, 80);
        });
        $("btnTogglePerfil").addEventListener("click", function () {
            $("formPerfil").classList.toggle("oculto");
        });
        $("btnElegirIcono").addEventListener("click", function (ev) {
            ev.stopPropagation();
            abrirModalIcono();
        });
        $("btnCerrarIcono").addEventListener("click", cerrarModalIcono);
        $("fondoModalIcono").addEventListener("click", cerrarModalIcono);
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") cerrarModalIcono();
        });
        $("btnCentrar").addEventListener("click", function () {
            vistaRadio = false;
            seguirMe = true;
            if (miPosicion) map.setView([miPosicion.lat, miPosicion.lng], 16);
            else iniciarGps();
        });
        $("btnToggleComms").addEventListener("click", toggleComms);
        $("btnCerrarComms").addEventListener("click", function () {
            $("commsPanel").classList.remove("open");
        });
        $("btnActivarGps").addEventListener("click", iniciarGps);
        $("radioFiltro").addEventListener("change", function () {
            renderizarContactos();
            actualizarCirculoRadio(true);
        });
        $("btnEnviarV2V").addEventListener("click", enviarV2V);
        $("btnEnviarPrivado").addEventListener("click", enviarPrivado);
        $("txtV2V").addEventListener("keydown", function (e) {
            if (e.key === "Enter") enviarV2V();
        });
        $("txtPrivado").addEventListener("keydown", function (e) {
            if (e.key === "Enter") enviarPrivado();
        });
        $("btnVozV2V").addEventListener("click", function () {
            vozATexto(function (texto) {
                if (!texto) return;
                $("txtV2V").value = texto;
                enviarV2V();
            });
        });
        $("btnVozPrivado").addEventListener("click", function () {
            if (!contactoActivo) {
                alert("Elegí un contacto primero.");
                return;
            }
            vozATexto(function (texto) {
                if (!texto) return;
                $("txtPrivado").value = texto;
                enviarPrivado();
            });
        });
        document.querySelectorAll(".tab").forEach(function (btn) {
            btn.addEventListener("click", function () {
                mostrarTab(btn.getAttribute("data-tab"));
            });
        });
        bindPtt($("btnPttV2V"), "general");
        bindPtt($("btnPttPrivado"), "privado");
        bindPtt($("btnPttMapa"), "general");
        actualizarDestinoUI();
    }

    function mostrarTab(nombre) {
        tabActiva = nombre;
        document.querySelectorAll(".tab").forEach(function (t) {
            t.classList.toggle("activa", t.getAttribute("data-tab") === nombre);
        });
        $("panelGeneral").classList.toggle("oculto", nombre !== "general");
        $("panelPrivado").classList.toggle("oculto", nombre !== "privado");
        if (nombre === "privado") {
            noLeidos = 0;
            actualizarBadge();
        }
    }

    function toggleComms() {
        $("commsPanel").classList.toggle("open");
    }

    function abrirComms() {
        $("commsPanel").classList.add("open");
    }

    window.addEventListener("resize", function () {
        map.invalidateSize();
    });
})();
