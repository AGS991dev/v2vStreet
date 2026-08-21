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
    const ICONO_CACHE = "20260821c";
    const ICO_MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>';
    const ICO_SENAL = '<svg viewBox="0 0 20 16" aria-hidden="true"><rect x="1" y="10" width="3" height="5" rx="0.6" fill="currentColor"/><rect x="6" y="7" width="3" height="8" rx="0.6" fill="currentColor"/><rect x="11" y="4" width="3" height="11" rx="0.6" fill="currentColor"/><rect x="16" y="1" width="3" height="14" rx="0.6" fill="currentColor"/></svg>';
    const ICO_PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.6-7-11a7 7 0 1 1 14 0c0 6.4-7 11-7 11z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.2" fill="none" stroke="currentColor" stroke-width="1.75"/></svg>';
    const ICO_VEL = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M12 13l4-4M8 13h.01M16 13h.01M12 7h.01" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>';
    const ICO_RUMBO = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M12 4.5v3M12 16.5v3M4.5 12h3M16.5 12h3M12 12l3.2-4.4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>';
    const ICO_PATENTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h12l4 4v7H4V8z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><circle cx="8.5" cy="13.5" r="1.2" fill="currentColor"/></svg>';
    const ICO_SEGURO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V9l8-5 8 5v11H4z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M10 20v-6h4v6" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/></svg>';
    const ICO_TEL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.8h3.4l1.2 4.6-2.4 1.4c.8 1.8 2.2 3.2 4 4l1.4-2.4 4.6 1.2V20h-2.2C9.4 20 4 14.6 4 6V3.8H7z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/></svg>';
    const ICO_MSG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14v10H8l-3 3V6z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/></svg>';
    const ICO_SOS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3.8 19h16.4L12 4z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M12 10v4.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1" fill="currentColor"/></svg>';

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
        closePopupOnClick: false,
        rotate: true,
        bearing: 0,
        rotateControl: false,
        touchRotate: false,
        shiftKeyRotate: false,
        compassBearing: false
    }).setView([-34.6037, -58.3816], 13);
    const capaTiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap &copy; CARTO",
        maxZoom: 19,
        keepBuffer: 8,
        updateWhenIdle: false,
        crossOrigin: true
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
    let radioCercaAbierta = false;
    const RADIO_CERCA_MAX = 9;
    let introPaso = 0;
    let introGpsResuelto = false;
    let permitirSalir = false;
    let iconoCfg = { src: "static/iconos/autos.png", cols: 15, rows: 8, celdaCm: 2, celdaPx: 128 };
    let iconoMosaicoListo = false;
    let mosaicoImg = null;
    const recortesCelda = {};
    let radioTimer = null;
    let miGrupo = localStorage.getItem("radiomap_grupo") || "";
    let modoManejo = localStorage.getItem("radiomap_manejo") === "1";
    let modoNavGps = false;
    let rumboNavSuave = 0;
    let navGpsRaf = null;
    let navGpsZoomPendiente = false;
    let asistenciaActiva = false;
    let wakeLock = null;
    const cacheFichas = {};
    let clickPendiente = null;
    let previewClick = null;
    let navSeq = 0;
    let navegacion = null;
    let encuentros = {};
    let llegasteTimer = null;
    const ENC_KEY = "radiomap_encuentros";
    const NAV_KEY = "radiomap_ruta_activa";
    let ackWalkieTimer = null;
    let busquedaTimer = null;

    function debeMostrarFicha(id) {
        if (modoNavGps && id === miId) return false;
        if (fichasForzadas[id] === "cerrada") return false;
        if (fichasForzadas[id] === "abierta") return true;
        if (id === miId) return false;
        return popupsVisibles;
    }

    function abrirFicha(id) {
        fichasForzadas[id] = "abierta";
        const marker = markers[id];
        if (!marker) return;
        marker.openTooltip();
        silenciarHoverFicha(marker, id);
        requestAnimationFrame(function () { engancharFicha(marker, id); });
        if (id !== miId) pedirFicha(id);
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
            if (id === miId && fichasForzadas[id] === "abierta") {
                cerrarFicha(id);
                return;
            }
            abrirFicha(id);
        });
    }

    function silenciarHoverFicha(marker, id) {
        if (!marker || id !== miId) return;
        marker.off("mouseover");
        marker.off("mouseout");
        marker.off("mousemove");
    }

    function fichaOpts(soyYo, a) {
        const sos = !!(a && a.asistencia && a.asistencia.activo);
        return Object.assign({}, FICHA_BASE, {
            direction: soyYo ? "bottom" : "top",
            offset: soyYo ? [0, 14] : [0, -16],
            permanent: !soyYo,
            className: "ficha" + (soyYo ? " ficha-propia" : " ficha-radio") + (sos ? " ficha-sos" : "")
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
        if (modoNavGps) {
            seguirMe = true;
            return;
        }
        seguirMe = false;
    });

    map.on("click", onClickMapa);

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
        data.radioKm = radioKmActual();
        data.grupo = miGrupo || "";
        return data;
    }

    function normalizarGrupo(valor) {
        return String(valor || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    }

    function codigoDesdeUrl() {
        try {
            const q = new URLSearchParams(location.search);
            return normalizarGrupo(q.get("g") || q.get("grupo"));
        } catch (e) {
            return "";
        }
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
            renderizarContactos();
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

        if (navegacion && llegoDestino([cruda.lat, cruda.lng])) {
            finalizarLlegada();
        }

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

        if (modoNavGps) seguirMe = true;
        if (navGpsZoomPendiente && modoNavGps) {
            navGpsZoomPendiente = false;
            setVistaSeguir([lat, lng], Math.max(map.getZoom(), 17));
        }
        if (debeEmitir(lat, lng)) emitirTelemetria(false);
        renderizarContactos();
        aplicarRumbo(miId, rumbo);
        actualizarNavegacion();
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
        if (!Number.isFinite(Number(deg)) && !(modoNavGps && id === miId)) return;
        const marker = markers[id];
        if (!marker) return;
        const el = marker.getElement();
        if (!el) return;
        const rot = el.querySelector(".auto-rot");
        if (!rot) return;
        let vis = Number(deg);
        if (modoNavGps) {
            vis = id === miId ? 0 : ((vis - rumboNavSuave) + 360) % 360;
        }
        if (Number.isFinite(vis)) rot.style.transform = "rotate(" + vis + "deg)";
        if (Number.isFinite(Number(deg))) {
            if (autos[id]) autos[id].rumbo = Number(deg);
            if (id === miId && miPosicion) miPosicion.rumbo = Number(deg);
        }
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

    function elegirMejorRuta(j) {
        if (!j || j.code !== "Ok" || !j.routes || !j.routes[0]) return null;
        let best = j.routes[0];
        for (let i = 1; i < j.routes.length; i++) {
            const r = j.routes[i];
            const t = Number(r.duration) || 0;
            const d = Number(r.distance) || 0;
            const bt = Number(best.duration) || 0;
            const bd = Number(best.distance) || 0;
            if (t < bt - 5) best = r;
            else if (Math.abs(t - bt) <= 5 && d < bd) best = r;
        }
        return best;
    }

    function extraerPasos(ruta) {
        const out = [];
        ((ruta && ruta.legs) || []).forEach(function (leg) {
            (leg.steps || []).forEach(function (s) { out.push(s); });
        });
        return out;
    }

    function textoModificador(mod) {
        const m = String(mod || "").toLowerCase();
        if (m.indexOf("sharp right") >= 0) return "cerrado a la derecha";
        if (m.indexOf("sharp left") >= 0) return "cerrado a la izquierda";
        if (m.indexOf("slight right") >= 0) return "levemente a la derecha";
        if (m.indexOf("slight left") >= 0) return "levemente a la izquierda";
        if (m === "right") return "a la derecha";
        if (m === "left") return "a la izquierda";
        if (m === "straight") return "derecho";
        if (m === "uturn") return "giro en U";
        return "";
    }

    function textoManiobra(step) {
        if (!step) return "Seguí derecho";
        const man = step.maneuver || {};
        const tipo = String(man.type || "");
        const mod = textoModificador(man.modifier);
        const calle = String(step.name || "").trim();
        if (tipo === "arrive") return "llegás";
        if (tipo === "depart") return calle ? "salí por " + calle : "salí";
        if (tipo === "roundabout" || tipo === "rotary") return "entrá a la rotonda";
        if (tipo === "exit roundabout" || tipo === "exit rotary") {
            return mod ? "salí " + mod : "salí de la rotonda";
        }
        if (tipo === "merge") return mod ? "incorporate " + mod : "incorporate";
        if (tipo === "fork") return mod ? "tomá el ramal " + mod : "tomá el ramal";
        if (tipo === "end of road") return mod ? "al final, " + mod : "al final de la calle";
        if (tipo === "on ramp") return "tomá la rampa";
        if (tipo === "off ramp" || tipo === "exit") return "tomá la salida";
        if (tipo === "uturn" || man.modifier === "uturn") return "giro en U";
        if (tipo === "turn" && mod) return mod;
        if (tipo === "continue" || tipo === "new name") {
            return mod && mod !== "derecho" ? mod : "seguí derecho";
        }
        return mod || "seguí derecho";
    }

    function textoEnMetros(m) {
        if (m < 28) return "Ahora";
        if (m < 1000) return "En " + Math.max(10, Math.round(m / 10) * 10) + " m";
        return "En " + (m / 1000).toFixed(1).replace(".", ",") + " km";
    }

    function pasoVigente(steps, yo, dest) {
        if (!steps || !steps.length) return null;
        for (let i = 0; i < steps.length; i++) {
            const man = steps[i].maneuver || {};
            const loc = man.location;
            if (!loc) continue;
            const p = [loc[1], loc[0]];
            const d = metrosEntre(yo, p);
            const tipo = String(man.type || "");
            if (tipo === "depart" && d < 40) continue;
            if (d > 18) return { step: steps[i], metros: d };
        }
        if (dest) {
            return {
                step: { maneuver: { type: "arrive" }, name: "" },
                metros: metrosEntre(yo, dest)
            };
        }
        return null;
    }

    function distAPath(yo, path) {
        return infoSobreRuta(yo, path).dist;
    }

    function infoSobreRuta(yo, path) {
        const vacio = { dist: Infinity, idx: 0, rumboPath: null, resto: Infinity };
        if (!path || !path.length) return vacio;
        let min = Infinity;
        let idx = 0;
        for (let i = 0; i < path.length; i++) {
            const d = metrosEntre(yo, path[i]);
            if (d < min) {
                min = d;
                idx = i;
            }
        }
        let rumboPath = null;
        if (idx < path.length - 1) rumboPath = rumboEntre(path[idx], path[idx + 1]);
        else if (idx > 0) rumboPath = rumboEntre(path[idx - 1], path[idx]);
        let resto = 0;
        for (let i = idx + 1; i < path.length; i++) resto += metrosEntre(path[i - 1], path[i]);
        resto += metrosEntre(yo, path[idx]);
        return { dist: min, idx: idx, rumboPath: rumboPath, resto: resto };
    }

    function anguloDiff(a, b) {
        let d = Math.abs(Number(a) - Number(b)) % 360;
        if (d > 180) d = 360 - d;
        return d;
    }

    function llegoDestino(yo) {
        if (!navegacion || !navegacion.dest) return false;
        const crow = metrosEntre(yo, navegacion.dest);
        const resto = navegacion.path ? infoSobreRuta(yo, navegacion.path).resto : crow;
        const vel = (miPosicion && miPosicion.velocidad) || 0;
        if (resto > 40 && crow > 25) return false;
        if (crow <= 14) return true;
        if (resto <= 22 && crow <= 30) return true;
        if (crow <= 22 && vel < 10) return true;
        return false;
    }

    function restoRutaMetros(yo) {
        if (!navegacion || !navegacion.path) {
            return navegacion && navegacion.dest ? metrosEntre(yo, navegacion.dest) : 0;
        }
        return infoSobreRuta(yo, navegacion.path).resto;
    }

    function segundosRestantesRuta(yo) {
        const restoM = restoRutaMetros(yo);
        const dist = Number(navegacion && navegacion.distance) || 0;
        const dur = Number(navegacion && navegacion.duration) || 0;
        if (dist > 30 && dur > 0) return Math.max(0, dur * (restoM / dist));
        const velMs = Math.max(((miPosicion && miPosicion.velocidad) || 28) / 3.6, 4);
        return restoM / velMs;
    }

    function textoEta(seg) {
        const t = new Date(Date.now() + Math.max(0, seg) * 1000);
        const p = function (n) { return (n < 10 ? "0" : "") + n; };
        return p(t.getHours()) + ":" + p(t.getMinutes());
    }

    function textoDuracion(seg) {
        if (seg < 45) return "menos de 1 min";
        if (seg < 3600) return Math.round(seg / 60) + " min";
        const h = Math.floor(seg / 3600);
        const m = Math.round((seg % 3600) / 60);
        return h + " h " + (m ? m + " min" : "");
    }

    function puntoHacia(lat, lng, headingDeg, metros) {
        const R = 6371000;
        const brng = Number(headingDeg) * Math.PI / 180;
        const lat1 = Number(lat) * Math.PI / 180;
        const lng1 = Number(lng) * Math.PI / 180;
        const ang = metros / R;
        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brng));
        const lng2 = lng1 + Math.atan2(
            Math.sin(brng) * Math.sin(ang) * Math.cos(lat1),
            Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2)
        );
        return [lat2 * 180 / Math.PI, ((lng2 * 180 / Math.PI + 540) % 360) - 180];
    }

    function metrosCamaraAdelante() {
        const z = map.getZoom();
        if (z >= 18) return 38;
        if (z >= 17) return 68;
        if (z >= 16) return 105;
        return 150;
    }

    function debeCamaraAdelante() {
        return !!(modoNavGps || (navegacion && seguirMe));
    }

    function rumboCamara() {
        if (Number.isFinite(rumboNavSuave) && (modoNavGps || rumboNavSuave)) return rumboNavSuave;
        if (miPosicion && Number.isFinite(miPosicion.rumbo)) return miPosicion.rumbo;
        return 0;
    }

    function centroCamaraNav(lat, lng) {
        const h = rumboCamara();
        if (!Number.isFinite(h)) return [lat, lng];
        return puntoHacia(lat, lng, h, metrosCamaraAdelante());
    }

    function setVistaSeguir(latlng, zoom) {
        const lat = latlng.lat != null ? latlng.lat : latlng[0];
        const lng = latlng.lng != null ? latlng.lng : latlng[1];
        const z = zoom != null ? zoom : map.getZoom();
        if (debeCamaraAdelante()) {
            map.setView(centroCamaraNav(lat, lng), z, { animate: false });
        } else {
            map.setView([lat, lng], z, { animate: false });
        }
    }

    function persistirRuta() {
        if (!navegacion || !navegacion.path) {
            try { localStorage.removeItem(NAV_KEY); } catch (e) {}
            return;
        }
        try {
            localStorage.setItem(NAV_KEY, JSON.stringify({
                dest: navegacion.dest,
                origen: navegacion.origen,
                path: navegacion.path,
                steps: navegacion.steps || [],
                distance: navegacion.distance || 0,
                duration: navegacion.duration || 0,
                sinMarker: !!navegacion.sinMarker,
                ts: Date.now()
            }));
        } catch (e) {}
    }

    function leerRutaGuardada(hasta) {
        try {
            const raw = JSON.parse(localStorage.getItem(NAV_KEY) || "null");
            if (!raw || !raw.path || raw.path.length < 2) return null;
            if (Date.now() - (raw.ts || 0) > 2 * 3600 * 1000) {
                localStorage.removeItem(NAV_KEY);
                return null;
            }
            if (hasta && metrosEntre(raw.dest, hasta) > 40) return null;
            return {
                path: raw.path,
                steps: raw.steps || [],
                distance: raw.distance || 0,
                duration: raw.duration || 0,
                dest: raw.dest,
                sinMarker: !!raw.sinMarker
            };
        } catch (e) {
            return null;
        }
    }

    function rutaCachePorDestino(hasta) {
        const suf = ">" + clavePunto(hasta[0], hasta[1]) + ":n";
        const keys = Object.keys(cacheRuta);
        for (let i = keys.length - 1; i >= 0; i--) {
            if (keys[i].indexOf(suf) === keys[i].length - suf.length) return cacheRuta[keys[i]];
        }
        return null;
    }

    function latLngATile(lat, lng, zoom) {
        const n = Math.pow(2, zoom);
        const x = Math.floor((lng + 180) / 360 * n);
        const latRad = lat * Math.PI / 180;
        const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
        return { x: x, y: y };
    }

    function prefetchTilesRuta(path) {
        if (!path || path.length < 2 || !navigator.onLine) return;
        const z = Math.max(14, Math.min(18, map.getZoom() || 16));
        const retina = (window.devicePixelRatio || 1) >= 1.5 ? "@2x" : "";
        const step = Math.max(1, Math.floor(path.length / 36));
        const vistos = {};
        for (let i = 0; i < path.length; i += step) {
            const t = latLngATile(path[i][0], path[i][1], z);
            const clave = z + "/" + t.x + "/" + t.y;
            if (vistos[clave]) continue;
            vistos[clave] = true;
            const url = "https://a.basemaps.cartocdn.com/light_all/" + clave + retina + ".png";
            fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" }).catch(function () {});
        }
    }

    function rutaPorCalle(desde, hasta, nav) {
        const clave = clavePunto(desde[0], desde[1]) + ">" + clavePunto(hasta[0], hasta[1]) + (nav ? ":n" : "");
        if (cacheRuta[clave]) return Promise.resolve(cacheRuta[clave]);
        const from = Number(desde[1]) + "," + Number(desde[0]);
        const to = Number(hasta[1]) + "," + Number(hasta[0]);
        const extra = nav ? "&nav=1" : "";
        return fetch("/api/osrm/ruta?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to) + extra)
            .then(function (r) {
                if (!r.ok) throw new Error("osrm");
                return r.json();
            })
            .then(function (j) {
                const ruta = elegirMejorRuta(j);
                if (!ruta || !ruta.geometry || !ruta.geometry.coordinates) {
                    return nav ? null : [desde, hasta];
                }
                const path = ruta.geometry.coordinates.map(function (c) {
                    return [c[1], c[0]];
                });
                if (path.length < 2) return nav ? null : [desde, hasta];
                if (Object.keys(cacheRuta).length > 200) {
                    delete cacheRuta[Object.keys(cacheRuta)[0]];
                }
                const res = nav
                    ? {
                        path: path,
                        steps: extraerPasos(ruta),
                        distance: ruta.distance,
                        duration: ruta.duration
                    }
                    : path;
                cacheRuta[clave] = res;
                return res;
            })
            .catch(function () {
                if (!nav) return [desde, hasta];
                return rutaCachePorDestino(hasta) || leerRutaGuardada(hasta);
            });
    }

    function clickSobreUiMapa(ev) {
        const t = ev.originalEvent && ev.originalEvent.target;
        if (!t || !t.closest) return false;
        return !!(t.closest(".leaflet-tooltip") || t.closest(".leaflet-popup") ||
            t.closest(".leaflet-control") || t.closest(".marker-auto") ||
            t.closest(".marker-bandera") || t.closest(".marker-destino"));
    }

    function onClickMapa(ev) {
        if (clickSobreUiMapa(ev)) return;
        if (modalMapaClickVisible() || modalEncuentroVisible() || modalBuscarVisible()) return;
        const lat = ev.latlng && ev.latlng.lat;
        const lng = ev.latlng && ev.latlng.lng;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        clickPendiente = { lat: lat, lng: lng };
        ponerPreview([lat, lng]);
        mostrarModalMapaClick();
    }

    function ponerPreview(latlng) {
        quitarPreview();
        previewClick = L.circleMarker(latlng, {
            radius: 8,
            color: "#d97706",
            weight: 2,
            fillColor: "#f8eedf",
            fillOpacity: 0.95,
            interactive: false
        }).addTo(map);
    }

    function quitarPreview() {
        if (previewClick) {
            map.removeLayer(previewClick);
            previewClick = null;
        }
    }

    function modalMapaClickVisible() {
        const el = $("modalMapaClick");
        return !!(el && !el.classList.contains("oculto"));
    }

    function mostrarModalMapaClick() {
        $("modalMapaClick").classList.remove("oculto");
    }

    function cerrarModalMapaClick(mantenerPreview) {
        $("modalMapaClick").classList.add("oculto");
        if (!mantenerPreview) {
            clickPendiente = null;
            quitarPreview();
        }
    }

    function modalEncuentroVisible() {
        const el = $("modalEncuentro");
        return !!(el && !el.classList.contains("oculto"));
    }

    function valorDatetimeLocal(d) {
        const p = function (n) { return (n < 10 ? "0" : "") + n; };
        return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
            "T" + p(d.getHours()) + ":" + p(d.getMinutes());
    }

    function abrirModalEncuentro() {
        cerrarModalMapaClick(true);
        const ahora = new Date(Date.now() + 30 * 60 * 1000);
        if ($("encNombre")) $("encNombre").value = "";
        if ($("encHorario")) $("encHorario").value = valorDatetimeLocal(ahora);
        if ($("encDesc")) $("encDesc").value = "";
        $("modalEncuentro").classList.remove("oculto");
        setTimeout(function () {
            const el = $("encNombre");
            if (el) el.focus();
        }, 50);
    }

    function cerrarModalEncuentro(mantenerPunto) {
        $("modalEncuentro").classList.add("oculto");
        if (!mantenerPunto) {
            clickPendiente = null;
            quitarPreview();
        }
    }

    function iconoDestino() {
        return L.divIcon({
            className: "marker-destino",
            html: '<div class="pin-destino" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21s-7-4.6-7-11a7 7 0 1 1 14 0c0 6.4-7 11-7 11z" fill="#1e4b7b"/><circle cx="12" cy="10" r="2.4" fill="#fffcf7"/></svg></div>',
            iconSize: [28, 36],
            iconAnchor: [14, 34]
        });
    }

    function iconoBandera() {
        return L.divIcon({
            className: "marker-bandera",
            html: '<div class="bandera" aria-hidden="true"><svg viewBox="0 0 32 40"><path d="M7 38V6" fill="none" stroke="#1f2430" stroke-width="2.2" stroke-linecap="round"/><path d="M8 6h18l-5 7 5 7H8z" fill="#d97706" stroke="#1f2430" stroke-width="1.4" stroke-linejoin="round"/></svg></div>',
            iconSize: [32, 40],
            iconAnchor: [8, 38],
            popupAnchor: [8, -36]
        });
    }

    function limpiarCapaRuta() {
        if (!navegacion) return;
        if (navegacion.capaFondo) {
            map.removeLayer(navegacion.capaFondo);
            navegacion.capaFondo = null;
        }
        if (navegacion.capa) {
            map.removeLayer(navegacion.capa);
            navegacion.capa = null;
        }
        if (navegacion.markerDest) {
            map.removeLayer(navegacion.markerDest);
            navegacion.markerDest = null;
        }
    }

    function cancelarNavegacion() {
        navSeq += 1;
        limpiarCapaRuta();
        navegacion = null;
        try { localStorage.removeItem(NAV_KEY); } catch (e) {}
        const hud = $("hudRuta");
        if (hud) hud.classList.add("oculto");
    }

    function cartelLlegasteVisible() {
        const el = $("cartelLlegaste");
        return !!(el && !el.classList.contains("oculto"));
    }

    function ocultarCartelLlegaste() {
        const el = $("cartelLlegaste");
        if (el) el.classList.add("oculto");
        if (llegasteTimer) {
            clearTimeout(llegasteTimer);
            llegasteTimer = null;
        }
    }

    function mostrarCartelLlegaste() {
        const el = $("cartelLlegaste");
        if (!el) return;
        el.classList.remove("oculto");
        if (llegasteTimer) clearTimeout(llegasteTimer);
        llegasteTimer = setTimeout(ocultarCartelLlegaste, 5000);
    }

    function finalizarLlegada() {
        cancelarNavegacion();
        mostrarCartelLlegaste();
    }

    function dibujarRuta(path, dest, sinMarker, ajustarVista) {
        if (!navegacion) return;
        if (navegacion.capaFondo) map.removeLayer(navegacion.capaFondo);
        if (navegacion.capa) map.removeLayer(navegacion.capa);
        navegacion.capaFondo = L.polyline(path, {
            color: "#fff",
            weight: 8,
            opacity: 0.9,
            interactive: false
        }).addTo(map);
        navegacion.capa = L.polyline(path, {
            color: "#1e4b7b",
            weight: 5,
            opacity: 0.95,
            interactive: false
        }).addTo(map);
        if (!sinMarker) {
            if (!navegacion.markerDest) {
                navegacion.markerDest = L.marker(dest, {
                    icon: iconoDestino(),
                    zIndexOffset: 700,
                    keyboard: false,
                    title: "Destino"
                }).addTo(map);
            } else {
                navegacion.markerDest.setLatLng(dest);
            }
        } else if (navegacion.markerDest) {
            map.removeLayer(navegacion.markerDest);
            navegacion.markerDest = null;
        }
        if (ajustarVista && !modoNavGps) {
            try {
                map.fitBounds(navegacion.capa.getBounds(), {
                    padding: [56, 56],
                    maxZoom: 16,
                    animate: true
                });
            } catch (e) {}
        }
        prefetchTilesRuta(path);
        persistirRuta();
    }

    function actualizarHudRuta() {
        const hud = $("hudRuta");
        const dist = $("hudRutaDist");
        const pasoEl = $("hudRutaPaso");
        const calleEl = $("hudRutaCalle");
        const etaEl = $("hudRutaEta");
        if (!hud) return;
        if (!navegacion) {
            hud.classList.add("oculto");
            return;
        }
        if (!miPosicion) {
            hud.classList.add("oculto");
            return;
        }
        const yo = [miPosicion.lat, miPosicion.lng];
        const restoM = restoRutaMetros(yo);
        const vigente = pasoVigente(navegacion.steps, yo, navegacion.dest);
        if (pasoEl) {
            if (vigente) {
                pasoEl.textContent = textoEnMetros(vigente.metros) + ", " + textoManiobra(vigente.step);
            } else {
                pasoEl.textContent = "Seguí la ruta";
            }
        }
        if (calleEl) {
            const nom = vigente && vigente.step && vigente.step.name ? String(vigente.step.name).trim() : "";
            calleEl.textContent = nom;
            calleEl.classList.toggle("oculto", !nom);
        }
        if (dist) dist.textContent = "Quedan " + textoDistancia(restoM / 1000);
        if (etaEl) {
            const seg = segundosRestantesRuta(yo);
            etaEl.textContent = textoDuracion(seg) + " · Llegás " + textoEta(seg);
        }
        hud.classList.remove("oculto");
    }

    function iniciarNavegacion(dest, opts) {
        opts = opts || {};
        if (!miPosicion) {
            alert("Activá la ubicación para trazar el camino.");
            iniciarGps();
            return;
        }
        const yo = [miPosicion.lat, miPosicion.lng];
        const hasta = [Number(dest[0]), Number(dest[1])];
        if (llegoDestino(yo) || (metrosEntre(yo, hasta) <= 16 && (miPosicion.velocidad || 0) < 8)) {
            if (navegacion) finalizarLlegada();
            else {
                alert("Ya estás en ese punto.");
            }
            return;
        }
        const hud = $("hudRuta");
        const pasoEl = $("hudRutaPaso");
        const dist = $("hudRutaDist");
        if (hud) hud.classList.remove("oculto");
        if (pasoEl) pasoEl.textContent = "Armando ruta…";
        if (dist) dist.textContent = "";
        if (navegacion) navegacion.ts = Date.now();
        const seq = ++navSeq;
        const primera = !navegacion || opts.ajustarVista !== false;
        rutaPorCalle(yo, hasta, true).then(function (res) {
            if (seq !== navSeq) return;
            const path = res && res.path ? res.path : null;
            if (!path || path.length < 2) {
                if (!navegacion) {
                    alert("No pudimos armar la ruta por las calles. Probá de nuevo.");
                    cancelarNavegacion();
                } else {
                    actualizarHudRuta();
                }
                return;
            }
            const previa = navegacion;
            navegacion = {
                dest: hasta,
                origen: yo,
                path: path,
                steps: (res && res.steps) || [],
                distance: Number(res && res.distance) || longitudPath(path),
                duration: Number(res && res.duration) || 0,
                ts: Date.now(),
                sinMarker: !!opts.sinMarker,
                capaFondo: previa && previa.capaFondo,
                capa: previa && previa.capa,
                markerDest: previa && previa.markerDest
            };
            dibujarRuta(path, hasta, !!opts.sinMarker, primera && !modoNavGps);
            if (primera || modoNavGps) seguirMe = true;
            actualizarHudRuta();
            persistirRuta();
        });
    }

    function actualizarNavegacion() {
        if (!navegacion || !miPosicion) return;
        const yo = [miPosicion.lat, miPosicion.lng];
        if (llegoDestino(yo)) {
            finalizarLlegada();
            return;
        }
        actualizarHudRuta();
        const info = infoSobreRuta(yo, navegacion.path);
        const vel = miPosicion.velocidad || 0;
        const umbral = vel > 55 ? 46 : (vel > 28 ? 36 : 26);
        const cooldown = vel > 40 ? 1100 : 1600;
        const rumbo = Number.isFinite(miPosicion.rumbo) ? miPosicion.rumbo : null;
        const contra = rumbo != null && info.rumboPath != null &&
            anguloDiff(rumbo, info.rumboPath) > 50 && info.dist > 16;
        const fuera = info.dist > umbral;
        if ((fuera || contra) && Date.now() - navegacion.ts > cooldown) {
            iniciarNavegacion(navegacion.dest, {
                sinMarker: !!navegacion.sinMarker,
                ajustarVista: false
            });
        }
    }

    function irHastaClick() {
        const p = clickPendiente;
        cerrarModalMapaClick(true);
        quitarPreview();
        if (!p) return;
        iniciarNavegacion([p.lat, p.lng], { sinMarker: false, ajustarVista: true });
        clickPendiente = null;
    }

    function modalBuscarVisible() {
        const el = $("modalBuscar");
        return !!(el && !el.classList.contains("oculto"));
    }

    function abrirModalBuscar() {
        $("modalBuscar").classList.remove("oculto");
        const lista = $("listaBuscar");
        const estado = $("buscarEstado");
        if (lista) lista.innerHTML = "";
        if (estado) estado.textContent = "";
        setTimeout(function () {
            const el = $("txtBuscarLugar");
            if (el) el.focus();
        }, 50);
    }

    function cerrarModalBuscar() {
        $("modalBuscar").classList.add("oculto");
        if (busquedaTimer) {
            clearTimeout(busquedaTimer);
            busquedaTimer = null;
        }
    }

    function pintarResultadosBuscar(lista) {
        const caja = $("listaBuscar");
        const estado = $("buscarEstado");
        if (!caja) return;
        caja.innerHTML = "";
        if (!lista || !lista.length) {
            if (estado) estado.textContent = "No encontramos ese lugar. Probá con la calle y la localidad.";
            return;
        }
        if (estado) estado.textContent = "";
        lista.forEach(function (item) {
            const btn = document.createElement("button");
            btn.type = "button";
            const dist = Number.isFinite(Number(item.km))
                ? '<em>' + esc(textoDistancia(item.km)) + "</em>"
                : "";
            btn.innerHTML = dist + "<span>" + esc(item.nombre) + "</span>";
            btn.addEventListener("click", function () {
                cerrarModalBuscar();
                iniciarNavegacion([item.lat, item.lng], { sinMarker: false, ajustarVista: !modoNavGps });
                if (modoNavGps) seguirMe = true;
            });
            caja.appendChild(btn);
        });
    }

    function buscarLugar(q) {
        const estado = $("buscarEstado");
        const texto = String(q || "").trim();
        if (texto.length < 3) {
            if (estado) estado.textContent = "Escribí al menos 3 letras.";
            return;
        }
        if (!navigator.onLine) {
            if (estado) estado.textContent = "Sin señal. No se puede buscar ahora.";
            return;
        }
        if (estado) estado.textContent = "Buscando…";
        let url = "/api/geo/buscar?q=" + encodeURIComponent(texto);
        if (miPosicion) {
            url += "&lat=" + encodeURIComponent(miPosicion.lat) + "&lng=" + encodeURIComponent(miPosicion.lng);
        }
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j || !j.ok) {
                    if (estado) estado.textContent = (j && j.error) || "No pudimos buscar. Probá de nuevo.";
                    return;
                }
                let lista = j.resultados || [];
                if (miPosicion) {
                    lista = lista.slice().sort(function (a, b) {
                        const da = Number.isFinite(Number(a.km)) ? a.km : Infinity;
                        const db = Number.isFinite(Number(b.km)) ? b.km : Infinity;
                        return da - db;
                    });
                }
                pintarResultadosBuscar(lista);
            })
            .catch(function () {
                if (estado) estado.textContent = "No pudimos buscar. Mirá si hay internet.";
            });
    }

    function onInputBuscar() {
        const el = $("txtBuscarLugar");
        const q = el ? el.value.trim() : "";
        if (busquedaTimer) clearTimeout(busquedaTimer);
        if (q.length < 3) {
            const estado = $("buscarEstado");
            const lista = $("listaBuscar");
            if (estado) estado.textContent = "";
            if (lista) lista.innerHTML = "";
            return;
        }
        busquedaTimer = setTimeout(function () { buscarLugar(q); }, 450);
    }

    function pintarAvisoOffline() {
        const el = $("avisoOffline");
        if (!el) return;
        el.classList.toggle("oculto", navigator.onLine);
    }

    function restaurarRutaGuardada() {
        const raw = leerRutaGuardada(null);
        if (!raw || !raw.path) return;
        navegacion = {
            dest: raw.dest,
            origen: raw.path[0],
            path: raw.path,
            steps: raw.steps || [],
            distance: raw.distance || 0,
            duration: raw.duration || 0,
            ts: Date.now(),
            sinMarker: !!raw.sinMarker,
            capaFondo: null,
            capa: null,
            markerDest: null
        };
        dibujarRuta(raw.path, raw.dest, !!raw.sinMarker, false);
        actualizarHudRuta();
    }

    function htmlEncuentro(p) {
        const horario = p.horario ? formatearFechaHora(new Date(p.horario).getTime()) : "";
        const mio = !p.de || p.de === miId;
        return (
            '<div class="popup-encuentro-cuerpo" data-enc="' + esc(p.id) + '">' +
                "<h4>" + esc(p.nombre || "Encuentro") + "</h4>" +
                (horario ? '<p class="enc-horario">' + esc(horario) + "</p>" : "") +
                (p.descripcion ? "<p>" + esc(p.descripcion) + "</p>" : "") +
                (mio
                    ? '<button type="button" data-accion="quitar-enc">Quitar</button>'
                    : '<p class="enc-horario">Compartido en la radio</p>') +
            "</div>"
        );
    }

    function engancharPopupEncuentro(marker, id) {
        marker.on("popupopen", function () {
            const root = marker.getPopup() && marker.getPopup().getElement();
            if (!root) return;
            const btn = root.querySelector("[data-accion='quitar-enc']");
            if (btn) {
                btn.onclick = function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    quitarEncuentro(id);
                };
            }
        });
    }

    function ponerBanderaEncuentro(p, abrir) {
        const marker = L.marker([p.lat, p.lng], {
            icon: iconoBandera(),
            zIndexOffset: 650,
            title: p.nombre || "Punto de encuentro",
            riseOnHover: true
        }).addTo(map);
        marker.bindPopup(htmlEncuentro(p), {
            className: "popup-encuentro",
            closeButton: true,
            autoPan: true
        });
        marker.on("click", function (ev) {
            L.DomEvent.stopPropagation(ev);
            iniciarNavegacion([p.lat, p.lng], { sinMarker: true, ajustarVista: true });
        });
        engancharPopupEncuentro(marker, p.id);
        p.marker = marker;
        encuentros[p.id] = p;
        if (abrir) marker.openPopup();
        return marker;
    }

    function aplicarEncuentro(raw, abrir) {
        if (!raw || !Number.isFinite(Number(raw.lat)) || !Number.isFinite(Number(raw.lng))) return;
        const p = {
            id: raw.id || ("enc" + Date.now().toString(36)),
            lat: Number(raw.lat),
            lng: Number(raw.lng),
            nombre: String(raw.nombre || "Encuentro").slice(0, 40),
            horario: raw.horario || "",
            descripcion: String(raw.descripcion || "").slice(0, 200),
            de: raw.de || "",
            grupo: raw.grupo || "",
            pendiente: !!raw.pendiente,
            ts: raw.ts || Date.now()
        };
        const prev = encuentros[p.id];
        if (prev && prev.marker) {
            prev.lat = p.lat;
            prev.lng = p.lng;
            prev.nombre = p.nombre;
            prev.horario = p.horario;
            prev.descripcion = p.descripcion;
            prev.de = p.de || prev.de;
            prev.grupo = p.grupo;
            prev.pendiente = false;
            prev.marker.setLatLng([p.lat, p.lng]);
            prev.marker.setPopupContent(htmlEncuentro(prev));
            encuentros[p.id] = prev;
            if (abrir) prev.marker.openPopup();
            return prev;
        }
        return ponerBanderaEncuentro(p, abrir);
    }

    function guardarEncuentros() {
        const lista = [];
        Object.keys(encuentros).forEach(function (id) {
            const p = encuentros[id];
            lista.push({
                id: p.id,
                lat: p.lat,
                lng: p.lng,
                nombre: p.nombre || "",
                horario: p.horario || "",
                descripcion: p.descripcion || "",
                de: p.de || "",
                grupo: p.grupo || "",
                ts: p.ts || Date.now()
            });
        });
        try {
            localStorage.setItem(ENC_KEY, JSON.stringify(lista));
        } catch (e) {}
    }

    function restaurarEncuentros() {
        let lista = [];
        try {
            lista = JSON.parse(localStorage.getItem(ENC_KEY) || "[]");
        } catch (e) {
            lista = [];
        }
        if (!Array.isArray(lista)) return;
        lista.forEach(function (p) { aplicarEncuentro(p, false); });
    }

    function sincronizarEncuentros(lista) {
        if (!Array.isArray(lista)) return;
        const vistos = {};
        lista.forEach(function (p) {
            if (!p || !p.id) return;
            vistos[p.id] = true;
            aplicarEncuentro(p, false);
        });
        Object.keys(encuentros).forEach(function (id) {
            if (vistos[id]) return;
            const e = encuentros[id];
            if (e && ((!e.de || e.de === miId) || (e.pendiente && Date.now() - (e.ts || 0) < 20000))) return;
            quitarEncuentro(id, true);
        });
        guardarEncuentros();
    }

    function quitarEncuentro(id, remoto) {
        const p = encuentros[id];
        if (!p) return;
        if (p.marker) map.removeLayer(p.marker);
        delete encuentros[id];
        guardarEncuentros();
        if (navegacion && metrosEntre(navegacion.dest, [p.lat, p.lng]) < 8) {
            cancelarNavegacion();
        }
        if (!remoto && (!p.de || p.de === miId) && socket.connected) {
            socket.emit("encuentroQuitar", { id: id });
        }
    }

    function guardarEncuentroDesdeForm() {
        const p = clickPendiente;
        if (!p) {
            cerrarModalEncuentro();
            return;
        }
        const nombre = ($("encNombre") && $("encNombre").value.trim()) || "Encuentro";
        const horario = $("encHorario") ? $("encHorario").value : "";
        const descripcion = $("encDesc") ? $("encDesc").value.trim() : "";
        const id = "enc" + Date.now().toString(36);
        cerrarModalEncuentro(true);
        quitarPreview();
        clickPendiente = null;
        const punto = {
            id: id,
            lat: p.lat,
            lng: p.lng,
            nombre: nombre.slice(0, 40),
            horario: horario,
            descripcion: descripcion.slice(0, 200),
            de: miId,
            grupo: miGrupo || "",
            pendiente: true,
            ts: Date.now()
        };
        anclarACalle(p.lat, p.lng).then(function (snap) {
            punto.lat = snap[0];
            punto.lng = snap[1];
            aplicarEncuentro(punto, true);
            guardarEncuentros();
            socket.emit("encuentroCrear", {
                id: punto.id,
                lat: punto.lat,
                lng: punto.lng,
                nombre: punto.nombre,
                horario: punto.horario,
                descripcion: punto.descripcion
            }, function (res) {
                if (res && res.ok && res.encuentro) aplicarEncuentro(res.encuentro, false);
                guardarEncuentros();
            });
        });
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
            if (soyYo && (seguirMe || modoNavGps)) setVistaSeguir(p);
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
        const el = $("radioFiltro");
        const n = parseFloat(el && el.value);
        return Number.isFinite(n) && n > 0 ? n : 5;
    }

    function restaurarRadioGuardado() {
        const raw = localStorage.getItem("radiomap_radio");
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) return;
        const el = $("radioFiltro");
        if (!el) return;
        const ok = Array.prototype.some.call(el.options, function (o) {
            return parseFloat(o.value) === n;
        });
        if (ok) el.value = String(n);
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
    function datosFichaDe(a) {
        if (!a) return { placa: "", seguro: "", contacto: "" };
        if (a.id === miId) {
            return {
                placa: $("placa").value.trim(),
                seguro: $("seguro").value.trim(),
                contacto: $("contacto").value.trim()
            };
        }
        return cacheFichas[a.id] || null;
    }

    function fichaDato(ico, lab, val) {
        if (val == null || val === "") return "";
        return '<div class="ficha-dato"><span class="ficha-dato-lab">' + ico + " " + esc(lab) + "</span><strong>" + esc(val) + "</strong></div>";
    }

    function fichaHtml(a) {
        const soyYo = a.id === miId;
        const det = datosFichaDe(a);
        const placa = det ? det.placa : "";
        const telRaw = det ? det.contacto : "";
        const tel = (telRaw || "").replace(/[^\d+]/g, "");
        const nombre = soyYo ? "YO" : (a.nombre || "Sin nombre");
        const sos = !!(a.asistencia && a.asistencia.activo) || (soyYo && asistenciaActiva);
        const ausente = !soyYo && !!a.ausente;
        const vehiculo = a.vehiculo || "Vehículo";
        const lineaVeh = placa ? (vehiculo + " · " + placa) : vehiculo;
        let dist = "";
        if (!soyYo && miPosicion && a.lat && a.lng) {
            dist = textoDistancia(calcularDistanciaKm(miPosicion.lat, miPosicion.lng, a.lat, a.lng));
        }
        const estadoTxt = sos
            ? "Pide ayuda"
            : (ausente
                ? "Sin señal" + (textoHace(a.ultimaActualizacion) ? " · " + textoHace(a.ultimaActualizacion) : "")
                : "Conectado");
        const estadoLinea = dist ? (estadoTxt + " · " + dist) : estadoTxt;
        const walkie = soyYo ? "" : (
            '<div class="walkie-radio">' +
                '<button type="button" class="btn-walkie-redondo" data-accion="walkie" aria-label="Mantené para hablar">' +
                    '<span class="walkie-ondas" aria-hidden="true"></span>' +
                    '<span class="walkie-mic-grande">' + ICO_MIC + "</span>" +
                "</button>" +
                '<p class="walkie-idle"><strong>Mantené para hablar</strong><small>Soltá para escuchar</small></p>' +
                '<p class="walkie-on"><strong>Hablando</strong><small>Soltá para enviar</small></p>' +
            "</div>"
        );
        let extra = "";
        if (soyYo) {
            extra = '<div class="acciones-sec">' +
                '<button type="button" class="btn-ficha" data-accion="sos">' +
                    ICO_SOS + (sos ? " Cancelar ayuda" : " Pedir ayuda") +
                "</button>" +
                "</div>";
        } else {
            extra = '<div class="acciones-sec">' +
                '<button type="button" class="btn-ficha" data-accion="mensaje">' + ICO_MSG + " Escribir</button>" +
                (tel
                    ? '<a href="tel:' + esc(tel) + '">' + ICO_TEL + " Llamar</a>"
                    : '<button type="button" class="btn-ficha" data-accion="ficha">' + ICO_SEGURO + " Ver datos</button>") +
                "</div>";
        }

        return (
            '<div class="v2v-popup' + (soyYo ? " v2v-popup-propia" : " v2v-popup-radio") + '" data-id="' + esc(a.id) + '">' +
                '<div class="v2v-popup-top">' +
                    '<p class="para">' + (sos ? "Pide ayuda" : "Radio en directo") + "</p>" +
                    '<button type="button" class="btn-cerrar-ficha" data-accion="cerrar" title="Cerrar" aria-label="Cerrar">' +
                        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>' +
                    "</button>" +
                "</div>" +
                "<h4>" + esc(nombre) + "</h4>" +
                '<p class="ficha-vehiculo">' + esc(lineaVeh) + "</p>" +
                '<p class="ficha-estado' + (ausente ? " ausente" : "") + (sos ? " sos" : "") + '">' +
                    '<span class="ficha-senal" aria-hidden="true">' + ICO_SENAL + "</span>" +
                    esc(estadoLinea) +
                "</p>" +
                walkie + extra +
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
                    if (btn.parentElement) btn.parentElement.classList.add("grabando");
                };
                btn.onpointerup = function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    btn.classList.remove("grabando");
                    if (btn.parentElement) btn.parentElement.classList.remove("grabando");
                    detenerPtt();
                };
                btn.onpointercancel = function () {
                    btn.classList.remove("grabando");
                    if (btn.parentElement) btn.parentElement.classList.remove("grabando");
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
                if (accion === "ficha") pedirFicha(id);
                if (accion === "sos") alternarAsistencia();
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
                title: a.nombre || (soyYo ? "YO" : "Vehículo")
            }).addTo(map);
            marker.bindTooltip(fichaHtml(a), fichaOpts(soyYo, a));
            markers[a.id] = marker;
            engancharClickMarker(marker, a.id);
            silenciarHoverFicha(marker, a.id);
            aplicarIconoEnMarker(a.id, iconoDeAuto(a));
            marcarSosMarker(a.id, !!(a.asistencia && a.asistencia.activo));
            marcarAusente(a.id, !!a.ausente);
            requestAnimationFrame(function () {
                aplicarRumbo(a.id, a.rumbo);
                aplicarIconoEnMarker(a.id, iconoDeAuto(a));
                marcarAusente(a.id, !!a.ausente);
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
        marcarSosMarker(a.id, !!(a.asistencia && a.asistencia.activo));
        marcarAusente(a.id, !!a.ausente);
        refrescarFicha(a.id, a);
    }

    function refrescarFicha(id, a) {
        const m = markers[id];
        if (!m || pttActivo) return;
        const opts = fichaOpts(id === miId, a);
        const tip = m.getTooltip();
        const misma = tip && tip.options && tip.options.className === opts.className;
        if (!tip || !misma) {
            const abierta = m.isTooltipOpen && m.isTooltipOpen();
            m.unbindTooltip();
            m.bindTooltip(fichaHtml(a), opts);
            silenciarHoverFicha(m, id);
            if (debeMostrarFicha(id) || (abierta && id !== miId)) {
                m.openTooltip();
                requestAnimationFrame(function () { engancharFicha(m, id); });
            } else {
                m.closeTooltip();
            }
            return;
        }
        m.setTooltipContent(fichaHtml(a));
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
        delete cacheFichas[id];
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
    function obtenerListaCerca() {
        const lista = [];
        Object.keys(autos).forEach(function (id) {
            if (id === miId) return;
            const a = autos[id];
            if (!a || !a.lat || !a.lng) return;
            const dist = miPosicion
                ? calcularDistanciaKm(miPosicion.lat, miPosicion.lng, a.lat, a.lng)
                : null;
            lista.push({
                id: id,
                a: a,
                dist: dist,
                enGrupo: !!a.enGrupo || !!(miGrupo && a.grupo && a.grupo === miGrupo),
                sos: !!(a.asistencia && a.asistencia.activo)
            });
        });
        lista.sort(function (x, y) {
            if (x.sos !== y.sos) return x.sos ? -1 : 1;
            if (x.enGrupo !== y.enGrupo) return x.enGrupo ? -1 : 1;
            const dx = x.dist == null ? 9999 : x.dist;
            const dy = y.dist == null ? 9999 : y.dist;
            return dx - dy;
        });
        return lista;
    }

    function htmlAvatarCerca(a) {
        const xy = iconoDeAuto(a);
        const rec = recorteCelda(xy.x, xy.y);
        if (rec && rec.url) {
            return '<img alt="" src="' + rec.url + '">';
        }
        return ICO_PIN;
    }

    function engancharWalkieCerca(btn, id) {
        if (!btn) return;
        btn.addEventListener("pointerdown", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            ctxPtt();
            if (btn.setPointerCapture) btn.setPointerCapture(ev.pointerId);
            seleccionarContacto(id, true);
            empezarPtt("privado");
            btn.classList.add("grabando");
        });
        btn.addEventListener("pointerup", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            btn.classList.remove("grabando");
            detenerPtt();
        });
        btn.addEventListener("pointercancel", function () {
            btn.classList.remove("grabando");
            detenerPtt();
        });
        btn.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
    }

    function crearFilaRadioCerca(item) {
        const fila = document.createElement("div");
        fila.className = "radio-cerca-item" +
            (item.sos ? " sos" : "") +
            (item.a.ausente ? " ausente" : "") +
            (contactoActivo === item.id ? " activo" : "");
        fila.setAttribute("data-id", item.id);
        const nom = item.a.nombre || "Sin nombre";
        const dist = item.dist == null ? "—" : textoDistancia(item.dist);
        fila.innerHTML =
            '<div class="radio-cerca-meta">' +
                "<strong>" + esc(nom) + "</strong>" +
                "<small>" + esc(dist) + "</small>" +
            "</div>" +
            '<button type="button" class="hud-btn hud-ico radio-cerca-mic" title="Mantené para hablarle a ' + esc(nom) + '">' +
                ICO_MIC +
                "<span>Walkie</span>" +
            "</button>" +
            '<button type="button" class="hud-btn hud-ico radio-cerca-auto" title="' + esc(nom) + '">' +
                htmlAvatarCerca(item.a) +
                "<span>" + esc(nom) + "</span>" +
            "</button>";
        const btnAuto = fila.querySelector(".radio-cerca-auto");
        btnAuto.addEventListener("click", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            seleccionarContacto(item.id);
            abrirFicha(item.id);
            const a = item.a;
            if (a && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng))) {
                map.setView([a.lat, a.lng], Math.max(map.getZoom(), 16));
            }
        });
        engancharWalkieCerca(fila.querySelector(".radio-cerca-mic"), item.id);
        return fila;
    }

    function renderizarRadioCerca(lista) {
        const el = $("radioCerca");
        if (!el || pttActivo) return;
        lista = lista || obtenerListaCerca();
        const radio = radioKmActual();
        const enRadio = lista.filter(function (item) {
            if (item.enGrupo) return true;
            if (item.dist == null) return true;
            return item.dist <= radio;
        });
        el.innerHTML = "";
        if (!enRadio.length) {
            radioCercaAbierta = false;
            el.classList.remove("abierta");
            return;
        }
        if (enRadio.length <= RADIO_CERCA_MAX) radioCercaAbierta = false;
        const hayExtra = enRadio.length > RADIO_CERCA_MAX;
        const visibles = (!hayExtra || radioCercaAbierta)
            ? enRadio
            : enRadio.slice(0, RADIO_CERCA_MAX - 1);
        visibles.forEach(function (item) {
            el.appendChild(crearFilaRadioCerca(item));
        });
        if (hayExtra && !radioCercaAbierta) {
            const n = enRadio.length - visibles.length;
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "hud-btn hud-ico radio-cerca-mas";
            btn.title = "Ver " + n + " más en la radio";
            btn.innerHTML = "<strong>+" + n + "</strong><span>Más</span>";
            btn.addEventListener("click", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                radioCercaAbierta = true;
                renderizarRadioCerca(enRadio);
            });
            el.appendChild(btn);
        } else if (hayExtra) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "hud-btn hud-ico radio-cerca-mas on";
            btn.title = "Ocultar";
            btn.innerHTML = "<strong>×</strong><span>Cerrar</span>";
            btn.addEventListener("click", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                radioCercaAbierta = false;
                renderizarRadioCerca(enRadio);
            });
            el.appendChild(btn);
        }
        el.classList.toggle("abierta", radioCercaAbierta);
    }

    function renderizarContactos() {
        const contenedor = $("listaContactos");
        const lista = obtenerListaCerca();
        renderizarRadioCerca(lista);
        contenedor.innerHTML = "";

        if (!miPosicion && !lista.length) {
            contenedor.innerHTML = '<p class="vacio">Activá la ubicación para armar la RADIO.</p>';
            actualizarResumenRed();
            return;
        }

        if (!lista.length) {
            contenedor.innerHTML = '<p class="vacio">Nadie en tu RADIO' +
                (miGrupo ? " ni en el grupo " + esc(miGrupo) : " de " + radioKmActual() + " km") +
                ". Compartí el enlace o un código de grupo.</p>";
            actualizarResumenRed(0);
            return;
        }

        lista.forEach(function (item, idx) {
            const div = document.createElement("div");
            const primero = idx === 0 && !item.sos;
            div.className = "contacto" +
                (contactoActivo === item.id ? " activo" : "") +
                (primero ? " mas-cerca" : "") +
                (item.sos ? " contacto-sos" : "") +
                (item.enGrupo ? " contacto-grupo" : "") +
                (item.a.ausente ? " contacto-ausente" : "");
            const tags =
                (item.sos ? '<em class="tag-cerca tag-sos">Pide ayuda</em>' : "") +
                (item.a.ausente ? '<em class="tag-cerca">' + esc(textoHace(item.a.ultimaActualizacion) || "Sin señal") + "</em>" : "") +
                (item.enGrupo ? '<em class="tag-cerca">Grupo</em>' : "") +
                (primero && !item.enGrupo && !item.a.ausente ? '<em class="tag-cerca">Más cerca de vos</em>' : "");
            div.innerHTML =
                "<div><strong>" + esc(item.a.nombre || "Sin nombre") + "</strong>" +
                tags +
                "<small>" + esc(item.a.vehiculo || "Vehículo") + "</small></div>" +
                '<div class="acciones-mini">' +
                '<span class="dist">' + ICO_PIN + " " +
                    esc(item.dist == null ? "—" : textoDistancia(item.dist)) + "</span>" +
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

    function etiquetaCanal() {
        return miGrupo ? ("GRUPO " + miGrupo) : "RADIO";
    }

    function actualizarDestinoUI(cerca) {
        const radio = radioKmActual();
        const n = typeof cerca === "number" ? cerca : Object.keys(autos).filter(function (id) { return id !== miId; }).length;
        const canal = etiquetaCanal();
        const detalle = miGrupo
            ? (canal + (n ? " · " + n + (n === 1 ? " auto" : " autos") : ""))
            : ("RADIO · " + radio + " km" + (n ? " · " + n + (n === 1 ? " auto" : " autos") : ""));
        if ($("destinoNombre")) $("destinoNombre").textContent = detalle;
        if ($("destinoKicker")) $("destinoKicker").textContent = "Walkie y avisos van a";
        if ($("destinoConvoyDetalle")) $("destinoConvoyDetalle").textContent = detalle;
        if ($("txtV2V")) $("txtV2V").placeholder = "Aviso a " + canal + "…";
        if ($("lblTabRadio")) $("lblTabRadio").textContent = miGrupo ? "Canal GRUPO" : "Canal RADIO";
        const pttSmall = document.querySelector("#btnPttMapa .ptt-leyenda small");
        if (pttSmall) pttSmall.textContent = "Walkie a " + canal;
        const btnRadio = $("btnEnviarV2V");
        if (btnRadio) {
            const txt = btnRadio.childNodes[btnRadio.childNodes.length - 1];
            if (txt && txt.nodeType === 3) txt.textContent = miGrupo ? " GRUPO" : " RADIO";
        }
        if (contactoActivo && autos[contactoActivo] && $("lblEnviarPrivado")) {
            const nom = autos[contactoActivo].nombre || "esa persona";
            $("lblEnviarPrivado").textContent = "A " + nom;
            $("txtPrivado").placeholder = "Mensaje a " + nom + "…";
        }
        pintarEstadoGrupo();
    }

    function seleccionarContacto(id, silencioso) {
        const a = autos[id];
        if (!a) return;
        contactoActivo = id;
        pedirFicha(id);
        const det = cacheFichas[id];
        $("contactoSeleccionado").textContent =
            (a.nombre || "Sin nombre") + " · " + (a.vehiculo || "Vehículo") +
            (det && det.placa ? " · " + det.placa : "");
        if ($("lblEnviarPrivado")) $("lblEnviarPrivado").textContent = "A " + (a.nombre || "esa persona");
        if ($("txtPrivado")) $("txtPrivado").placeholder = "Mensaje a " + (a.nombre || "esa persona") + "…";
        pintarHistorialPrivado(id);
        if (!silencioso && !pttActivo) renderizarContactos();
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

    function agregarMensaje(cont, nombre, texto, propio, ts, extraClass) {
        const div = document.createElement("div");
        div.className = "msg" + (propio ? " propio" : "") + (extraClass ? " " + extraClass : "");
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

    function pedirFicha(id) {
        if (!id || id === miId) return;
        socket.emit("pedirFicha", { id: id }, function (res) {
            if (!res || !res.ok) return;
            cacheFichas[id] = {
                placa: res.placa || "",
                seguro: res.seguro || "",
                contacto: res.contacto || ""
            };
            const a = autos[id];
            if (a) refrescarFicha(id, a);
            if (contactoActivo === id && a && $("contactoSeleccionado")) {
                $("contactoSeleccionado").textContent =
                    (a.nombre || "Sin nombre") + " · " + (a.vehiculo || "Vehículo") +
                    (res.placa ? " · " + res.placa : "");
            }
        });
    }

    function marcarSosMarker(id, on) {
        const marker = markers[id];
        const el = marker && marker.getElement();
        if (el) el.classList.toggle("sos", !!on);
        if (marker) marker.setZIndexOffset(id === miId ? 1000 : (on ? 800 : 0));
    }

    function marcarAusente(id, on) {
        const marker = markers[id];
        const el = marker && marker.getElement();
        if (el) el.classList.toggle("ausente", !!on);
    }

    function pintarEstadoGrupo() {
        const estado = $("estadoGrupo");
        const salir = $("btnGrupoSalir");
        const share = $("btnGrupoShare");
        const unir = $("btnGrupoUnir");
        const crear = $("btnGrupoCrear");
        const txt = $("txtGrupo");
        if (!estado) return;
        if (miGrupo) {
            estado.textContent = "En el grupo " + miGrupo + ". El walkie va al convoy, no a extraños.";
            if (txt && !txt.value) txt.value = miGrupo;
            if (salir) salir.classList.remove("oculto");
            if (share) share.classList.remove("oculto");
            if (unir) unir.classList.add("oculto");
            if (crear) crear.classList.add("oculto");
        } else {
            estado.textContent = "Sin grupo: la RADIO llega solo a tu alcance en km.";
            if (salir) salir.classList.add("oculto");
            if (share) share.classList.add("oculto");
            if (unir) unir.classList.remove("oculto");
            if (crear) crear.classList.remove("oculto");
        }
    }

    function aplicarGrupo(codigo) {
        miGrupo = normalizarGrupo(codigo);
        if (miGrupo) localStorage.setItem("radiomap_grupo", miGrupo);
        else localStorage.removeItem("radiomap_grupo");
        const txt = $("txtGrupo");
        if (txt) txt.value = miGrupo;
        pintarEstadoGrupo();
        actualizarDestinoUI();
        emitirTelemetria(true);
        const propia = markers[miId] && (autos[miId] || Object.assign(datosPropios(), miPosicion || {}, { id: miId }));
        if (propia && markers[miId]) refrescarFicha(miId, propia);
    }

    function unirseAGrupo() {
        const codigo = normalizarGrupo($("txtGrupo") && $("txtGrupo").value);
        if (codigo.length < 4) {
            alert("El código tiene que tener entre 4 y 8 letras o números.");
            return;
        }
        socket.emit("grupoUnirse", { codigo: codigo }, function (res) {
            if (!res || !res.ok) {
                aplicarGrupo(codigo);
                return;
            }
            aplicarGrupo(res.codigo);
        });
    }

    function crearGrupo() {
        socket.emit("grupoCrear", {}, function (res) {
            if (!res || !res.ok || !res.codigo) {
                alert("No se pudo crear el grupo. Probá de nuevo.");
                return;
            }
            aplicarGrupo(res.codigo);
        });
    }

    function salirDeGrupo() {
        socket.emit("grupoSalir");
        aplicarGrupo("");
    }

    function compartirGrupo() {
        if (!miGrupo) return;
        const url = location.origin + location.pathname + "?g=" + encodeURIComponent(miGrupo);
        const texto = "Entrá al grupo " + miGrupo + " en RadioMap: " + url;
        if (navigator.share) {
            navigator.share({ title: "RadioMap", text: texto, url: url }).catch(function () {});
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(function () {
                alert("Copiamos el enlace del grupo.");
            }).catch(function () {
                prompt("Copiá el enlace del grupo:", url);
            });
            return;
        }
        prompt("Copiá el enlace del grupo:", url);
    }

    function pintarBotonSos() {
        const btn = $("btnSosMapa");
        if (!btn) return;
        btn.classList.toggle("activo", asistenciaActiva);
        const span = btn.querySelector("span");
        if (span) span.textContent = asistenciaActiva ? "Cancelar ayuda" : "Necesito ayuda";
    }

    function sonidoSos() {
        const ctx = ctxPtt();
        if (!ctx) return;
        const t = ctx.currentTime + 0.01;
        tonoPtt(ctx, 880, t, 0.16, "square", 0.1);
        tonoPtt(ctx, 660, t + 0.18, 0.16, "square", 0.09);
        tonoPtt(ctx, 880, t + 0.36, 0.22, "square", 0.1);
    }

    function aplicarAsistenciaLocal(data) {
        if (!data || !data.id) return;
        const activo = !!data.activo;
        if (data.id === miId) {
            asistenciaActiva = activo;
            pintarBotonSos();
            const propia = Object.assign(datosPropios(), miPosicion || {}, {
                id: miId,
                asistencia: activo ? { activo: true, ts: data.ts } : null
            });
            if (markers[miId]) {
                marcarSosMarker(miId, activo);
                refrescarFicha(miId, propia);
            }
            return;
        }
        if (!autos[data.id]) return;
        autos[data.id].asistencia = activo ? { activo: true, ts: data.ts } : null;
        marcarSosMarker(data.id, activo);
        refrescarFicha(data.id, autos[data.id]);
        renderizarContactos();
        if (activo) {
            sonidoSos();
            textoAVoz((data.nombre || "Alguien") + " necesita ayuda");
            if (markers[data.id] && data.lat && data.lng) {
                abrirFicha(data.id);
            }
        }
    }

    function alternarAsistencia() {
        if (!socket.connected) return;
        const proximo = !asistenciaActiva;
        socket.emit("asistencia", { activo: proximo }, function (res) {
            if (res && res.ok) {
                asistenciaActiva = !!res.activo;
                pintarBotonSos();
                aplicarAsistenciaLocal({
                    id: miId,
                    activo: asistenciaActiva,
                    ts: Date.now()
                });
            }
        });
    }

    function pedirWakeLock() {
        if (!("wakeLock" in navigator)) return;
        navigator.wakeLock.request("screen").then(function (lock) {
            wakeLock = lock;
            lock.addEventListener("release", function () {
                if (wakeLock === lock) wakeLock = null;
            });
        }).catch(function () {});
    }

    function aplicarModoManejo() {
        document.body.classList.toggle("modo-manejo", modoManejo);
        const btn = $("btnManejo");
        if (btn) btn.classList.toggle("on", modoManejo);
        if (modoManejo) pedirWakeLock();
        if (map) setTimeout(function () { map.invalidateSize(); }, 80);
    }

    function alternarModoManejo() {
        modoManejo = !modoManejo;
        localStorage.setItem("radiomap_manejo", modoManejo ? "1" : "0");
        aplicarModoManejo();
    }

    function lerpAngulo(desde, hasta, t) {
        if (!Number.isFinite(desde)) return hasta;
        if (!Number.isFinite(hasta)) return desde;
        let d = hasta - desde;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        return (desde + d * t + 360) % 360;
    }

    function setMapaBearing(deg) {
        if (!map || typeof map.setBearing !== "function") return;
        map.setBearing(((deg % 360) + 360) % 360);
    }

    function refrescarRumbosMarcadores() {
        Object.keys(markers).forEach(function (id) {
            const h = (autos[id] && Number.isFinite(Number(autos[id].rumbo)))
                ? autos[id].rumbo
                : (id === miId && miPosicion ? miPosicion.rumbo : null);
            aplicarRumbo(id, h);
        });
    }

    function tickNavGps() {
        if (!modoNavGps) {
            navGpsRaf = null;
            return;
        }
        const m = markers[miId];
        const pos = m
            ? m.getLatLng()
            : (miPosicion ? L.latLng(miPosicion.lat, miPosicion.lng) : null);
        if (pos && !map._animatingZoom && !(map.touchGestures && map.touchGestures._zooming)) {
            setVistaSeguir(pos);
        }
        const destino = Number.isFinite(miPosicion && miPosicion.rumbo)
            ? miPosicion.rumbo
            : rumboNavSuave;
        if (Number.isFinite(destino)) {
            rumboNavSuave = lerpAngulo(rumboNavSuave, destino, 0.16);
            setMapaBearing(rumboNavSuave);
            refrescarRumbosMarcadores();
        }
        navGpsRaf = requestAnimationFrame(tickNavGps);
    }

    function aplicarModoNavGps() {
        document.body.classList.toggle("modo-nav-gps", modoNavGps);
        const btn = $("btnNavGps");
        if (btn) {
            btn.classList.toggle("on", modoNavGps);
            btn.setAttribute("aria-pressed", modoNavGps ? "true" : "false");
        }
        if (modoNavGps) {
            seguirMe = true;
            vistaRadio = false;
            pedirWakeLock();
            if (map.dragging) map.dragging.disable();
            if (miPosicion) {
                navGpsZoomPendiente = false;
                if (Number.isFinite(miPosicion.rumbo)) rumboNavSuave = miPosicion.rumbo;
                setVistaSeguir([miPosicion.lat, miPosicion.lng], Math.max(map.getZoom(), 17));
                setMapaBearing(rumboNavSuave);
            } else {
                navGpsZoomPendiente = true;
                iniciarGps();
            }
            if (markers[miId] && markers[miId].closeTooltip) markers[miId].closeTooltip();
            aplicarVisibilidadPopups();
            if (!navGpsRaf) navGpsRaf = requestAnimationFrame(tickNavGps);
        } else {
            navGpsZoomPendiente = false;
            if (map.dragging) map.dragging.enable();
            rumboNavSuave = 0;
            setMapaBearing(0);
            if (navGpsRaf) {
                cancelAnimationFrame(navGpsRaf);
                navGpsRaf = null;
            }
            refrescarRumbosMarcadores();
            aplicarVisibilidadPopups();
        }
        if (map) setTimeout(function () { map.invalidateSize(); }, 80);
    }

    function alternarModoNavGps() {
        modoNavGps = !modoNavGps;
        aplicarModoNavGps();
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
        mostrarAckWalkie(ok);
    }

    function mostrarAckWalkie(ok) {
        const el = $("ackWalkie");
        const dest = $("destinoHabla");
        if (dest) {
            dest.classList.remove("transmitiendo", "ack-ok", "ack-fail");
            dest.classList.add(ok ? "ack-ok" : "ack-fail");
            setTimeout(function () {
                dest.classList.remove("ack-ok", "ack-fail");
            }, 1800);
        }
        if (!el) return;
        el.textContent = ok ? "Enviado" : "No salió";
        el.className = "ack-walkie " + (ok ? "ok" : "fail");
        el.classList.remove("oculto");
        if (ackWalkieTimer) clearTimeout(ackWalkieTimer);
        ackWalkieTimer = setTimeout(function () {
            el.classList.add("oculto");
        }, 2200);
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
        if ($("destinoHabla")) $("destinoHabla").classList.add("transmitiendo");
        if (canal === "privado") {
            const dest = autos[contactoActivo];
            const nom = (dest && dest.nombre) || "esa persona";
            setAvisoAudio("Mantené para hablar a " + nom + " — soltá para enviar");
            if ($("destinoKicker")) $("destinoKicker").textContent = "Transmitiendo en directo a";
            if ($("destinoNombre")) $("destinoNombre").textContent = nom;
        } else {
            const canalTxt = etiquetaCanal();
            setAvisoAudio("Mantené para hablar a " + canalTxt + " — soltá para enviar");
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
                if ($("destinoHabla")) $("destinoHabla").classList.remove("transmitiendo");
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
        document.querySelectorAll(".btn-ptt, .btn-ptt-mapa, .btn-walkie, .btn-walkie-redondo, .radio-cerca-mic").forEach(function (b) {
            b.classList.remove("grabando");
            if (b.parentElement) b.parentElement.classList.remove("grabando");
        });
        if ($("destinoHabla")) $("destinoHabla").classList.remove("transmitiendo");
        setAvisoAudio("");
        actualizarDestinoUI();
        if (pttRecorder && pttRecorder.state === "recording") pttRecorder.stop();
        else if (!pttChunks.length) avisarEnvioPtt(false);
    }

    function apagarMicrofono() {
        if (pttTimer) {
            clearTimeout(pttTimer);
            pttTimer = null;
        }
        pttActivo = false;
        pttChunks = [];
        detenerTranscripcionPtt();
        if (pttRecorder) {
            try { pttRecorder.onstop = null; } catch (e) {}
            try {
                if (pttRecorder.state === "recording") pttRecorder.stop();
            } catch (e) {}
            pttRecorder = null;
        }
        if (pttStream) {
            pttStream.getTracks().forEach(function (t) {
                try { t.stop(); } catch (e) {}
            });
            pttStream = null;
        }
        document.querySelectorAll(".btn-ptt, .btn-ptt-mapa, .btn-walkie, .btn-walkie-redondo, .radio-cerca-mic").forEach(function (b) {
            b.classList.remove("grabando");
            if (b.parentElement) b.parentElement.classList.remove("grabando");
        });
        if ($("destinoHabla")) $("destinoHabla").classList.remove("transmitiendo");
        setAvisoAudio("");
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
        if (miGrupo) {
            socket.emit("grupoUnirse", { codigo: miGrupo });
        }
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

    socket.on("encuentrosLista", function (lista) {
        sincronizarEncuentros(lista);
    });

    socket.on("encuentroNuevo", function (p) {
        aplicarEncuentro(p, false);
        guardarEncuentros();
    });

    socket.on("encuentroQuitar", function (data) {
        const id = data && (data.id || data);
        if (id) quitarEncuentro(id, true);
    });

    socket.on("mensajeV2V", function (msg) {
        const payload = typeof msg === "string"
            ? { nombre: "V2V", texto: msg }
            : msg;
        agregarMensaje(
            $("msgsV2V"),
            payload.nombre || "Anónimo",
            payload.texto || "",
            payload.de === miId,
            payload.ts,
            payload.asistencia ? "msg-sos" : ""
        );
        if (payload.asistencia && payload.de !== miId) abrirComms();
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

    socket.on("grupoEstado", function (data) {
        const codigo = normalizarGrupo(data && data.codigo);
        if (codigo === miGrupo) {
            pintarEstadoGrupo();
            return;
        }
        miGrupo = codigo;
        if (miGrupo) localStorage.setItem("radiomap_grupo", miGrupo);
        else localStorage.removeItem("radiomap_grupo");
        const txt = $("txtGrupo");
        if (txt) txt.value = miGrupo;
        pintarEstadoGrupo();
        actualizarDestinoUI();
    });

    socket.on("asistencia", aplicarAsistenciaLocal);

    socket.on("fichaDetalle", function (res) {
        if (!res || !res.ok || !res.id) return;
        cacheFichas[res.id] = {
            placa: res.placa || "",
            seguro: res.seguro || "",
            contacto: res.contacto || ""
        };
        if (autos[res.id]) refrescarFicha(res.id, autos[res.id]);
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
        pedirWakeLock();
        asegurarTrampaAtras();
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
        asegurarTrampaAtras();
        $("btnSalirNo").addEventListener("click", ocultarModalSalir);
        $("btnSalirSi").addEventListener("click", salirDeLaApp);
        $("fondoModalSalir").addEventListener("click", ocultarModalSalir);
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
            if (e.key !== "Escape") return;
            if (cartelLlegasteVisible()) {
                ocultarCartelLlegaste();
                return;
            }
            if (modalEncuentroVisible()) {
                cerrarModalEncuentro();
                return;
            }
            if (modalBuscarVisible()) {
                cerrarModalBuscar();
                return;
            }
            if (modalMapaClickVisible()) {
                cerrarModalMapaClick();
                return;
            }
            cerrarModalIcono();
        });
        $("btnCentrar").addEventListener("click", function () {
            vistaRadio = false;
            seguirMe = true;
            if (miPosicion) setVistaSeguir([miPosicion.lat, miPosicion.lng], modoNavGps ? map.getZoom() : 16);
            else iniciarGps();
        });
        $("btnToggleComms").addEventListener("click", toggleComms);
        $("btnCerrarComms").addEventListener("click", function () {
            cerrarComms();
        });
        if ($("btnDockMapa")) {
            $("btnDockMapa").addEventListener("click", function () {
                cerrarComms();
            });
        }
        $("btnActivarGps").addEventListener("click", iniciarGps);
        $("radioFiltro").addEventListener("change", function () {
            localStorage.setItem("radiomap_radio", String(radioKmActual()));
            renderizarContactos();
            actualizarCirculoRadio(true);
            emitirTelemetria(true);
        });
        if ($("btnGrupoUnir")) $("btnGrupoUnir").addEventListener("click", unirseAGrupo);
        if ($("btnGrupoCrear")) $("btnGrupoCrear").addEventListener("click", crearGrupo);
        if ($("btnGrupoSalir")) $("btnGrupoSalir").addEventListener("click", salirDeGrupo);
        if ($("btnGrupoShare")) $("btnGrupoShare").addEventListener("click", compartirGrupo);
        if ($("txtGrupo")) {
            $("txtGrupo").addEventListener("keydown", function (e) {
                if (e.key === "Enter") unirseAGrupo();
            });
        }
        if ($("btnSosMapa")) $("btnSosMapa").addEventListener("click", alternarAsistencia);
        if ($("btnManejo")) $("btnManejo").addEventListener("click", alternarModoManejo);
        if ($("btnNavGps")) $("btnNavGps").addEventListener("click", alternarModoNavGps);
        if ($("btnBuscar")) $("btnBuscar").addEventListener("click", abrirModalBuscar);
        if ($("btnCerrarBuscar")) $("btnCerrarBuscar").addEventListener("click", cerrarModalBuscar);
        if ($("fondoModalBuscar")) $("fondoModalBuscar").addEventListener("click", cerrarModalBuscar);
        if ($("txtBuscarLugar")) {
            $("txtBuscarLugar").addEventListener("input", onInputBuscar);
            $("txtBuscarLugar").addEventListener("keydown", function (e) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    buscarLugar($("txtBuscarLugar").value);
                }
            });
        }
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
        restaurarRadioGuardado();
        const gUrl = codigoDesdeUrl();
        if (gUrl) {
            miGrupo = gUrl;
            localStorage.setItem("radiomap_grupo", miGrupo);
            if ($("txtGrupo")) $("txtGrupo").value = miGrupo;
        } else if (miGrupo && $("txtGrupo")) {
            $("txtGrupo").value = miGrupo;
        }
        pintarEstadoGrupo();
        pintarBotonSos();
        aplicarModoManejo();
        actualizarDestinoUI();
        restaurarEncuentros();
        restaurarRutaGuardada();
        pintarAvisoOffline();
        if ($("btnIrHastaAhi")) $("btnIrHastaAhi").addEventListener("click", irHastaClick);
        if ($("btnPuntoEncuentro")) $("btnPuntoEncuentro").addEventListener("click", abrirModalEncuentro);
        if ($("btnCancelarMapaClick")) $("btnCancelarMapaClick").addEventListener("click", function () {
            cerrarModalMapaClick();
        });
        if ($("fondoModalMapaClick")) $("fondoModalMapaClick").addEventListener("click", function () {
            cerrarModalMapaClick();
        });
        if ($("btnGuardarEncuentro")) $("btnGuardarEncuentro").addEventListener("click", guardarEncuentroDesdeForm);
        if ($("btnCancelarEncuentro")) $("btnCancelarEncuentro").addEventListener("click", function () {
            cerrarModalEncuentro();
        });
        if ($("fondoModalEncuentro")) $("fondoModalEncuentro").addEventListener("click", function () {
            cerrarModalEncuentro();
        });
        if ($("formEncuentro")) {
            $("formEncuentro").addEventListener("submit", function (e) {
                e.preventDefault();
                guardarEncuentroDesdeForm();
            });
        }
        if ($("btnCancelarRuta")) $("btnCancelarRuta").addEventListener("click", cancelarNavegacion);
        if ($("cartelLlegaste")) $("cartelLlegaste").addEventListener("click", ocultarCartelLlegaste);
        if (yaEntroMapa()) pedirWakeLock();
        if (miGrupo) {
            emitirTelemetria(true);
            if (socket.connected) socket.emit("grupoUnirse", { codigo: miGrupo });
        }
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

    function commsEsOverlay() {
        return window.matchMedia("(max-width: 1023px)").matches;
    }

    function commsAbierto() {
        return $("commsPanel").classList.contains("open");
    }

    function toggleComms() {
        if (commsAbierto()) cerrarComms();
        else abrirComms();
    }

    function abrirComms() {
        $("commsPanel").classList.add("open");
        pintarDock();
        asegurarTrampaAtras();
    }

    function cerrarComms() {
        $("commsPanel").classList.remove("open");
        pintarDock();
    }

    function pintarDock() {
        const radio = $("btnToggleComms");
        const mapa = $("btnDockMapa");
        const abierto = commsAbierto();
        if (radio) radio.classList.toggle("on", abierto);
        if (mapa) mapa.classList.toggle("on", !abierto);
    }

    function modalSalirVisible() {
        const el = $("modalSalir");
        return !!(el && !el.classList.contains("oculto"));
    }

    function mostrarModalSalir() {
        $("modalSalir").classList.remove("oculto");
    }

    function ocultarModalSalir() {
        $("modalSalir").classList.add("oculto");
    }

    function asegurarTrampaAtras() {
        if (!history.state || history.state.radiomap !== "app") {
            history.pushState({ radiomap: "app" }, "", location.href);
        }
    }

    function consumirAtrasEnLaApp() {
        if (modalSalirVisible()) {
            ocultarModalSalir();
            return true;
        }
        if (cartelLlegasteVisible()) {
            ocultarCartelLlegaste();
            return true;
        }
        if (modalEncuentroVisible()) {
            cerrarModalEncuentro();
            return true;
        }
        if (modalBuscarVisible()) {
            cerrarModalBuscar();
            return true;
        }
        if (modalMapaClickVisible()) {
            cerrarModalMapaClick();
            return true;
        }
        const icono = $("modalIcono");
        if (icono && !icono.classList.contains("oculto")) {
            cerrarModalIcono();
            return true;
        }
        if (portadaVisible() && yaEntroMapa()) {
            $("portada").classList.add("oculto");
            return true;
        }
        if (commsEsOverlay() && commsAbierto()) {
            cerrarComms();
            return true;
        }
        return false;
    }

    function onPopAtras() {
        if (permitirSalir) return;
        if (!consumirAtrasEnLaApp()) mostrarModalSalir();
        history.pushState({ radiomap: "app" }, "", location.href);
    }

    function salirDeLaApp() {
        apagarMicrofono();
        permitirSalir = true;
        ocultarModalSalir();
        window.removeEventListener("popstate", onPopAtras);
        window.removeEventListener("beforeunload", onAntesDeSalir);
        history.go(-2);
    }

    function onAntesDeSalir(e) {
        if (permitirSalir) return;
        e.preventDefault();
        e.returnValue = "";
    }

    window.addEventListener("popstate", onPopAtras);
    window.addEventListener("beforeunload", onAntesDeSalir);

    window.addEventListener("resize", function () {
        map.invalidateSize();
    });

    window.addEventListener("online", pintarAvisoOffline);
    window.addEventListener("offline", pintarAvisoOffline);

    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") pedirWakeLock();
    });

    setInterval(function () {
        let hay = false;
        Object.keys(autos).forEach(function (id) {
            if (autos[id] && autos[id].ausente) hay = true;
        });
        if (!hay) return;
        Object.keys(autos).forEach(function (id) {
            if (autos[id] && autos[id].ausente) refrescarFicha(id, autos[id]);
        });
        renderizarContactos();
    }, 8000);

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/service-worker.js").catch(function () {});
    }
})();
