// ===================================================
// V2V - SISTEMA PRINCIPAL FRONTEND
// Archivo: main.js
// ===================================================

(function () {
    "use strict";

    const CAMPOS = ["nombre", "vehiculo", "placa", "seguro", "contacto"];
    const GEO_OPTS = { enableHighAccuracy: true, maximumAge: 700, timeout: 8000 };
    const GEO_PRIMERA = { enableHighAccuracy: false, maximumAge: 15000, timeout: 6000 };
    const GPS_LENTO_KMH = 8;
    const GPS_SALTO_ABSURDO_M = 90;
    const MAX_AUTOS_MAPA = 56;
    const ENC_KM = 200;
    const RUTA_MIN_M = 40;
    const MIC_OPTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
    const ICONO_KEY = "v2v_icono";
    const ICONO_CACHE = "20260827e";
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

    function esInvitadoFantasma() {
        try {
            return !!(new URLSearchParams(window.location.search).get("fantasma") || "").trim();
        } catch (e) {
            return !!(window.RadioMapFantasma && RadioMapFantasma.esInvitado());
        }
    }

    let miId = obtenerId();
    const idsPropios = {};
    idsPropios[miId] = true;
    const socket = io({
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 4000,
        timeout: 20000,
        auth: { id: miId }
    });

    const map = L.map("map", {
        zoomControl: false,
        closePopupOnClick: false,
        preferCanvas: false,
        fadeAnimation: false,
        markerZoomAnimation: false,
        rotate: true,
        bearing: 0,
        rotateControl: false,
        touchRotate: false,
        shiftKeyRotate: false,
        compassBearing: false
    }).setView([-34.6037, -58.3816], 13);
    let mapaOcupado = false;
    map.on("movestart zoomstart", function () {
        mapaOcupado = true;
        ocultarTipCalle();
    });
    map.on("moveend zoomend", function () {
        mapaOcupado = false;
        // En nav GPS el tick mueve el mapa cada frame: no re-pintar todos los markers
        // (eso pelea con el bearing y genera tirones / “fuerza que empuja de vuelta”).
        if (modoNavGps) return;
        Object.keys(autos).forEach(function (id) {
            if (autos[id]) actualizarMarker(autos[id]);
        });
    });
    const capaTiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>",
        subdomains: "abc",
        maxZoom: 19,
        keepBuffer: 2,
        updateWhenIdle: true,
        updateWhenZooming: false,
        crossOrigin: true
    }).addTo(map);

    const FICHA_POPUP = {
        closeButton: false,
        autoClose: false,
        closeOnClick: false,
        autoPan: false,
        className: "ficha-popup",
        maxWidth: 280,
        minWidth: 228,
        offset: [0, -4]
    };

    const NOMBRE_TIP = {
        permanent: true,
        direction: "bottom",
        offset: [0, 8],
        opacity: 1,
        interactive: true,
        className: "nombre-conductor"
    };

    const markers = {};
    const movimientos = {};
    const historialPrivado = {};
    const cacheSnap = {};
    const cacheRuta = {};
    let autos = {};
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
    let popupsVisibles = false;
    let fichasForzadas = {};
    let radioCercaAbierta = false;
    const RADIO_CERCA_MAX = 9;
    const FANTASMA_ID = "autotest-fantasma";
    const FANTASMA_RADIO_M = 200;
    let fantasmaActivo = false;
    let fantasmaAngulo = 0;
    let fantasmaTimer = null;
    let introPaso = 0;
    let introGpsResuelto = false;
    let permitirSalir = false;
    let iconoCfg = { src: "static/iconos/autos.png", cols: 15, rows: 8, celdaCm: 2, celdaPx: 128 };
    let iconoMosaicoListo = false;
    let mosaicoImg = null;
    const recortesCelda = {};
    let radioTimer = null;
    let miGrupo = localStorage.getItem("radiomap_grupo") || "";
    let miGrupoNombre = localStorage.getItem("radiomap_grupo_nombre") || "";
    let enRuta = localStorage.getItem("radiomap_en_ruta") !== "0";
    const bloqueados = (function () {
        try {
            const raw = JSON.parse(localStorage.getItem("radiomap_bloqueados") || "[]");
            return Array.isArray(raw) ? raw.filter(Boolean) : [];
        } catch (e) {
            return [];
        }
    })();
    let modoManejo = localStorage.getItem("radiomap_manejo") === "1";
    let modoNavGps = false;
    let modoTransito = localStorage.getItem("radiomap_transito") === "pie" ? "pie" : "auto";
    let rumboNavSuave = 0;
    let rumboVisual = null;
    let posGpsObjetivo = null;
    let gpsTickRaf = null;
    let gpsCrudoNav = null;
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
    const VIAJE_FLAG = "radiomap_viaje_activo";
    const VIAJE_DEST_KEY = "radiomap_viaje_dest";
    const SESION_KEY = "radiomap_sesion";
    const RUTA_DECISION_KEY = "radiomap_ruta_decision";
    const AVISOS_FLAG = "radiomap_avisos_n";
    const COLA_AVISOS_MAX = 8;
    const CLIPS_AUDIO_MAX = 4;
    let ackWalkieTimer = null;
    let busquedaTimer = null;
    const colaAvisos = [];
    const clipsAudio = {};
    let avisosModalListo = false;
    let reproduciendoCola = false;

    function debeMostrarFicha(id) {
        if (modoNavGps && id === miId) return false;
        if (fichasForzadas[id] === "cerrada") return false;
        if (fichasForzadas[id] === "abierta") return true;
        if (id === miId) return false;
        return popupsVisibles;
    }

    function debeMostrarNombre(id) {
        if (modoNavGps && id === miId) return false;
        if (debeMostrarFicha(id)) return false;
        const marker = markers[id];
        if (marker && marker.isPopupOpen && marker.isPopupOpen()) return false;
        return true;
    }

    function abrirFicha(id) {
        fichasForzadas[id] = "abierta";
        const marker = markers[id];
        if (!marker) return;
        if (marker.closeTooltip) marker.closeTooltip();
        if (marker.openPopup) marker.openPopup();
        silenciarHoverFicha(marker, id);
        requestAnimationFrame(function () { engancharFicha(marker, id); });
        if (id !== miId) pedirFicha(id);
    }

    function cerrarFicha(id) {
        fichasForzadas[id] = "cerrada";
        const marker = markers[id];
        if (!marker) return;
        if (marker.closePopup) marker.closePopup();
        if (debeMostrarNombre(id) && marker.openTooltip) marker.openTooltip();
    }

    function silenciarClickPopupLeaflet(marker) {
        if (!marker || !marker._openPopup) return;
        marker.off("click", marker._openPopup);
    }

    function engancharPopupCapa(marker, id) {
        if (!marker || marker._popCapa) return;
        marker._popCapa = true;
        marker.on("popupopen", function () {
            if (marker.closeTooltip) marker.closeTooltip();
            requestAnimationFrame(function () { engancharFicha(marker, id); });
        });
        marker.on("popupclose", function () {
            if (fichasForzadas[id] === "abierta") fichasForzadas[id] = "cerrada";
            if (debeMostrarNombre(id) && marker.openTooltip) marker.openTooltip();
        });
    }

    function engancharClickMarker(marker, id) {
        if (!marker || marker._clickFicha) return;
        marker._clickFicha = true;
        marker.on("click", function (ev) {
            L.DomEvent.stopPropagation(ev);
            if (marker.isPopupOpen && marker.isPopupOpen()) {
                cerrarFicha(id);
                return;
            }
            abrirFicha(id);
        });
        const tip = marker.getTooltip && marker.getTooltip();
        if (tip && !tip._clickNombre) {
            tip._clickNombre = true;
            tip.on("click", function (ev) {
                L.DomEvent.stopPropagation(ev);
                if (marker.isPopupOpen && marker.isPopupOpen()) cerrarFicha(id);
                else abrirFicha(id);
            });
        }
    }

    function silenciarHoverFicha(marker, id) {
        if (!marker || id !== miId) return;
        marker.off("mouseover");
        marker.off("mouseout");
        marker.off("mousemove");
    }

    function nombreConductor(a) {
        if (!a) return "Sin nombre";
        return soyYoId(a.id) ? "YO" : (a.nombre || "Sin nombre");
    }

    function nombreHtml(a) {
        return esc(nombreConductor(a));
    }

    function nombreOpts(soyYo, a) {
        const sos = !!(a && a.asistencia && a.asistencia.activo);
        return Object.assign({}, NOMBRE_TIP, {
            className: "nombre-conductor" + (soyYo ? " nombre-propio" : "") + (sos ? " nombre-sos" : "")
        });
    }

    function fichaPopupOpts(soyYo, a) {
        const sos = !!(a && a.asistencia && a.asistencia.activo);
        return Object.assign({}, FICHA_POPUP, {
            className: "ficha-popup" + (soyYo ? " ficha-propia" : " ficha-radio") + (sos ? " ficha-sos" : "")
        });
    }

    function crearIcono(soyYo, xy) {
        xy = clampIcono(xy && xy.x, xy && xy.y);
        const rec = recorteCelda(xy.x, xy.y);
        const size = tamanioMarker(rec.w, rec.h);
        const ax = Math.round(size[0] / 2);
        const ay = Math.round(size[1] / 2);
        return L.divIcon({
            className: "marker-auto" + (soyYo ? " marker-propio" : " marker-otro"),
            html: '<div class="auto-rot"><img class="auto-cuerpo" alt="" width="' + size[0] + '" height="' + size[1] + '" src="' + rec.url + '"></div>',
            iconSize: size,
            iconAnchor: [ax, ay],
            popupAnchor: [0, -ay],
            tooltipAnchor: [0, ay]
        });
    }

    iniciarPerfil();
    iniciarMosaico();
    bindUi();
    if (yaEntroMapa() && !esInvitadoFantasma()) iniciarGps();
    setTimeout(function () { map.invalidateSize(); }, 250);

    map.on("dragstart", function () {
        if (modoNavGps) {
            seguirMe = true;
            return;
        }
        seguirMe = false;
    });

    map.on("click", onClickMapa);
    map.on("mousemove", onMoveCalle);
    map.on("mouseout", function () { ocultarTipCalle(); });
    engancharHoldCalle();

    // ===================================================
    // Identidad persistente (sobrevive reconexiones)
    // ===================================================
    function obtenerId() {
        let id = "";
        try { id = localStorage.getItem("v2v_id") || ""; } catch (e) { id = ""; }
        if (!/^v[a-z0-9]+$/i.test(id)) {
            id = "v" + Math.random().toString(36).slice(2) + Date.now().toString(36);
            try { localStorage.setItem("v2v_id", id); } catch (e) {}
        }
        return id;
    }

    function soyYoId(id) {
        return !!id && (id === miId || !!idsPropios[id]);
    }

    function adoptarId(id) {
        id = String(id || "");
        if (!id || id === miId) return;
        idsPropios[miId] = true;
        idsPropios[id] = true;
        const anterior = miId;
        miId = id;
        try { localStorage.setItem("v2v_id", id); } catch (e) {}
        try { socket.auth = { id: id }; } catch (e) {}
        if (autos[anterior]) delete autos[anterior];
        if (autos[id]) delete autos[id];
        if (markers[anterior]) {
            markers[id] = markers[anterior];
            delete markers[anterior];
        }
        emitirTelemetria(true);
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
    }

    function datosPropios() {
        const data = { id: miId };
        CAMPOS.forEach(function (c) {
            const el = $(c);
            const desdeInput = el && el.value ? String(el.value).trim() : "";
            let guardado = "";
            try { guardado = (localStorage.getItem(c) || "").trim(); } catch (e) { guardado = ""; }
            data[c] = desdeInput || guardado;
        });
        const xy = leerIconoLocal();
        data.iconoX = xy.x;
        data.iconoY = xy.y;
        data.radioKm = radioKmActual();
        data.grupo = miGrupo || "";
        data.enRuta = enRuta;
        return data;
    }

    function esBloqueado(id) {
        return !!id && bloqueados.indexOf(id) >= 0;
    }

    function guardarBloqueados() {
        localStorage.setItem("radiomap_bloqueados", JSON.stringify(bloqueados));
    }

    function alternarBloqueo(id) {
        if (!id || id === miId) return;
        const i = bloqueados.indexOf(id);
        if (i >= 0) bloqueados.splice(i, 1);
        else bloqueados.push(id);
        guardarBloqueados();
        if (esBloqueado(id)) {
            quitarVehiculo(id);
            if (contactoActivo === id) contactoActivo = null;
        }
        renderizarContactos();
    }

    function pintarBotonEnRuta() {
        const btn = $("btnEnRuta");
        if (!btn) return;
        btn.classList.toggle("on", enRuta);
        btn.setAttribute("aria-pressed", enRuta ? "true" : "false");
        btn.textContent = enRuta ? "En ruta" : "Fuera";
    }

    function alternarEnRuta() {
        enRuta = !enRuta;
        localStorage.setItem("radiomap_en_ruta", enRuta ? "1" : "0");
        pintarBotonEnRuta();
        emitirTelemetria(true);
        pintarResumenEnRuta();
    }

    function pintarResumenEnRuta() {
        const el = $("resumenEnRuta");
        if (!el) return;
        if (!miGrupo) {
            el.textContent = "Unite a un grupo para ver quién está en ruta.";
            return;
        }
        const vivos = Object.keys(autos).filter(function (id) {
            return id !== miId && autos[id] && autos[id].enRuta !== false &&
                (autos[id].enGrupo || (autos[id].grupo && autos[id].grupo === miGrupo));
        });
        const n = vivos.length + (enRuta ? 1 : 0);
        el.textContent = n
            ? (n === 1 ? "1 en ruta en el grupo." : n + " en ruta en el grupo.")
            : "Nadie del grupo en ruta todavía.";
    }

    function codigoDesdeUrl() {
        try {
            const q = new URLSearchParams(location.search);
            const nom = String(q.get("n") || q.get("nombre") || "").trim().slice(0, 32);
            if (nom && !miGrupoNombre) guardarNombreGrupoLocal(nom);
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
                if (id === "vivo-fantasma") return;
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
        const xy = leerIconoLocal();
        const rec = recorteCelda(xy.x, xy.y);
        ["iconoPreview", "iconoPreviewCabeza"].forEach(function (id) {
            const el = $(id);
            if (!el || !rec.url) return;
            let img = el.querySelector("img");
            if (!img) {
                img = document.createElement("img");
                img.alt = "";
                el.appendChild(img);
            }
            img.src = rec.url;
        });
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
        if (esInvitadoFantasma()) return;
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
        if (esInvitadoFantasma()) return;
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
            precision: pos.coords.accuracy || null,
            ts: pos.timestamp || Date.now()
        };

        if (navegacion && llegoDestino([cruda.lat, cruda.lng])) {
            finalizarLlegada();
        }

        if (!forzarCentro && !aceptarGps(cruda)) return;

        ultimoGpsCrudo = cruda;
        gpsCrudoNav = [cruda.lat, cruda.lng];

        const p = puntoMostrarGps(cruda);
        aplicarPosicionPropia(p[0], p[1], cruda, forzarCentro);

        const sobreRuta = navegacion && navegacion.path &&
            infoSobreRuta(gpsCrudoNav, navegacion.path).dist < 28;
        if (sobreRuta) return;

        const lat0 = cruda.lat;
        const lng0 = cruda.lng;
        const perfilSnap = (navegacion && modoTransito === "pie") ? "walking" : "driving";
        anclarACalle(lat0, lng0, perfilSnap).then(function (snap) {
            if (!ultimoGpsCrudo) return;
            if (metrosEntre([ultimoGpsCrudo.lat, ultimoGpsCrudo.lng], [lat0, lng0]) > 20) return;
            if (navegacion && navegacion.path &&
                infoSobreRuta([ultimoGpsCrudo.lat, ultimoGpsCrudo.lng], navegacion.path).dist < 28) {
                return;
            }
            const q = elegirPuntoGps(ultimoGpsCrudo, snap);
            aplicarPosicionPropia(q[0], q[1], ultimoGpsCrudo, false);
        });
    }

    function aceptarGps(cruda) {
        if (!ultimoGpsCrudo) return true;
        const prev = ultimoGpsCrudo;
        const m = metrosEntre([prev.lat, prev.lng], [cruda.lat, cruda.lng]);
        const acc = cruda.precision || 25;
        if (acc > 95 && m < 4) return false;
        const dt = Math.max(0.25, ((cruda.ts || Date.now()) - (prev.ts || cruda.ts)) / 1000);
        const vmax = Math.max(cruda.velocidad || 0, prev.velocidad || 0, 12) / 3.6;
        if (m > GPS_SALTO_ABSURDO_M && m > vmax * dt * 5 + Math.max(acc, 30) && dt < 6) {
            return false;
        }
        if (m < 0.4) {
            const h1 = cruda.rumbo;
            const h0 = prev.rumbo;
            if (Number.isFinite(h1) && Number.isFinite(h0) && anguloDiff(h1, h0) >= 6) return true;
            if (Math.abs((cruda.velocidad || 0) - (prev.velocidad || 0)) >= 2) return true;
            return false;
        }
        return true;
    }

    function puntoMostrarGps(cruda) {
        const raw = [cruda.lat, cruda.lng];
        if (navegacion && navegacion.path && navegacion.path.length > 1) {
            const info = infoSobreRuta(raw, navegacion.path);
            if (info.dist < 24 && info.punto) return info.punto;
        }
        return raw;
    }

    function rumboDeViaje(punto) {
        if (window.RadioMapCarrera && RadioMapCarrera.bloqueaGps()) return null;
        if (!navegacion || !navegacion.path || navegacion.path.length < 2) return null;
        const yo = punto || (miPosicion ? [miPosicion.lat, miPosicion.lng] : navegacion.path[0]);
        if (!yo) return null;
        const info = infoSobreRuta(yo, navegacion.path);
        // Look-ahead corto: anticipa suave sin tironear el bearing en cada curva lejana.
        if (modoNavGps && info && Number.isFinite(info.idx)) {
            const look = rumboLookAhead(navegacion.path, info.idx, info.t, 24);
            if (Number.isFinite(look)) return look;
        }
        if (Number.isFinite(info.rumboPath)) return info.rumboPath;
        if (navegacion.dest) return rumboEntre(yo, navegacion.dest);
        return null;
    }

    function rumboHaciaDondeVa(extra, desde, hasta) {
        const viaje = rumboDeViaje(hasta || desde);
        if (Number.isFinite(viaje)) return viaje;
        const vel = (extra && extra.velocidad) || 0;
        const m = metrosEntre(desde, hasta);
        if (extra && Number.isFinite(extra.rumbo) && vel >= 3) return extra.rumbo;
        if (m >= 3.2) return rumboEntre(desde, hasta);
        if (miPosicion && Number.isFinite(miPosicion.rumbo)) return miPosicion.rumbo;
        if (extra && Number.isFinite(extra.rumbo)) return extra.rumbo;
        return extra && extra.rumbo;
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
        const prev = miPosicion ? [miPosicion.lat, miPosicion.lng] : [lat, lng];
        const rumbo = rumboHaciaDondeVa(extra, prev, [lat, lng]);

        miPosicion = {
            lat: lat,
            lng: lng,
            velocidad: extra.velocidad,
            rumbo: rumbo,
            precision: extra.precision
        };
        if (window.RadioMapCarrera && RadioMapCarrera.bloqueaGps()) return;
        posGpsObjetivo = {
            lat: lat,
            lng: lng,
            rumbo: rumbo,
            vel: extra.velocidad || 0
        };
        actualizarResumenPerfil();
        if (window.RadioMapFantasma && RadioMapFantasma.onGps) RadioMapFantasma.onGps();
        if (esInvitadoFantasma()) return;

        const propio = Object.assign(datosPropios(), miPosicion, { id: miId });
        if (!markers[miId]) {
            actualizarMarker(propio);
        } else {
            aplicarIconoEnMarker(miId, iconoDeAuto(propio));
            marcarSosMarker(miId, !!(propio.asistencia && propio.asistencia.activo));
            refrescarFicha(miId, propio);
        }
        asegurarTickGps();

        if (!yaCentramos || forzarCentro) {
            yaCentramos = true;
            map.setView([lat, lng], 16);
            map.invalidateSize();
            actualizarCirculoRadio(false);
        }

        if (modoNavGps) seguirMe = true;
        if (navGpsZoomPendiente && modoNavGps) {
            navGpsZoomPendiente = false;
            setVistaSeguir([lat, lng], Math.max(map.getZoom(), 17));
        }
        if (debeEmitir(lat, lng)) emitirTelemetria(false);
        renderizarContactos();
        actualizarNavegacion();
        refrescarBanderasEncuentro();
    }

    function aKmh(ms) {
        if (ms == null || isNaN(ms) || ms < 0) return 0;
        return Math.round(ms * 3.6);
    }

    function debeEmitir(lat, lng) {
        const ahora = Date.now();
        if (!ultimoEnvio.lat) return true;
        const n = cantidadOtros();
        const espera = n > 28 ? 10000 : 6000;
        const metrosMin = n > 28 ? 40 : 28;
        if (ahora - ultimoEnvio.ts > espera) return true;
        const metros = calcularDistanciaKm(ultimoEnvio.lat, ultimoEnvio.lng, lat, lng) * 1000;
        return metros >= metrosMin;
    }

    function intervaloHeartbeat() {
        if (!enRuta) return cantidadOtros() > 28 ? 35000 : 25000;
        const vel = miPosicion && miPosicion.velocidad ? miPosicion.velocidad : 0;
        const base = vel >= 2 ? 6000 : 15000;
        return cantidadOtros() > 28 ? Math.round(base * 1.7) : base;
    }

    function emitirTelemetria(forzar) {
        if (esInvitadoFantasma()) return;
        if (window.RadioMapCarrera && RadioMapCarrera.bloqueaGps()) return;
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
    let ultimoHeartbeatForzado = 0;
    setInterval(function () {
        const ahora = Date.now();
        if (ahora - ultimoHeartbeatForzado < intervaloHeartbeat() - 200) return;
        ultimoHeartbeatForzado = ahora;
        emitirTelemetria(true);
    }, 2000);

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

    function pintarRumbo(id, deg) {
        if (!Number.isFinite(Number(deg)) && !(modoNavGps && id === miId)) return;
        const marker = markers[id];
        if (!marker) return;
        const el = marker.getElement();
        if (!el) return;
        const rot = el.querySelector(".auto-rot");
        if (!rot) return;
        let vis = Number(deg);
        const enCarrera = window.RadioMapCarrera && RadioMapCarrera.bloqueaGps();
        if (modoNavGps && !enCarrera) {
            // Marker propio: nariz siempre arriba (fijo). Los demás compensan el bearing del mapa.
            vis = id === miId ? 0 : ((vis - rumboNavSuave) + 360) % 360;
        }
        if (Number.isFinite(vis)) {
            rot.style.transform = "rotate(" + vis + "deg)";
            if (id === miId && modoNavGps) rot.style.transition = "none";
        }
    }

    function aplicarRumbo(id, deg) {
        if (id === miId) {
            const viaje = rumboDeViaje();
            if (Number.isFinite(viaje) && !(window.RadioMapCarrera && RadioMapCarrera.bloqueaGps())) {
                deg = viaje;
            }
        }
        if (id === miId && Number.isFinite(Number(deg))) {
            if (miPosicion) miPosicion.rumbo = Number(deg);
            if (posGpsObjetivo) posGpsObjetivo.rumbo = Number(deg);
            if (window.RadioMapCarrera && RadioMapCarrera.bloqueaGps()) {
                rumboVisual = Number(deg);
                pintarRumbo(id, Number(deg));
                return;
            }
            pintarRumbo(id, Number.isFinite(rumboVisual) ? rumboVisual : deg);
            return;
        }
        pintarRumbo(id, deg);
        if (Number.isFinite(Number(deg)) && autos[id]) autos[id].rumbo = Number(deg);
    }

    function asegurarTickGps() {
        if (gpsTickRaf) return;
        gpsTickRaf = requestAnimationFrame(tickGpsFluido);
    }

    function tickGpsFluido() {
        gpsTickRaf = requestAnimationFrame(tickGpsFluido);
        if (window.RadioMapCarrera && RadioMapCarrera.bloqueaGps()) return;
        const marker = markers[miId];
        const dest = posGpsObjetivo;
        if (!marker || !dest) return;
        const from = marker.getLatLng();
        const origen = [from.lat, from.lng];
        const hasta = [dest.lat, dest.lng];
        const dist = metrosEntre(origen, hasta);
        const vel = dest.vel || (miPosicion && miPosicion.velocidad) || 0;
        let k = dist > 40 ? 0.4 : dist > 12 ? 0.28 : dist > 3 ? 0.18 : 0.12;
        if (vel > 50) k = Math.min(0.48, k + 0.08);
        if (dist < 0.12) {
            marker.setLatLng(hasta);
        } else {
            marker.setLatLng([
                origen[0] + (hasta[0] - origen[0]) * k,
                origen[1] + (hasta[1] - origen[1]) * k
            ]);
        }
        if (circuloRadio) circuloRadio.setLatLng(marker.getLatLng());

        const viaje = rumboDeViaje(hasta);
        const rumboDest = Number.isFinite(viaje)
            ? viaje
            : (Number.isFinite(dest.rumbo)
                ? dest.rumbo
                : (miPosicion && miPosicion.rumbo));
        if (Number.isFinite(rumboDest)) {
            const diff = Number.isFinite(rumboVisual) ? anguloDiff(rumboVisual, rumboDest) : 0;
            const t = diff > 50 ? 0.14 : (vel > 8 ? 0.3 : 0.2);
            rumboVisual = Number.isFinite(rumboVisual)
                ? lerpAngulo(rumboVisual, rumboDest, t)
                : rumboDest;
            pintarRumbo(miId, rumboVisual);
        }

        if (seguirMe && !modoNavGps && dist > 0.08 && !map._animatingZoom &&
            !(map.touchGestures && map.touchGestures._zooming)) {
            setVistaSeguir(marker.getLatLng());
        }
    }

    function clavePunto(lat, lng) {
        return Number(lat).toFixed(4) + "," + Number(lng).toFixed(4);
    }

    function anclarACalle(lat, lng, perfil) {
        const modo = perfil || "driving";
        const clave = clavePunto(lat, lng) + ":" + modo;
        if (cacheSnap[clave]) return Promise.resolve(cacheSnap[clave]);
        const lnglat = Number(lng) + "," + Number(lat);
        return fetch("/api/osrm/nearest?lnglat=" + encodeURIComponent(lnglat) + "&perfil=" + encodeURIComponent(modo))
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

    function elegirMejorRuta(j, aPie) {
        if (!j || j.code !== "Ok" || !j.routes || !j.routes[0]) return null;
        let best = j.routes[0];
        for (let i = 1; i < j.routes.length; i++) {
            const r = j.routes[i];
            const t = Number(r.duration) || 0;
            const d = Number(r.distance) || 0;
            const bt = Number(best.duration) || 0;
            const bd = Number(best.distance) || 0;
            if (aPie) {
                if (d + 1 < bd) best = r;
                else if (Math.abs(d - bd) <= 1 && t < bt) best = r;
            } else if (t < bt - 5) {
                best = r;
            } else if (Math.abs(t - bt) <= 5 && d < bd) {
                best = r;
            }
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

    function proyectarEnSegmento(p, a, b) {
        const ax = a[1];
        const ay = a[0];
        const bx = b[1];
        const by = b[0];
        const px = p[1];
        const py = p[0];
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const q = [ay + t * dy, ax + t * dx];
        return { punto: q, t: t, dist: metrosEntre(p, q) };
    }

    function puntoEnPathLookAhead(path, idx, tSeg, metrosAdelante) {
        if (!path || path.length < 2) return null;
        let i = Math.min(Math.max(0, idx), path.length - 2);
        let t = Number.isFinite(tSeg) ? tSeg : 0;
        let leftover = metrosAdelante || 18;
        while (i < path.length - 1 && leftover > 0) {
            const seg = metrosEntre(path[i], path[i + 1]);
            if (seg < 0.05) {
                i += 1;
                t = 0;
                continue;
            }
            const queda = seg * (1 - t);
            if (leftover <= queda) {
                const t2 = t + leftover / seg;
                return [
                    path[i][0] + (path[i + 1][0] - path[i][0]) * t2,
                    path[i][1] + (path[i + 1][1] - path[i][1]) * t2
                ];
            }
            leftover -= queda;
            i += 1;
            t = 0;
        }
        return path[path.length - 1].slice();
    }

    function rumboLookAhead(path, idx, tSeg, metrosAdelante) {
        if (!path || path.length < 2) return null;
        let i = Math.min(Math.max(0, idx), path.length - 2);
        let t = Number.isFinite(tSeg) ? tSeg : 0;
        const a = [
            path[i][0] + (path[i + 1][0] - path[i][0]) * t,
            path[i][1] + (path[i + 1][1] - path[i][1]) * t
        ];
        const b = puntoEnPathLookAhead(path, idx, tSeg, metrosAdelante || 18);
        if (!b) return null;
        if (metrosEntre(a, b) < 0.4) {
            const j = Math.min(path.length - 1, Math.max(1, i + 1));
            return rumboEntre(path[j - 1], path[j]);
        }
        return rumboEntre(a, b);
    }

    function infoSobreRuta(yo, path) {
        const vacio = { dist: Infinity, idx: 0, rumboPath: null, resto: Infinity, punto: yo, t: 0 };
        if (!path || !path.length) return vacio;
        if (path.length === 1) {
            const d = metrosEntre(yo, path[0]);
            return { dist: d, idx: 0, rumboPath: null, resto: d, punto: path[0], t: 0 };
        }
        let best = { dist: Infinity, idx: 0, t: 0, punto: path[0] };
        for (let i = 0; i < path.length - 1; i++) {
            const pr = proyectarEnSegmento(yo, path[i], path[i + 1]);
            if (pr.dist < best.dist) {
                best = { dist: pr.dist, idx: i, t: pr.t, punto: pr.punto };
            }
        }
        const rumboPath = rumboLookAhead(path, best.idx, best.t, 22);
        let resto = 0;
        if (best.idx < path.length - 1) {
            resto += metrosEntre(best.punto, path[best.idx + 1]);
            for (let k = best.idx + 1; k < path.length - 1; k++) {
                resto += metrosEntre(path[k], path[k + 1]);
            }
        }
        return {
            dist: best.dist,
            idx: best.idx,
            rumboPath: rumboPath,
            resto: resto,
            punto: best.punto,
            t: best.t
        };
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

    function metrosPorPixelMapa(lat) {
        const z = map.getZoom();
        const latRad = Number(lat) * Math.PI / 180;
        return 156543.03392 * Math.cos(latRad) / Math.pow(2, z);
    }

    function metrosCamaraAdelante(lat) {
        const hPx = (map.getSize() && map.getSize().y) || 640;
        let frac = 0.22;
        if (navegacion && seguirMe) frac = 0.2;
        const m = hPx * frac * metrosPorPixelMapa(lat);
        return Math.max(56, Math.min(480, m));
    }

    function debeCamaraAdelante() {
        // En modo nav GPS el anclaje es por píxeles de pantalla (no metros geográficos).
        return !!(!modoNavGps && navegacion && seguirMe);
    }

    function rumboCamara() {
        if (Number.isFinite(rumboNavSuave) && rumboNavSuave) return rumboNavSuave;
        if (miPosicion && Number.isFinite(miPosicion.rumbo)) return miPosicion.rumbo;
        return 0;
    }

    function centroCamaraNav(lat, lng) {
        const h = rumboCamara();
        if (!Number.isFinite(h)) return [lat, lng];
        return puntoHacia(lat, lng, h, metrosCamaraAdelante(lat));
    }

    /** Posición fija en pantalla del auto en nav GPS (0 = top, 1 = bottom). */
    function anclaYNavGps() {
        // Un poco más arriba para no taparlo con el HUD de ruta.
        return 0.68;
    }

    function fijarVistaNavGps(latlng, zoom) {
        const lat = latlng.lat != null ? latlng.lat : latlng[0];
        const lng = latlng.lng != null ? latlng.lng : latlng[1];
        const z = zoom != null ? zoom : map.getZoom();
        const yo = L.latLng(lat, lng);

        // 1) Pivot en el auto (el mapa rota alrededor del vehículo).
        map.setView(yo, z, { animate: false });

        // 2) Rumbo geográfico → bearing leaflet-rotate (convención invertida, ver setMapaBearing).
        if (Number.isFinite(rumboNavSuave)) setMapaBearing(rumboNavSuave);

        // 3) Anclar marker abajo (solo traslación; el auto no rota).
        const size = map.getSize();
        if (!size || !size.x || !size.y) return;

        const target = L.point(size.x / 2, size.y * anclaYNavGps());
        const actual = map.latLngToContainerPoint(yo);
        const dx = actual.x - target.x;
        const dy = actual.y - target.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            map.panBy([dx, dy], { animate: false });
        }
    }

    function setVistaSeguir(latlng, zoom) {
        if (modoNavGps) {
            fijarVistaNavGps(latlng, zoom);
            return;
        }
        const lat = latlng.lat != null ? latlng.lat : latlng[0];
        const lng = latlng.lng != null ? latlng.lng : latlng[1];
        const z = zoom != null ? zoom : map.getZoom();
        if (debeCamaraAdelante()) {
            map.setView(centroCamaraNav(lat, lng), z, { animate: false });
        } else {
            map.setView([lat, lng], z, { animate: false });
        }
    }

    function persistirFlagsSesion() {
        try {
            sessionStorage.setItem(SESION_KEY, JSON.stringify({
                id: miId,
                viaje: !!(navegacion && navegacion.path),
                enRuta: !!enRuta,
                navGps: !!modoNavGps,
                ts: Date.now()
            }));
        } catch (e) {}
        if (navegacion && navegacion.dest) {
            try { localStorage.setItem(VIAJE_FLAG, "1"); } catch (e) {}
            try { localStorage.setItem(VIAJE_DEST_KEY, JSON.stringify(navegacion.dest)); } catch (e) {}
        } else {
            try { localStorage.removeItem(VIAJE_FLAG); } catch (e) {}
            try { localStorage.removeItem(VIAJE_DEST_KEY); } catch (e) {}
        }
    }

    function persistirRuta() {
        if (!navegacion || !navegacion.path) {
            try { localStorage.removeItem(NAV_KEY); } catch (e) {}
            persistirFlagsSesion();
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
                modo: modoTransito,
                ts: Date.now()
            }));
        } catch (e) {}
        persistirFlagsSesion();
    }

    function leerRutaGuardada(hasta) {
        try {
            const raw = JSON.parse(localStorage.getItem(NAV_KEY) || "null");
            if (!raw || !raw.path || raw.path.length < 2) return null;
            if (Date.now() - (raw.ts || 0) > 2 * 3600 * 1000) {
                localStorage.removeItem(NAV_KEY);
                try { localStorage.removeItem(VIAJE_FLAG); } catch (e) {}
                try { localStorage.removeItem(VIAJE_DEST_KEY); } catch (e) {}
                return null;
            }
            if (hasta && metrosEntre(raw.dest, hasta) > 40) return null;
            return {
                path: raw.path,
                steps: raw.steps || [],
                distance: raw.distance || 0,
                duration: raw.duration || 0,
                dest: raw.dest,
                sinMarker: !!raw.sinMarker,
                modo: raw.modo === "pie" ? "pie" : "auto"
            };
        } catch (e) {
            return null;
        }
    }

    function rutaCachePorDestino(hasta) {
        const suf = ">" + clavePunto(hasta[0], hasta[1]) + ":n:" + perfilRutaNav();
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
        const step = Math.max(1, Math.floor(path.length / 36));
        const vistos = {};
        for (let i = 0; i < path.length; i += step) {
            const t = latLngATile(path[i][0], path[i][1], z);
            const clave = z + "/" + t.x + "/" + t.y;
            if (vistos[clave]) continue;
            vistos[clave] = true;
            const url = "https://a.tile.openstreetmap.org/" + clave + ".png";
            fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" }).catch(function () {});
        }
    }

    function perfilRutaNav() {
        return modoTransito === "pie" ? "walking" : "driving";
    }

    function rutaPorCalle(desde, hasta, nav) {
        const perfil = nav ? perfilRutaNav() : "driving";
        const clave = clavePunto(desde[0], desde[1]) + ">" + clavePunto(hasta[0], hasta[1]) + (nav ? ":n" : "") + ":" + perfil;
        if (cacheRuta[clave]) return Promise.resolve(cacheRuta[clave]);
        const from = Number(desde[1]) + "," + Number(desde[0]);
        const to = Number(hasta[1]) + "," + Number(hasta[0]);
        const extra = (nav ? "&nav=1" : "") + "&perfil=" + encodeURIComponent(perfil);
        return fetch("/api/osrm/ruta?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to) + extra)
            .then(function (r) {
                if (!r.ok) throw new Error("osrm");
                return r.json();
            })
            .then(function (j) {
                const ruta = elegirMejorRuta(j, perfil === "walking");
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
                const cached = rutaCachePorDestino(hasta);
                if (cached) return cached;
                const guardada = leerRutaGuardada(hasta);
                if (guardada && guardada.modo === modoTransito) return guardada;
                return null;
            });
    }

    let saltearClickCalle = false;

    function ocultarTipCalle() {
        const el = $("tipCalle");
        if (el) el.classList.add("oculto");
    }

    function onMoveCalle() {}

    function engancharHoldCalle() {}

    function clickSobreUiMapa(ev) {
        const t = ev.originalEvent && ev.originalEvent.target;
        if (!t || !t.closest) return false;
        return !!(t.closest(".leaflet-tooltip") || t.closest(".leaflet-popup") ||
            t.closest(".leaflet-control") || t.closest(".marker-auto") ||
            t.closest(".marker-bandera") || t.closest(".marker-destino"));
    }

    function onClickMapa(ev) {
        if (window.RadioMapFantasma && RadioMapFantasma.consumeClick(ev)) return;
        if (window.RadioMapCarrera && RadioMapCarrera.consumeClick(ev)) return;
        if (saltearClickCalle) {
            saltearClickCalle = false;
            return;
        }
        if (clickSobreUiMapa(ev)) return;
        if (modalMapaClickVisible() || modalEncuentroVisible() || modalBuscarVisible() ||
            modalRetomarVisible() || modalAvisosVisible()) return;
        ocultarTipCalle();
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
        Object.keys(markers).forEach(function (id) {
            const m = markers[id];
            if (m && m.isPopupOpen && m.isPopupOpen()) m.closePopup();
        });
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
        prepararFormEncuentro();
        $("modalEncuentro").classList.remove("oculto");
        setTimeout(function () {
            const el = $("encNombre");
            if (el) el.focus();
        }, 50);
    }

    function idsContactosEncuentro() {
        return Object.keys(autos).filter(function (id) {
            return id && id !== miId && id !== FANTASMA_ID && autos[id];
        });
    }

    function alcanceEncuentroElegido() {
        const el = document.querySelector('input[name="encAlcance"]:checked');
        return el ? el.value : "global";
    }

    function mostrarAvisoEncuentro(texto) {
        const el = $("encAlcanceAviso");
        if (!el) {
            if (texto) alert(texto);
            return;
        }
        el.textContent = texto || "";
        el.classList.toggle("oculto", !texto);
    }

    function actualizarCajaPrivadoEncuentro() {
        const caja = $("cajaEncPrivado");
        if (caja) caja.classList.toggle("oculto", alcanceEncuentroElegido() !== "privado");
        mostrarAvisoEncuentro("");
    }

    function prepararFormEncuentro() {
        mostrarAvisoEncuentro("");
        const ids = idsContactosEncuentro();
        const tieneGrupo = !!miGrupo;
        const grupoRadio = $("encAlcanceGrupo");
        const privRadio = $("encAlcancePrivado");
        const hint = $("encGrupoHint");
        const sel = $("encPrivadoPara");
        if (hint) hint.textContent = tieneGrupo ? ("Solo el grupo " + miGrupo) : "Uníte a un grupo primero";
        if (grupoRadio) {
            grupoRadio.disabled = !tieneGrupo;
            const wrap = grupoRadio.closest(".enc-alcance-opt");
            if (wrap) wrap.classList.toggle("off", !tieneGrupo);
        }
        if (privRadio) {
            privRadio.disabled = !ids.length;
            const wrap = privRadio.closest(".enc-alcance-opt");
            if (wrap) wrap.classList.toggle("off", !ids.length);
        }
        if (sel) {
            sel.innerHTML = "";
            if (!ids.length) {
                const o = document.createElement("option");
                o.value = "";
                o.textContent = "No hay contactos en el mapa";
                sel.appendChild(o);
                sel.disabled = true;
            } else {
                sel.disabled = false;
                ids.forEach(function (id) {
                    const a = autos[id];
                    const o = document.createElement("option");
                    o.value = id;
                    o.textContent = (a.nombre || "Sin nombre") + (a.vehiculo ? " · " + a.vehiculo : "");
                    sel.appendChild(o);
                });
                if (contactoActivo && autos[contactoActivo] && contactoActivo !== FANTASMA_ID) {
                    sel.value = contactoActivo;
                }
            }
        }
        let def = "global";
        if (contactoActivo && ids.indexOf(contactoActivo) >= 0) def = "privado";
        else if (tieneGrupo) def = "grupo";
        const radioDef = document.querySelector('input[name="encAlcance"][value="' + def + '"]');
        if (radioDef && !radioDef.disabled) radioDef.checked = true;
        else {
            const g = document.querySelector('input[name="encAlcance"][value="global"]');
            if (g) g.checked = true;
        }
        actualizarCajaPrivadoEncuentro();
    }

    function textoAlcanceEncuentro(p) {
        const a = p && p.alcance;
        if (a === "global") return "Visible para todos";
        if (a === "grupo") return "Solo el grupo " + (p.grupo || "");
        if (a === "privado") {
            if (p.de === miId) {
                const nom = (p.para && autos[p.para] && autos[p.para].nombre) || p.paraNombre || "un contacto";
                return "Solo con " + nom;
            }
            return "Solo entre ustedes";
        }
        return "Compartido en la radio";
    }

    function colorBandera(alcance) {
        if (alcance === "grupo") return "#2b6cb0";
        if (alcance === "privado") return "#0f766e";
        return "#d97706";
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

    function iconoBandera(alcance) {
        const fill = colorBandera(alcance);
        const cls = alcance === "grupo" ? "enc-grupo" : (alcance === "privado" ? "enc-privado" : "enc-global");
        return L.divIcon({
            className: "marker-bandera " + cls,
            html: '<div class="bandera" aria-hidden="true"><svg viewBox="0 0 32 40"><path d="M7 38V6" fill="none" stroke="#1f2430" stroke-width="2.2" stroke-linecap="round"/><path d="M8 6h18l-5 7 5 7H8z" fill="' + fill + '" stroke="#1f2430" stroke-width="1.4" stroke-linejoin="round"/></svg></div>',
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
        try { localStorage.removeItem(VIAJE_FLAG); } catch (e) {}
        try { localStorage.removeItem(VIAJE_DEST_KEY); } catch (e) {}
        persistirFlagsSesion();
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
        const yo = gpsCrudoNav || [miPosicion.lat, miPosicion.lng];
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
        const yo = gpsCrudoNav || [miPosicion.lat, miPosicion.lng];
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
            if (primera) activarNavGpsAlComenzar();
            dibujarRuta(path, hasta, !!opts.sinMarker, primera && !modoNavGps);
            if (primera || modoNavGps) seguirMe = true;
            actualizarHudRuta();
            persistirRuta();
        });
    }

    function actualizarNavegacion() {
        if (!navegacion || !miPosicion) return;
        const yo = gpsCrudoNav || [miPosicion.lat, miPosicion.lng];
        if (llegoDestino(yo)) {
            finalizarLlegada();
            return;
        }
        actualizarHudRuta();
        const info = infoSobreRuta(yo, navegacion.path);
        const vel = miPosicion.velocidad || 0;
        const umbral = vel > 70 ? 32 : (vel > 40 ? 22 : 14);
        const cooldown = vel > 50 ? 420 : 580;
        const rumbo = Number.isFinite(miPosicion.rumbo) ? miPosicion.rumbo : null;
        const contra = rumbo != null && info.rumboPath != null &&
            anguloDiff(rumbo, info.rumboPath) > 42 && info.dist > 10;
        const fuera = info.dist > umbral;
        const remapEta = Date.now() - navegacion.ts > 12000;
        if ((fuera || contra || remapEta) && Date.now() - navegacion.ts > cooldown) {
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
        if (!raw || !raw.path) return false;
        if (raw.modo === "pie" || raw.modo === "auto") {
            modoTransito = raw.modo;
            aplicarModoTransito();
        }
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
        persistirFlagsSesion();
        const viaje = rumboDeViaje();
        if (Number.isFinite(viaje)) aplicarRumbo(miId, viaje);
        if (raw.dest && miPosicion) {
            iniciarNavegacion(raw.dest, { sinMarker: !!raw.sinMarker, ajustarVista: false });
        }
        return true;
    }

    function modalRetomarVisible() {
        const el = $("modalRetomarRuta");
        return !!(el && !el.classList.contains("oculto"));
    }

    function ocultarModalRetomarRuta() {
        const el = $("modalRetomarRuta");
        if (el) el.classList.add("oculto");
    }

    function mostrarModalRetomarRuta(raw) {
        const el = $("modalRetomarRuta");
        if (!el) return;
        const txt = $("txtRetomarRuta");
        if (txt) {
            const dist = raw && raw.distance ? textoDistancia(raw.distance / 1000) : "";
            txt.textContent = dist
                ? "Ibas a un destino a " + dist + ". ¿Querés retomar la ruta?"
                : "Tenés un viaje guardado. Si retomás, seguís al mismo destino sin cortar el mapa de los demás.";
        }
        el.classList.remove("oculto");
    }

    function retomarRutaGuardada() {
        try { sessionStorage.setItem(RUTA_DECISION_KEY, "retomar"); } catch (e) {}
        ocultarModalRetomarRuta();
        restaurarRutaGuardada();
        avisarSiHayPendientes();
    }

    function descartarRutaGuardada() {
        try { sessionStorage.setItem(RUTA_DECISION_KEY, "descartar"); } catch (e) {}
        ocultarModalRetomarRuta();
        cancelarNavegacion();
        avisarSiHayPendientes();
    }

    function preguntarRetomarRutaSiCorresponde() {
        if (esInvitadoFantasma()) return;
        if (portadaVisible() && !yaEntroMapa()) return;
        const raw = leerRutaGuardada(null);
        if (!raw || !raw.path) {
            persistirFlagsSesion();
            return;
        }
        let decision = "";
        try { decision = sessionStorage.getItem(RUTA_DECISION_KEY) || ""; } catch (e) { decision = ""; }
        if (decision === "retomar") {
            restaurarRutaGuardada();
            return;
        }
        if (decision === "descartar") {
            cancelarNavegacion();
            return;
        }
        mostrarModalRetomarRuta(raw);
    }

    function htmlEncuentro(p) {
        const horario = p.horario ? formatearFechaHora(new Date(p.horario).getTime()) : "";
        const mio = !p.de || p.de === miId;
        return (
            '<div class="popup-encuentro-cuerpo" data-enc="' + esc(p.id) + '">' +
                "<h4>" + esc(p.nombre || "Encuentro") + "</h4>" +
                (horario ? '<p class="enc-horario">' + esc(horario) + "</p>" : "") +
                (p.descripcion ? "<p>" + esc(p.descripcion) + "</p>" : "") +
                '<p class="enc-alcance-txt">' + esc(textoAlcanceEncuentro(p)) + "</p>" +
                (mio ? '<button type="button" data-accion="quitar-enc">Quitar</button>' : "") +
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

    function visibleEncuentro(p) {
        if (!p) return false;
        if (p.de && p.de === miId) return true;
        if (!miPosicion || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) return true;
        return calcularDistanciaKm(miPosicion.lat, miPosicion.lng, p.lat, p.lng) <= ENC_KM + 0.5;
    }

    function mostrarBanderaEncuentro(p) {
        if (!p || !p.marker) return;
        const vis = visibleEncuentro(p);
        const on = map.hasLayer(p.marker);
        if (vis && !on) p.marker.addTo(map);
        else if (!vis && on) map.removeLayer(p.marker);
    }

    function refrescarBanderasEncuentro() {
        Object.keys(encuentros).forEach(function (id) {
            mostrarBanderaEncuentro(encuentros[id]);
        });
    }

    function ponerBanderaEncuentro(p, abrir) {
        const marker = L.marker([p.lat, p.lng], {
            icon: iconoBandera(p.alcance),
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
        mostrarBanderaEncuentro(p);
        if (abrir && visibleEncuentro(p)) marker.openPopup();
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
            alcance: raw.alcance || "",
            para: raw.para || "",
            paraNombre: raw.paraNombre || "",
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
            prev.alcance = p.alcance || prev.alcance;
            prev.para = p.para || prev.para;
            prev.paraNombre = p.paraNombre || prev.paraNombre;
            prev.pendiente = false;
            prev.marker.setLatLng([p.lat, p.lng]);
            prev.marker.setIcon(iconoBandera(prev.alcance));
            prev.marker.setPopupContent(htmlEncuentro(prev));
            encuentros[p.id] = prev;
            mostrarBanderaEncuentro(prev);
            if (abrir && visibleEncuentro(prev)) prev.marker.openPopup();
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
                alcance: p.alcance || "",
                para: p.para || "",
                paraNombre: p.paraNombre || "",
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
        const alcance = alcanceEncuentroElegido();
        let para = "";
        let paraNombre = "";
        let grupo = "";
        if (alcance === "grupo") {
            if (!miGrupo) {
                mostrarAvisoEncuentro("Uníte a un grupo para dejar un punto solo para el grupo.");
                return;
            }
            grupo = miGrupo;
        } else if (alcance === "privado") {
            const sel = $("encPrivadoPara");
            para = sel ? sel.value : "";
            if (!para || !autos[para]) {
                mostrarAvisoEncuentro("Elegí un contacto para el punto privado.");
                return;
            }
            paraNombre = autos[para].nombre || "contacto";
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
            grupo: grupo,
            alcance: alcance,
            para: para,
            paraNombre: paraNombre,
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
                descripcion: punto.descripcion,
                alcance: punto.alcance,
                para: punto.para
            }, function (res) {
                if (res && res.ok && res.encuentro) aplicarEncuentro(res.encuentro, false);
                else if (res && res.error) {
                    quitarEncuentro(punto.id, true);
                    alert(res.error);
                }
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

    function animarHacia(id, marker, dest, rumboDest) {
        const est = estadoMovimiento(id);
        est.seq += 1;
        const seq = est.seq;
        if (est.raf) {
            cancelAnimationFrame(est.raf);
            est.raf = null;
        }
        const from = marker.getLatLng();
        const origen = [from.lat, from.lng];
        const metros = metrosEntre(origen, dest);
        if (metros < 0.45) {
            marker.setLatLng(dest);
            if (Number.isFinite(rumboDest)) aplicarRumbo(id, rumboDest);
            return;
        }
        const rumboMov = rumboEntre(origen, dest);
        const rumbo = Number.isFinite(rumboDest) ? rumboDest : rumboMov;
        const duration = Math.max(140, Math.min(620, metros * 22));
        const t0 = performance.now();
        function frame(now) {
            if (est.seq !== seq) return;
            const t = Math.min(1, (now - t0) / duration);
            const e = t * (2 - t);
            marker.setLatLng([
                origen[0] + (dest[0] - origen[0]) * e,
                origen[1] + (dest[1] - origen[1]) * e
            ]);
            aplicarRumbo(id, rumbo);
            if (t < 1) est.raf = requestAnimationFrame(frame);
            else est.raf = null;
        }
        est.raf = requestAnimationFrame(frame);
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
        return Number.isFinite(n) && n > 0 ? Math.min(10, n) : 3;
    }

    function restaurarRadioGuardado() {
        const raw = localStorage.getItem("radiomap_radio");
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) return;
        const el = $("radioFiltro");
        if (!el) return;
        const capped = Math.min(10, n);
        const ok = Array.prototype.some.call(el.options, function (o) {
            return parseFloat(o.value) === capped;
        });
        if (ok) el.value = String(capped);
        else el.value = "3";
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
        if (soyYoId(a.id)) {
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
        const soyYo = soyYoId(a.id);
        const det = datosFichaDe(a);
        const placa = det ? det.placa : "";
        const telRaw = det ? det.contacto : "";
        const tel = (telRaw || "").replace(/[^\d+]/g, "");
        const nombre = nombreConductor(a);
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
                '<button type="button" class="btn-ficha" data-accion="silenciar">' +
                    (esBloqueado(a.id) ? "Quitar silencio" : "Silenciar") +
                "</button>" +
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
        const pop = marker.getPopup && marker.getPopup();
        const root = pop && pop.getElement();
        if (!root) return;
        root.querySelectorAll("[data-accion]").forEach(function (btn) {
            const accion = btn.getAttribute("data-accion");
            if (accion === "walkie") {
                btn.onpointerdown = function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ctxPtt();
                    if (btn.setPointerCapture) btn.setPointerCapture(ev.pointerId);
                    if (esFantasma(id)) {
                        mostrarMensajeFantasma();
                        return;
                    }
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
                    if (id === miId) {
                        desactivarNavGpsSiActivo();
                        seguirMe = true;
                        map.setView([auto.lat, auto.lng], Math.max(map.getZoom(), 16));
                    } else {
                        volarHastaAuto(auto.lat, auto.lng, Math.max(map.getZoom(), 16));
                    }
                }
                if (accion === "mensaje") {
                    seleccionarContacto(id);
                    abrirComms();
                    mostrarTab("privado");
                }
                if (accion === "silenciar") {
                    alternarBloqueo(id);
                    refrescarFicha(id, autos[id]);
                }
                if (accion === "ficha") pedirFicha(id);
                if (accion === "sos") alternarAsistencia();
            };
        });
    }

    function visibleEnMapa(a) {
        if (!a || a.id === miId) return true;
        if (a.enGrupo || (miGrupo && a.grupo && a.grupo === miGrupo)) return true;
        if (!miPosicion || !Number.isFinite(Number(a.lat)) || !Number.isFinite(Number(a.lng))) return true;
        return calcularDistanciaKm(miPosicion.lat, miPosicion.lng, a.lat, a.lng) <= radioKmActual() + 0.2;
    }

    function actualizarMarker(a) {
        if (!a || !Number.isFinite(Number(a.lat)) || !Number.isFinite(Number(a.lng))) return;
        if (esInvitadoFantasma() && (a.id === miId || soyYoId(a.id))) {
            if (markers[a.id]) quitarVehiculo(a.id);
            return;
        }
        if (window.RadioMapCarrera && RadioMapCarrera.bloqueaGps()) {
            if (a.id === miId) return;
            if (RadioMapCarrera.esRival && RadioMapCarrera.esRival(a.id)) return;
            if (markers[a.id]) {
                map.removeLayer(markers[a.id]);
                delete markers[a.id];
            }
            return;
        }
        if (soyYoId(a.id) && a.id !== miId) {
            quitarVehiculo(a.id);
            return;
        }
        if (a.id !== miId && esBloqueado(a.id)) {
            quitarVehiculo(a.id);
            return;
        }
        if (a.id !== miId && !visibleEnMapa(a)) {
            if (markers[a.id]) {
                map.removeLayer(markers[a.id]);
                delete markers[a.id];
            }
            return;
        }
        const latlng = [Number(a.lat), Number(a.lng)];
        const soyYo = a.id === miId;

        if (!markers[a.id]) {
            const marker = L.marker(latlng, {
                icon: crearIcono(soyYo, iconoDeAuto(a)),
                zIndexOffset: soyYo ? 1000 : 0
            }).addTo(map);
            marker.bindTooltip(nombreHtml(a), nombreOpts(soyYo, a));
            marker.bindPopup(fichaHtml(a), fichaPopupOpts(soyYo, a));
            silenciarClickPopupLeaflet(marker);
            markers[a.id] = marker;
            engancharClickMarker(marker, a.id);
            engancharPopupCapa(marker, a.id);
            silenciarHoverFicha(marker, a.id);
            aplicarIconoEnMarker(a.id, iconoDeAuto(a));
            marcarSosMarker(a.id, !!(a.asistencia && a.asistencia.activo));
            marcarAusente(a.id, !!a.ausente);
            requestAnimationFrame(function () {
                aplicarRumbo(a.id, a.rumbo);
                aplicarIconoEnMarker(a.id, iconoDeAuto(a));
                marcarAusente(a.id, !!a.ausente);
                aplicarVisibilidadCapa(marker, a.id);
            });
            if (soyYo) asegurarTickGps();
            return;
        }

        if (a.id === FANTASMA_ID) {
            markers[a.id].setLatLng(latlng);
        } else if (soyYo) {
            posGpsObjetivo = {
                lat: latlng[0],
                lng: latlng[1],
                rumbo: a.rumbo,
                vel: a.velocidad || 0
            };
            asegurarTickGps();
        } else if (mapaOcupado) {
            return;
        } else {
            animarHacia(a.id, markers[a.id], latlng, a.rumbo);
        }
        aplicarRumbo(a.id, a.rumbo);
        aplicarIconoEnMarker(a.id, iconoDeAuto(a));
        marcarSosMarker(a.id, !!(a.asistencia && a.asistencia.activo));
        marcarAusente(a.id, !!a.ausente);
        refrescarFicha(a.id, a);
    }

    function aplicarClasesCapa(marker, id, a) {
        const sos = !!(a && a.asistencia && a.asistencia.activo) || (id === miId && asistenciaActiva);
        const pop = marker.getPopup && marker.getPopup();
        const popClass = "ficha-popup" + (id === miId ? " ficha-propia" : " ficha-radio") + (sos ? " ficha-sos" : "");
        if (pop) pop.options.className = popClass;
        const popEl = pop && pop.getElement && pop.getElement();
        if (popEl) {
            popEl.classList.toggle("ficha-propia", id === miId);
            popEl.classList.toggle("ficha-radio", id !== miId);
            popEl.classList.toggle("ficha-sos", sos);
        }
        const tip = marker.getTooltip && marker.getTooltip();
        const tipClass = "nombre-conductor" + (id === miId ? " nombre-propio" : "") + (sos ? " nombre-sos" : "");
        if (tip) tip.options.className = tipClass;
        const tipEl = tip && tip.getElement && tip.getElement();
        if (tipEl) {
            tipEl.classList.toggle("nombre-propio", id === miId);
            tipEl.classList.toggle("nombre-sos", sos);
        }
    }

    function aplicarVisibilidadCapa(marker, id) {
        if (!marker) return;
        if (debeMostrarFicha(id)) {
            if (marker.closeTooltip) marker.closeTooltip();
            if (marker.openPopup && !(marker.isPopupOpen && marker.isPopupOpen())) marker.openPopup();
            requestAnimationFrame(function () { engancharFicha(marker, id); });
            return;
        }
        if (marker.isPopupOpen && marker.isPopupOpen()) marker.closePopup();
        if (debeMostrarNombre(id)) {
            if (marker.openTooltip && !(marker.isTooltipOpen && marker.isTooltipOpen())) marker.openTooltip();
        } else if (marker.closeTooltip) {
            marker.closeTooltip();
        }
    }

    function refrescarFicha(id, a) {
        const m = markers[id];
        if (!m || pttActivo || !a) return;
        if (!m.getTooltip()) {
            m.bindTooltip(nombreHtml(a), nombreOpts(id === miId, a));
        } else {
            m.setTooltipContent(nombreHtml(a));
        }
        if (!m.getPopup()) {
            m.bindPopup(fichaHtml(a), fichaPopupOpts(id === miId, a));
            silenciarClickPopupLeaflet(m);
            engancharPopupCapa(m, id);
        } else {
            m.setPopupContent(fichaHtml(a));
        }
        silenciarHoverFicha(m, id);
        aplicarClasesCapa(m, id, a);
        aplicarVisibilidadCapa(m, id);
    }

    function aplicarVisibilidadPopups() {
        Object.keys(markers).forEach(function (id) {
            aplicarVisibilidadCapa(markers[id], id);
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

    function cantidadOtros() {
        return Object.keys(autos).filter(function (id) {
            return id !== miId && id !== FANTASMA_ID;
        }).length;
    }

    function podarAutosLejanos() {
        if (cantidadOtros() <= MAX_AUTOS_MAPA) return;
        const ranked = [];
        Object.keys(autos).forEach(function (id) {
            if (id === miId || id === FANTASMA_ID) return;
            const a = autos[id];
            if (!a) return;
            const enG = !!(a.enGrupo || (miGrupo && a.grupo && a.grupo === miGrupo));
            const d = (miPosicion && Number.isFinite(Number(a.lat)))
                ? calcularDistanciaKm(miPosicion.lat, miPosicion.lng, a.lat, a.lng)
                : 9999;
            ranked.push({ id: id, d: enG ? -1 : d, enG: enG });
        });
        ranked.sort(function (x, y) { return x.d - y.d; });
        ranked.slice(MAX_AUTOS_MAPA).forEach(function (x) {
            if (!x.enG) quitarVehiculo(x.id);
        });
    }

    function aplicarEstadoGlobal(estado) {
        if (esInvitadoFantasma()) return;
        const fantasma = fantasmaActivo ? autos[FANTASMA_ID] : null;
        autos = estado && typeof estado === "object" ? estado : {};
        if (fantasma) autos[FANTASMA_ID] = fantasma;
        Object.keys(markers).forEach(function (id) {
            if (!soyYoId(id) && id !== FANTASMA_ID && !autos[id]) quitarVehiculo(id);
        });
        Object.keys(autos).forEach(function (id) {
            if (id === FANTASMA_ID || soyYoId(id)) return;
            if (esBloqueado(id)) {
                quitarVehiculo(id);
                return;
            }
            actualizarMarker(autos[id]);
        });
        podarAutosLejanos();
        renderizarContactos();
        actualizarResumenRed();
        pintarResumenEnRuta();
    }

    // ===================================================
    // Contactos (aside)
    // ===================================================
    function obtenerListaCerca() {
        const lista = [];
        Object.keys(autos).forEach(function (id) {
            if (soyYoId(id)) return;
            if (esBloqueado(id)) return;
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
            if (esFantasma(id)) {
                mostrarMensajeFantasma();
                return;
            }
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
            seleccionarContacto(item.id, true);
            abrirFicha(item.id);
            const a = item.a;
            if (a) volarHastaAuto(a.lat, a.lng, Math.max(map.getZoom(), 16));
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
                (item.a.enRuta === false ? '<em class="tag-cerca">Fuera de ruta</em>' : "") +
                (item.a.enRuta !== false && item.enGrupo ? '<em class="tag-cerca">En ruta</em>' : "") +
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
        pintarResumenEnRuta();
    }

    function actualizarResumenRed(cerca) {
        const total = Object.keys(autos).filter(function (id) { return !soyYoId(id) && id !== FANTASMA_ID; }).length;
        const n = typeof cerca === "number" ? cerca : total;
        const det = $("grupoRadioDetalle");
        if (det) {
            det.textContent = n === 1
                ? "1 vehículo · " + radioKmActual() + " km"
                : (n + " vehículos · " + radioKmActual() + " km");
        }
        actualizarDestinoUI(n);
    }

    function etiquetaCanal() {
        return "RADIO";
    }

    function etiquetaGrupo() {
        if (!miGrupo) return "GRUPO";
        return miGrupoNombre ? miGrupoNombre : ("GRUPO " + miGrupo);
    }

    function actualizarDestinoUI(cerca) {
        const radio = radioKmActual();
        const n = typeof cerca === "number" ? cerca : Object.keys(autos).filter(function (id) { return !soyYoId(id) && id !== FANTASMA_ID; }).length;
        const detalle = "RADIO · " + radio + " km" + (n ? " · " + n + (n === 1 ? " auto" : " autos") : "");
        if ($("destinoNombre")) $("destinoNombre").textContent = detalle;
        if ($("destinoKicker")) $("destinoKicker").textContent = "Walkie y avisos van a";
        if ($("destinoConvoyDetalle")) $("destinoConvoyDetalle").textContent = detalle;
        if ($("txtV2V")) $("txtV2V").placeholder = "Aviso a RADIO…";
        if ($("lblTabRadio")) $("lblTabRadio").textContent = "Público";
        if ($("destinoGrupoDetalle")) {
            $("destinoGrupoDetalle").textContent = miGrupo
                ? (etiquetaGrupo() + " · " + miGrupo)
                : "Sin grupo";
        }
        if ($("txtAvisoGrupo")) {
            $("txtAvisoGrupo").placeholder = miGrupo ? ("Aviso a " + etiquetaGrupo() + "…") : "Aviso al grupo…";
        }
        const pttSmall = document.querySelector("#btnPttMapa .ptt-leyenda small");
        if (pttSmall) pttSmall.textContent = "Walkie a RADIO";
        if (enWalkieFantasma()) pintarLeyendaPttFantasma();
        const btnRadio = $("btnEnviarV2V");
        if (btnRadio) {
            const txt = btnRadio.childNodes[btnRadio.childNodes.length - 1];
            if (txt && txt.nodeType === 3) txt.textContent = " RADIO";
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
            if (debeMostrarFicha(id)) markers[id].openPopup();
            volarHastaAuto(a.lat, a.lng, Math.max(map.getZoom(), 15));
        }
    }

    function pintarHistorialPrivado(id) {
        const cont = $("msgsPrivado");
        cont.innerHTML = "";
        (historialPrivado[id] || []).forEach(function (m) {
            agregarMensaje(cont, m.nombre, m.texto, m.propio, m.ts, "", m.clipId);
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

    function agregarMensaje(cont, nombre, texto, propio, ts, extraClass, clipId) {
        if (!cont) return;
        const div = document.createElement("div");
        div.className = "msg" + (propio ? " propio" : "") + (extraClass ? " " + extraClass : "");
        const hora = ts
            ? '<span class="hora">' + esc(formatearFechaHora(ts)) + "</span>"
            : "";
        const play = (clipId && clipsAudio[clipId])
            ? '<button type="button" class="btn-play-msg" data-clip="' + esc(clipId) + '">Escuchar</button>'
            : "";
        div.innerHTML = '<span class="meta">' + esc(nombre) + "</span>" +
            '<span class="cuerpo">' + esc(texto) + "</span>" + hora + play;
        cont.appendChild(div);
        cont.scrollTop = cont.scrollHeight;
    }

    function usuarioNoEstaEnLaApp() {
        return document.visibilityState !== "visible";
    }

    function guardarClipAudio(data) {
        if (!data || !data.audio) return "";
        const ids = Object.keys(clipsAudio);
        while (ids.length >= CLIPS_AUDIO_MAX) {
            delete clipsAudio[ids.shift()];
        }
        const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        clipsAudio[id] = {
            audio: data.audio,
            mime: data.mime || "audio/webm",
            de: data.de,
            nombre: data.nombre
        };
        return id;
    }

    function persistirFlagAvisos() {
        const n = colaAvisos.length;
        try {
            if (n > 0) sessionStorage.setItem(AVISOS_FLAG, String(n));
            else sessionStorage.removeItem(AVISOS_FLAG);
        } catch (e) {}
    }

    function encolarAviso(item) {
        if (!item) return;
        colaAvisos.push(item);
        while (colaAvisos.length > COLA_AVISOS_MAX) colaAvisos.shift();
        persistirFlagAvisos();
    }

    function reproducirClip(clipId) {
        const clip = clipsAudio[clipId];
        if (!clip) return;
        reproducirAudio({
            audio: clip.audio,
            mime: clip.mime,
            de: clip.de,
            nombre: clip.nombre
        });
    }

    function modalAvisosVisible() {
        const el = $("modalAvisosPendientes");
        return !!(el && !el.classList.contains("oculto"));
    }

    function ocultarModalAvisosPendientes() {
        const el = $("modalAvisosPendientes");
        if (el) el.classList.add("oculto");
        avisosModalListo = false;
    }

    function etiquetaCanalAviso(item) {
        if (item && item.privado) return "Privado";
        if (item && item.canal === "grupo") return "Grupo";
        return "RADIO";
    }

    function pintarListaAvisosPendientes() {
        const lista = $("listaAvisosPendientes");
        if (!lista) return;
        lista.innerHTML = "";
        colaAvisos.forEach(function (item, i) {
            const row = document.createElement("div");
            row.className = "aviso-pend-item";
            const cuerpo = document.createElement("div");
            const p = document.createElement("p");
            p.textContent = (item.nombre || "Alguien") + ": " + (item.texto || "");
            const small = document.createElement("small");
            small.textContent = etiquetaCanalAviso(item);
            cuerpo.appendChild(p);
            cuerpo.appendChild(small);
            row.appendChild(cuerpo);
            if (item.clipId && clipsAudio[item.clipId]) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "btn-oir-aviso";
                btn.setAttribute("data-idx", String(i));
                btn.textContent = "Play";
                btn.addEventListener("click", function () {
                    reproducirClip(item.clipId);
                });
                row.appendChild(btn);
            }
            lista.appendChild(row);
        });
        const oir = $("btnOirAvisosPendientes");
        if (oir) {
            const hayAudio = colaAvisos.some(function (it) { return it.clipId && clipsAudio[it.clipId]; });
            oir.classList.toggle("oculto", !hayAudio);
        }
    }

    function mostrarModalAvisosPendientes() {
        if (!colaAvisos.length) return;
        if (modalRetomarVisible()) {
            avisosModalListo = true;
            return;
        }
        const el = $("modalAvisosPendientes");
        if (!el) return;
        const txt = $("txtAvisosPendientes");
        const n = colaAvisos.length;
        if (txt) {
            txt.textContent = n === 1
                ? "Mientras no estabas te llegó 1 aviso. Los textos están en la radio y los audios se pueden escuchar acá."
                : "Mientras no estabas te llegaron " + n + " avisos. Los textos están en la radio y los audios se pueden escuchar acá.";
        }
        pintarListaAvisosPendientes();
        const ver = $("btnVerAvisosPrivado");
        if (ver) {
            const hayPriv = colaAvisos.some(function (it) { return it.privado; });
            ver.classList.toggle("oculto", !hayPriv);
        }
        el.classList.remove("oculto");
        avisosModalListo = false;
    }

    function avisarSiHayPendientes() {
        if (portadaVisible() && !yaEntroMapa()) return;
        if (modalRetomarVisible()) {
            avisosModalListo = colaAvisos.length > 0;
            return;
        }
        if (colaAvisos.length) mostrarModalAvisosPendientes();
    }

    function reproducirColaAudios() {
        const clips = colaAvisos.filter(function (it) { return it.clipId && clipsAudio[it.clipId]; });
        if (!clips.length || reproduciendoCola) return;
        reproduciendoCola = true;
        let i = 0;
        const siguiente = function () {
            if (i >= clips.length) {
                reproduciendoCola = false;
                return;
            }
            const item = clips[i];
            i += 1;
            const clip = clipsAudio[item.clipId];
            if (!clip) {
                siguiente();
                return;
            }
            const mime = clip.mime || "audio/webm";
            const blob = new Blob([clip.audio], { type: mime });
            const url = URL.createObjectURL(blob);
            const audio = new Audio();
            audio.preload = "auto";
            audio.playsInline = true;
            audio.src = url;
            setAvisoAudio((item.nombre || "Alguien") + " está hablando");
            const fin = function () {
                URL.revokeObjectURL(url);
                setAvisoAudio("");
                siguiente();
            };
            audio.onended = fin;
            audio.onerror = fin;
            const play = audio.play();
            if (play && play.catch) play.catch(fin);
        };
        siguiente();
    }

    function abrirAvisosEnPrivado() {
        const primero = colaAvisos.find(function (it) { return it.privado && it.de; });
        colaAvisos.length = 0;
        persistirFlagAvisos();
        ocultarModalAvisosPendientes();
        mostrarTab("privado");
        abrirComms();
        if (primero && primero.de) seleccionarContacto(primero.de, true);
    }

    function marcarAvisoConsumido() {
        colaAvisos.length = 0;
        persistirFlagAvisos();
        ocultarModalAvisosPendientes();
    }

    // ===================================================
    // Chat
    // ===================================================
    function enviarV2V() {
        const txt = $("txtV2V");
        const texto = txt.value.trim();
        if (!texto) return;
        socket.emit("mensajeV2V", { texto: texto, canal: "radio" });
        txt.value = "";
    }

    function enviarGrupo() {
        const txt = $("txtAvisoGrupo");
        const texto = txt && txt.value.trim();
        if (!texto) return;
        if (!miGrupo) {
            alert("Creá o unite a un grupo para enviar avisos al convoy.");
            return;
        }
        socket.emit("mensajeV2V", { texto: texto, canal: "grupo" });
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
        if (esFantasma(id)) {
            cacheFichas[id] = { placa: "TST 000", seguro: "AutoTest", contacto: "" };
            const a = autos[id];
            if (a) refrescarFicha(id, a);
            return;
        }
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
        const nomInp = $("txtGrupoNombre");
        const itemMio = $("itemGrupoMio");
        const itemRadio = $("itemGrupoRadio");
        const nomMio = $("nombreGrupoMio");
        const detMio = $("detalleGrupoMio");
        const tabGrupo = $("tabGrupo");
        const btnIr = $("btnIrAGrupos");
        if (estado) {
            if (miGrupo) {
                estado.textContent = (miGrupoNombre ? miGrupoNombre : "Grupo") +
                    " · código " + miGrupo + ". El walkie de esta pestaña va al convoy.";
            } else {
                estado.textContent = "Poné un nombre y creá el grupo, o ingresá un código para unirte.";
            }
        }
        if (txt) {
            if (miGrupo) txt.value = miGrupo;
            txt.readOnly = !!miGrupo;
        }
        if (nomInp) {
            if (miGrupoNombre) nomInp.value = miGrupoNombre;
            nomInp.readOnly = !!miGrupo;
        }
        if (salir) salir.classList.toggle("oculto", !miGrupo);
        if (share) share.classList.toggle("oculto", !miGrupo);
        if (unir) unir.classList.toggle("oculto", !!miGrupo);
        if (crear) crear.classList.toggle("oculto", !!miGrupo);
        if (itemMio) {
            itemMio.classList.toggle("oculto", !miGrupo);
            itemMio.classList.toggle("activo", !!miGrupo);
        }
        if (itemRadio) itemRadio.classList.toggle("activo", true);
        if (nomMio) nomMio.textContent = miGrupoNombre || miGrupo || "—";
        if (detMio) detMio.textContent = miGrupo ? ("Código " + miGrupo) : "Código —";
        if (tabGrupo) tabGrupo.classList.toggle("oculto", !miGrupo && tabActiva !== "grupo");
        if (btnIr) btnIr.classList.toggle("oculto", !!miGrupo);
        pintarResumenEnRuta();
    }

    function guardarNombreGrupoLocal(nombre) {
        miGrupoNombre = String(nombre || "").trim().slice(0, 32);
        if (miGrupoNombre) localStorage.setItem("radiomap_grupo_nombre", miGrupoNombre);
        else localStorage.removeItem("radiomap_grupo_nombre");
    }

    function aplicarGrupo(codigo, nombre) {
        miGrupo = normalizarGrupo(codigo);
        if (miGrupo) localStorage.setItem("radiomap_grupo", miGrupo);
        else localStorage.removeItem("radiomap_grupo");
        if (arguments.length > 1) guardarNombreGrupoLocal(nombre);
        else if (!miGrupo) guardarNombreGrupoLocal("");
        const txt = $("txtGrupo");
        if (txt) txt.value = miGrupo;
        const nomInp = $("txtGrupoNombre");
        if (nomInp && miGrupoNombre) nomInp.value = miGrupoNombre;
        pintarEstadoGrupo();
        actualizarDestinoUI();
        emitirTelemetria(true);
        const caja = $("cajaGrupo");
        if (caja && miGrupo) caja.classList.remove("oculto");
        const propia = markers[miId] && (autos[miId] || Object.assign(datosPropios(), miPosicion || {}, { id: miId }));
        if (propia && markers[miId]) refrescarFicha(miId, propia);
        if (miGrupo) mostrarTab("grupo");
        else if (tabActiva === "grupo") mostrarTab("general");
    }

    function unirseAGrupo() {
        const codigo = normalizarGrupo($("txtGrupo") && $("txtGrupo").value);
        if (codigo.length < 4) {
            alert("El código tiene que tener entre 4 y 8 letras o números.");
            return;
        }
        socket.emit("grupoUnirse", {
            codigo: codigo,
            nombre: $("txtGrupoNombre") ? $("txtGrupoNombre").value.trim() : ""
        }, function (res) {
            if (!res || !res.ok) {
                aplicarGrupo(codigo, $("txtGrupoNombre") && $("txtGrupoNombre").value);
                return;
            }
            aplicarGrupo(res.codigo, res.nombre);
        });
    }

    function crearGrupo() {
        const nombre = ($("txtGrupoNombre") && $("txtGrupoNombre").value.trim()) || "";
        if (!nombre) {
            alert("Poné un nombre para el grupo.");
            return;
        }
        const codigo = normalizarGrupo($("txtGrupo") && $("txtGrupo").value);
        socket.emit("grupoCrear", { nombre: nombre, codigo: codigo }, function (res) {
            if (!res || !res.ok || !res.codigo) {
                alert("No se pudo crear el grupo. Probá de nuevo.");
                return;
            }
            aplicarGrupo(res.codigo, res.nombre || nombre);
        });
    }

    function salirDeGrupo() {
        socket.emit("grupoSalir");
        aplicarGrupo("");
    }

    function compartirGrupo() {
        if (!miGrupo) return;
        const url = location.origin + location.pathname + "?g=" + encodeURIComponent(miGrupo) +
            (miGrupoNombre ? "&n=" + encodeURIComponent(miGrupoNombre) : "");
        const etiqueta = miGrupoNombre ? (miGrupoNombre + " (" + miGrupo + ")") : miGrupo;
        const texto = "Entrá al grupo " + etiqueta + " en RadioMap: " + url;
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
        if (btn) {
            btn.classList.toggle("activo", asistenciaActiva);
            const txt = btn.querySelector("span:not(.atajo-ico)");
            if (txt) txt.textContent = asistenciaActiva ? "Cancelar ayuda" : "Necesito ayuda";
        }
        const dock = $("btnDockAyuda");
        if (dock) dock.classList.toggle("activo", asistenciaActiva);
        const dockAyuda = $("btnAyudaDock");
        if (dockAyuda) dockAyuda.classList.toggle("activo", asistenciaActiva);
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
        if (esInvitadoFantasma()) return;
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
        // rumbo geográfico (0=N, 90=E): dirección que debe quedar arriba en pantalla.
        // leaflet-rotate aplica rotate() CSS horario; para heading-up hay que invertir.
        const geo = ((Number(deg) % 360) + 360) % 360;
        map.setBearing((360 - geo) % 360);
    }

    function refrescarRumbosMarcadores() {
        Object.keys(markers).forEach(function (id) {
            const h = (autos[id] && Number.isFinite(Number(autos[id].rumbo)))
                ? autos[id].rumbo
                : (id === miId && miPosicion ? miPosicion.rumbo : null);
            aplicarRumbo(id, h);
        });
    }

    /** Solo rumbo geográfico de la ruta / movimiento. Sin feedback de pantalla (evita spins). */
    function rumboDestinoNavGps() {
        const m = markers[miId];
        const p = m
            ? [m.getLatLng().lat, m.getLatLng().lng]
            : (miPosicion ? [miPosicion.lat, miPosicion.lng] : null);
        const viaje = rumboDeViaje(p);
        if (Number.isFinite(viaje)) return viaje;
        if (Number.isFinite(miPosicion && miPosicion.rumbo)) return miPosicion.rumbo;
        return rumboNavSuave;
    }

    function tickNavGps() {
        if (!modoNavGps) {
            navGpsRaf = null;
            return;
        }
        if (window.RadioMapCarrera && RadioMapCarrera.bloqueaGps()) {
            navGpsRaf = requestAnimationFrame(tickNavGps);
            return;
        }
        const m = markers[miId];
        const pos = m
            ? m.getLatLng()
            : (miPosicion ? L.latLng(miPosicion.lat, miPosicion.lng) : null);
        if (!pos || map._animatingZoom || (map.touchGestures && map.touchGestures._zooming)) {
            navGpsRaf = requestAnimationFrame(tickNavGps);
            return;
        }

        const destino = rumboDestinoNavGps();
        if (Number.isFinite(destino)) {
            const diff = anguloDiff(rumboNavSuave, destino);
            // Suavizado estable (sin correcciones de pantalla que peleen entre sí).
            const t = diff > 45 ? 0.12 : 0.22;
            rumboNavSuave = lerpAngulo(rumboNavSuave, destino, t);
            if (miPosicion && Number.isFinite(destino)) {
                miPosicion.rumbo = destino;
                if (posGpsObjetivo) posGpsObjetivo.rumbo = destino;
            }
        }

        fijarVistaNavGps(pos);
        pintarRumbo(miId, 0);
        refrescarRumbosMarcadores();

        navGpsRaf = requestAnimationFrame(tickNavGps);
    }

    function aplicarModoNavGps() {
        document.body.classList.toggle("modo-nav-gps", modoNavGps);
        const btn = $("btnNavGps");
        if (btn) {
            btn.classList.toggle("on", modoNavGps);
            btn.setAttribute("aria-pressed", modoNavGps ? "true" : "false");
            btn.title = modoNavGps
                ? "Navegación GPS activa: auto fijo; mapa y ruta giran (estilo GPS)"
                : "Navegación GPS: auto fijo abajo; el mapa gira y la ruta queda hacia arriba";
        }
        if (modoNavGps) {
            seguirMe = true;
            vistaRadio = false;
            pedirWakeLock();
            if (map.dragging) map.dragging.disable();
            if (miPosicion) {
                navGpsZoomPendiente = false;
                const pos = markers[miId]
                    ? markers[miId].getLatLng()
                    : L.latLng(miPosicion.lat, miPosicion.lng);
                const viaje = rumboDeViaje([pos.lat, pos.lng]);
                if (Number.isFinite(viaje)) rumboNavSuave = viaje;
                else if (Number.isFinite(miPosicion.rumbo)) rumboNavSuave = miPosicion.rumbo;
                rumboVisual = 0;
                fijarVistaNavGps(pos, Math.max(map.getZoom(), 17));
                pintarRumbo(miId, 0);
                refrescarRumbosMarcadores();
            } else {
                navGpsZoomPendiente = true;
                iniciarGps();
            }
            if (markers[miId]) {
                if (markers[miId].closePopup) markers[miId].closePopup();
                if (markers[miId].closeTooltip) markers[miId].closeTooltip();
            }
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

    function desactivarNavGpsSiActivo() {
        if (!modoNavGps) return;
        const btn = $("btnNavGps");
        if (btn) btn.click();
        else {
            modoNavGps = false;
            aplicarModoNavGps();
        }
    }

    function volarHastaAuto(lat, lng, zoom) {
        if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;
        desactivarNavGpsSiActivo();
        seguirMe = false;
        vistaRadio = false;
        const z = zoom != null ? zoom : Math.max(map.getZoom(), 16);
        if (typeof map.flyTo === "function") {
            map.flyTo([Number(lat), Number(lng)], z, { duration: 0.85, easeLinearity: 0.25 });
        } else {
            map.setView([Number(lat), Number(lng)], z);
        }
    }

    function activarNavGpsAlComenzar() {
        if (modoNavGps) return;
        const btn = $("btnNavGps");
        if (btn) btn.click();
        else alternarModoNavGps();
    }

    function aplicarModoTransito() {
        document.body.classList.toggle("modo-a-pie", modoTransito === "pie");
        const btn = $("btnModoTransito");
        if (btn) {
            btn.classList.toggle("on", modoTransito === "pie");
            btn.setAttribute("aria-pressed", modoTransito === "pie" ? "true" : "false");
            btn.title = modoTransito === "pie"
                ? "Modo a pie: la ruta no respeta el sentido de las calles. Tocá para ir en auto."
                : "Modo auto: la ruta respeta las manos de las calles. Tocá para ir a pie.";
        }
    }

    function alternarModoTransito() {
        modoTransito = modoTransito === "pie" ? "auto" : "pie";
        try { localStorage.setItem("radiomap_transito", modoTransito); } catch (e) {}
        aplicarModoTransito();
        if (navegacion && navegacion.dest) {
            iniciarNavegacion(navegacion.dest, {
                sinMarker: !!navegacion.sinMarker,
                ajustarVista: false
            });
        }
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

    function enWalkieFantasma() {
        return esInvitadoFantasma() || !!(window.RadioMapFantasma && RadioMapFantasma.activo());
    }

    function nombreWalkie() {
        const el = $("nombre");
        const n = el && el.value ? el.value.trim() : "";
        if (n) return n;
        try { return (localStorage.getItem("nombre") || "").trim() || "Alguien"; } catch (e) {
            return "Alguien";
        }
    }

    function pintarLeyendaPttFantasma() {
        const txt = esInvitadoFantasma() ? "Walkie al fantasma" : "Walkie a RADIO y fantasma";
        const titulo = esInvitadoFantasma()
            ? "Mantené para hablarle a quien compartió el recorrido"
            : "Mantené para hablar a RADIO y al fantasma";
        document.querySelectorAll("#btnPttMapa .ptt-leyenda small, #btnPttDock .ptt-leyenda small").forEach(function (el) {
            el.textContent = txt;
        });
        ["btnPttMapa", "btnPttDock"].forEach(function (id) {
            const b = $(id);
            if (b) b.title = titulo;
        });
    }

    function modoPttTab() {
        if (tabActiva === "privado") return "privado";
        if (tabActiva === "grupo") return "grupo";
        return "general";
    }

    function pintarCanalPtt() {
        if (esInvitadoFantasma()) {
            pintarLeyendaPttFantasma();
            return;
        }
        const canal = modoPttTab();
        const titulo = canal === "privado"
            ? "Mantené para hablar en privado"
            : (canal === "grupo" ? "Mantené para hablar al grupo" : "Mantené para hablar a RADIO");
        ["btnPttDock", "btnPttMapa"].forEach(function (id) {
            const btn = $(id);
            if (!btn) return;
            btn.classList.toggle("ptt-canal-privado", canal === "privado");
            btn.classList.toggle("ptt-canal-grupo", canal === "grupo");
            btn.title = titulo;
        });
    }

    function bindPtt(el, modo) {
        if (!el) return;
        el.addEventListener("pointerdown", function (ev) {
            ev.preventDefault();
            ctxPtt();
            if (el.setPointerCapture) el.setPointerCapture(ev.pointerId);
            empezarPtt(typeof modo === "function" ? modo() : modo);
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
        if (modo === "grupo") return "grupo";
        if (modo === "carrera") return "carrera";
        if (modo === "fantasma") return "fantasma";
        return "general";
    }

    function empezarPtt(modo) {
        if (esInvitadoFantasma()) modo = "fantasma";
        if (resolverModoPtt(modo) === "privado" && esFantasma(contactoActivo)) {
            mostrarMensajeFantasma();
            return;
        }
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
        if (canal === "grupo" && !miGrupo) {
            alert("Creá o unite a un grupo para hablarle al convoy.");
            return;
        }
        if (canal === "carrera" && !(window.RadioMapCarrera && RadioMapCarrera.activo())) {
            return;
        }
        ctxPtt();
        pedirWakeLock();
        pttModo = canal;
        pttActivo = true;
        pttChunks = [];
        pttTranscripcion = "";
        pttAckHecho = false;
        document.querySelectorAll(".btn-ptt, .btn-ptt-mapa, .btn-grupo-speaker").forEach(function (b) {
            b.classList.add("grabando");
        });
        if ($("destinoHabla")) $("destinoHabla").classList.add("transmitiendo");
        if (canal === "privado") {
            const dest = autos[contactoActivo];
            const nom = (dest && dest.nombre) || "esa persona";
            setAvisoAudio("Mantené para hablar a " + nom + " — soltá para enviar");
            if ($("destinoKicker")) $("destinoKicker").textContent = "Transmitiendo en directo a";
            if ($("destinoNombre")) $("destinoNombre").textContent = nom;
        } else if (canal === "grupo") {
            setAvisoAudio("Mantené para hablar a " + etiquetaGrupo() + " — soltá para enviar");
            if ($("destinoKicker")) $("destinoKicker").textContent = "Transmitiendo al grupo";
            if ($("destinoNombre")) $("destinoNombre").textContent = etiquetaGrupo() + " · " + miGrupo;
        } else if (canal === "carrera") {
            setAvisoAudio("Mantené para hablar a la carrera — soltá para enviar");
        } else if (canal === "fantasma") {
            setAvisoAudio("Mantené para hablar al fantasma — soltá para enviar");
            pintarLeyendaPttFantasma();
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
                document.querySelectorAll(".btn-ptt, .btn-ptt-mapa, .btn-grupo-speaker").forEach(function (b) {
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
        document.querySelectorAll(".btn-ptt, .btn-ptt-mapa, .btn-grupo-speaker, .btn-walkie, .btn-walkie-redondo, .radio-cerca-mic").forEach(function (b) {
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
        document.querySelectorAll(".btn-ptt, .btn-ptt-mapa, .btn-grupo-speaker, .btn-walkie, .btn-walkie-redondo, .radio-cerca-mic").forEach(function (b) {
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
            } else if (pttModo === "grupo") {
                emitirAudioConAck("audioV2V", { mime: mime, audio: buf, texto: dicho, canal: "grupo" });
                agregarMensaje($("msgsGrupo"), $("nombre").value.trim() || "Vos", texto, true, ts);
            } else if (pttModo === "carrera") {
                const cid = window.RadioMapCarrera && RadioMapCarrera.carreraId
                    ? RadioMapCarrera.carreraId()
                    : null;
                const n = window.RadioMapCarrera && RadioMapCarrera.participantes
                    ? RadioMapCarrera.participantes().length
                    : 0;
                if (!cid || n < 2) {
                    avisarEnvioPtt(false);
                    setAvisoAudio("Nadie más en esta carrera");
                    setTimeout(function () { setAvisoAudio(""); }, 1800);
                    return;
                }
                emitirAudioConAck("audioCarrera", { carreraId: cid, mime: mime, audio: buf, texto: dicho });
            } else if (pttModo === "fantasma") {
                emitirAudioConAck("audioFantasma", {
                    mime: mime,
                    audio: buf,
                    texto: dicho,
                    nombre: nombreWalkie(),
                    id: miId
                });
            } else {
                emitirAudioConAck("audioV2V", { mime: mime, audio: buf, texto: dicho, canal: "radio" });
                agregarMensaje($("msgsV2V"), $("nombre").value.trim() || "Vos", texto, true, ts);
                if (window.RadioMapFantasma && RadioMapFantasma.activo()) {
                    socket.emit("audioFantasma", {
                        mime: mime,
                        audio: buf,
                        texto: dicho,
                        nombre: nombreWalkie(),
                        id: miId
                    });
                }
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
        try { socket.auth = { id: miId }; } catch (e) {}
        socket.emit("sesion", { id: miId });
        emitirTelemetria(true);
        if (miGrupo) {
            socket.emit("grupoUnirse", { codigo: miGrupo, nombre: miGrupoNombre });
        }
    });

    socket.on("disconnect", function () {
        setEstado(false);
    });

    socket.on("connect_error", function () {
        setEstado(false);
    });

    socket.on("shardRedirect", function (d) {
        if (!d || !d.url) return;
        const aca = window.location.origin;
        const dest = String(d.url).replace(/\/$/, "");
        if (!dest || dest === aca) return;
        if (sessionStorage.getItem("radiomap_shard_ok") === dest) return;
        sessionStorage.setItem("radiomap_shard_ok", dest);
        window.location.href = dest + (window.location.search || "");
    });

    socket.on("identidad", function (d) {
        if (!d || !d.id) return;
        adoptarId(d.id);
    });

    socket.on("telemetria_global", aplicarEstadoGlobal);

    socket.on("telemetria", function (auto) {
        if (esInvitadoFantasma()) return;
        if (!auto || !auto.id || soyYoId(auto.id)) return;
        if (esBloqueado(auto.id)) return;
        const prev = autos[auto.id];
        autos[auto.id] = prev ? Object.assign({}, prev, auto) : auto;
        actualizarMarker(autos[auto.id]);
        if (window.RadioMapCarrera && RadioMapCarrera.refrescarRivales) RadioMapCarrera.refrescarRivales();
        podarAutosLejanos();
        renderizarContactos();
        pintarResumenEnRuta();
    });

    socket.on("vehiculo_desconectado", function (id) {
        if (!id || soyYoId(id) || id === FANTASMA_ID) return;
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

    function oyeWalkiePublico(data) {
        if (!data) return false;
        if (data.canal === "grupo") return !!miGrupo && (!data.grupo || data.grupo === miGrupo);
        const lat = Number(data.lat);
        const lng = Number(data.lng);
        const pos = (Number.isFinite(lat) && Number.isFinite(lng))
            ? { lat: lat, lng: lng }
            : (data.de && autos[data.de] ? autos[data.de] : null);
        if (!miPosicion || !pos) return false;
        const d = calcularDistanciaKm(miPosicion.lat, miPosicion.lng, pos.lat, pos.lng);
        const rYo = radioKmActual();
        const rEl = Number(data.radioKm);
        const tope = Number.isFinite(rEl) && rEl > 0 ? Math.min(rYo, rEl) : rYo;
        return d <= tope;
    }

    socket.on("mensajeV2V", function (msg) {
        const payload = typeof msg === "string"
            ? { nombre: "V2V", texto: msg }
            : msg;
        if (payload.de && payload.de !== miId && esBloqueado(payload.de)) return;
        if (payload.de !== miId && payload.canal !== "grupo" && !oyeWalkiePublico(payload)) return;
        const dest = (payload.canal === "grupo") ? $("msgsGrupo") : $("msgsV2V");
        agregarMensaje(
            dest,
            payload.nombre || "Anónimo",
            payload.texto || "",
            payload.de === miId,
            payload.ts,
            payload.asistencia ? "msg-sos" : ""
        );
        if (payload.asistencia && payload.de !== miId) abrirComms();
        if (payload.de !== miId && usuarioNoEstaEnLaApp()) {
            encolarAviso({
                de: payload.de,
                nombre: payload.nombre || "Anónimo",
                texto: payload.texto || "",
                canal: payload.canal || "radio",
                ts: payload.ts || Date.now(),
                privado: false
            });
        }
    });

    socket.on("mensajePrivado", function (data) {
        const de = data.de || data.id;
        if (de && de !== miId && esBloqueado(de)) return;
        const texto = data.mensaje || data.texto || "";
        const nombre = data.nombre || "Alguien";
        const ts = data.ts || Date.now();
        historialPrivado[de] = historialPrivado[de] || [];
        historialPrivado[de].push({ nombre: nombre, texto: texto, propio: false, ts: ts });

        if (contactoActivo === de) {
            agregarMensaje($("msgsPrivado"), nombre, texto, false, ts);
        } else {
            noLeidos += 1;
            actualizarBadge();
            if (!contactoActivo) seleccionarContacto(de, true);
        }
        if (usuarioNoEstaEnLaApp()) {
            encolarAviso({
                de: de,
                nombre: nombre,
                texto: texto,
                canal: "privado",
                ts: ts,
                privado: true
            });
            return;
        }
        textoAVoz(nombre + " dice: " + texto);
    });

    socket.on("audioV2V", function (data) {
        if (data && data.de && data.de !== miId && esBloqueado(data.de)) return;
        if (data && data.de !== miId && !oyeWalkiePublico(data)) return;
        const dest = (data && data.canal === "grupo") ? $("msgsGrupo") : $("msgsV2V");
        const clipId = guardarClipAudio(data);
        agregarMensaje(
            dest,
            data.nombre || "Anónimo",
            textoDeAudio(data.texto),
            false,
            data.ts,
            "",
            clipId
        );
        if (usuarioNoEstaEnLaApp()) {
            encolarAviso({
                de: data.de,
                nombre: data.nombre || "Anónimo",
                texto: textoDeAudio(data.texto),
                canal: data.canal || "radio",
                ts: data.ts || Date.now(),
                privado: false,
                clipId: clipId
            });
            return;
        }
        reproducirAudio(data);
    });

    socket.on("audioCarrera", function (data) {
        if (data && data.de && data.de !== miId && esBloqueado(data.de)) return;
        if (!(window.RadioMapCarrera && RadioMapCarrera.activo())) return;
        reproducirAudio(data);
    });

    socket.on("audioFantasma", function (data) {
        if (!data) return;
        if (data.de && (data.de === miId || soyYoId(data.de))) return;
        reproducirAudio(data);
    });

    socket.on("audioPrivado", function (data) {
        const de = data.de;
        if (de && de !== miId && esBloqueado(de)) return;
        const texto = textoDeAudio(data.texto);
        const ts = data.ts || Date.now();
        const clipId = guardarClipAudio(data);
        historialPrivado[de] = historialPrivado[de] || [];
        historialPrivado[de].push({ nombre: data.nombre || "Alguien", texto: texto, propio: false, ts: ts, clipId: clipId });
        if (contactoActivo === de) {
            agregarMensaje($("msgsPrivado"), data.nombre || "Alguien", texto, false, ts, "", clipId);
        } else {
            noLeidos += 1;
            actualizarBadge();
            if (!contactoActivo) seleccionarContacto(de, true);
        }
        if (usuarioNoEstaEnLaApp()) {
            encolarAviso({
                de: de,
                nombre: data.nombre || "Alguien",
                texto: texto,
                canal: "privado",
                ts: ts,
                privado: true,
                clipId: clipId
            });
            return;
        }
        reproducirAudio(data);
    });

    socket.on("avisosPendientes", function (lista) {
        if (!Array.isArray(lista) || !lista.length) return;
        lista.forEach(function (item) {
            if (!item || (item.de && item.de !== miId && esBloqueado(item.de))) return;
            const evento = item.evento || "";
            const privado = !!item.privado || evento === "mensajePrivado" || evento === "audioPrivado";
            const texto = privado
                ? (item.mensaje || item.texto || textoDeAudio(item.texto))
                : (item.audio ? textoDeAudio(item.texto) : (item.texto || item.mensaje || ""));
            const clipId = item.audio ? guardarClipAudio(item) : "";
            if (privado && item.de) {
                historialPrivado[item.de] = historialPrivado[item.de] || [];
                historialPrivado[item.de].push({
                    nombre: item.nombre || "Alguien",
                    texto: texto,
                    propio: false,
                    ts: item.ts,
                    clipId: clipId
                });
                if (contactoActivo === item.de) {
                    agregarMensaje($("msgsPrivado"), item.nombre || "Alguien", texto, false, item.ts, "", clipId);
                } else {
                    noLeidos += 1;
                    if (!contactoActivo) seleccionarContacto(item.de, true);
                }
            } else {
                const dest = (item.canal === "grupo") ? $("msgsGrupo") : $("msgsV2V");
                agregarMensaje(dest, item.nombre || "Anónimo", texto, false, item.ts, "", clipId);
            }
            encolarAviso({
                de: item.de,
                nombre: item.nombre || "Alguien",
                texto: texto,
                canal: privado ? "privado" : (item.canal || "radio"),
                ts: item.ts || Date.now(),
                privado: privado,
                clipId: clipId
            });
        });
        actualizarBadge();
        avisarSiHayPendientes();
    });

    socket.on("grupoEstado", function (data) {
        const codigo = normalizarGrupo(data && data.codigo);
        const nombre = data && data.nombre;
        if (codigo === miGrupo) {
            if (nombre != null) guardarNombreGrupoLocal(nombre);
            pintarEstadoGrupo();
            actualizarDestinoUI();
            return;
        }
        aplicarGrupo(codigo, nombre);
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
        if (!el) return;
        el.classList.toggle("estado-on", !!ok);
        el.classList.toggle("estado-off", !ok);
        const txt = $("perfilSenalTxt");
        if (txt) txt.textContent = ok ? "EN LÍNEA" : "SIN SEÑAL";
    }

    function actualizarBadge() {
        const n = noLeidos > 0 ? String(noLeidos) : "0";
        ["badgePrivado", "badgeWalkie", "badgeAvisos", "badgeAvisosDock", "badgeHudAvisos"].forEach(function (id) {
            const badge = $(id);
            if (!badge) return;
            if (noLeidos > 0) {
                badge.textContent = n;
                badge.classList.remove("oculto");
            } else {
                badge.classList.add("oculto");
            }
        });
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
        preguntarRetomarRutaSiCorresponde();
        avisarSiHayPendientes();
    }

    function esFantasma(id) {
        return id === FANTASMA_ID;
    }

    function puntoOrbitando(lat, lng, distM, anguloDeg) {
        const rad = anguloDeg * Math.PI / 180;
        const dLat = (distM / 111320) * Math.cos(rad);
        const cosLat = Math.cos(lat * Math.PI / 180);
        const dLng = cosLat ? (distM / (111320 * cosLat)) * Math.sin(rad) : 0;
        return {
            lat: lat + dLat,
            lng: lng + dLng,
            rumbo: (anguloDeg + 90) % 360
        };
    }

    function mostrarMensajeFantasma() {
        const el = $("ackWalkie");
        if (el) {
            el.textContent = "Mensaje recibido";
            el.className = "ack-walkie ok";
            el.classList.remove("oculto");
            if (ackWalkieTimer) clearTimeout(ackWalkieTimer);
            ackWalkieTimer = setTimeout(function () {
                el.classList.add("oculto");
            }, 2200);
        }
        historialPrivado[FANTASMA_ID] = historialPrivado[FANTASMA_ID] || [];
        historialPrivado[FANTASMA_ID].push({
            nombre: "AutoTest",
            texto: "Mensaje recibido",
            propio: false,
            ts: Date.now()
        });
        if (autos[FANTASMA_ID]) seleccionarContacto(FANTASMA_ID, true);
    }

    function autoFantasma(p) {
        return {
            id: FANTASMA_ID,
            nombre: "AutoTest",
            vehiculo: "AUTOTEST",
            iconoX: 3,
            iconoY: 1,
            lat: p.lat,
            lng: p.lng,
            velocidad: 32,
            rumbo: p.rumbo,
            precision: 8,
            ultimaActualizacion: Date.now(),
            grupo: miGrupo || "",
            enGrupo: !!miGrupo,
            asistencia: null,
            ausente: false
        };
    }

    function tickFantasma() {
        if (!fantasmaActivo) return;
        const yo = miPosicion || (markers[miId] && markers[miId].getLatLng());
        if (!yo || !Number.isFinite(Number(yo.lat)) || !Number.isFinite(Number(yo.lng))) return;
        fantasmaAngulo = (fantasmaAngulo + 0.8) % 360;
        const p = puntoOrbitando(Number(yo.lat), Number(yo.lng), FANTASMA_RADIO_M, fantasmaAngulo);
        const auto = autoFantasma(p);
        autos[FANTASMA_ID] = auto;
        const m = markers[FANTASMA_ID];
        if (!m) actualizarMarker(auto);
        else {
            m.setLatLng([p.lat, p.lng]);
            aplicarRumbo(FANTASMA_ID, p.rumbo);
        }
    }

    function detenerFantasma() {
        fantasmaActivo = false;
        if (fantasmaTimer) {
            clearInterval(fantasmaTimer);
            fantasmaTimer = null;
        }
        if (contactoActivo === FANTASMA_ID) contactoActivo = null;
        quitarVehiculo(FANTASMA_ID);
        const btn = $("btnTestFantasma");
        if (btn) btn.classList.remove("on");
    }

    function iniciarFantasma() {
        const yo = miPosicion || (markers[miId] && markers[miId].getLatLng());
        if (!yo || !Number.isFinite(Number(yo.lat)) || !Number.isFinite(Number(yo.lng))) {
            alert("Activá la ubicación para crear el usuario de prueba.");
            iniciarGps();
            return;
        }
        fantasmaActivo = true;
        fantasmaAngulo = 0;
        cacheFichas[FANTASMA_ID] = { placa: "TST 000", seguro: "AutoTest", contacto: "" };
        tickFantasma();
        if (fantasmaTimer) clearInterval(fantasmaTimer);
        fantasmaTimer = setInterval(tickFantasma, 120);
        const btn = $("btnTestFantasma");
        if (btn) btn.classList.add("on");
        renderizarContactos();
    }

    function alternarFantasma() {
        if (fantasmaActivo) detenerFantasma();
        else iniciarFantasma();
    }

    // ===================================================
    // UI
    // ===================================================
    function bindUi() {
        if (esInvitadoFantasma()) {
            $("portada").classList.add("oculto");
            if (markers[miId]) quitarVehiculo(miId);
        } else if (yaEntroMapa()) {
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
        aplicarModoTransito();
        popupsVisibles = !!$("chkPopups").checked;
        $("chkPopups").addEventListener("change", function () {
            popupsVisibles = $("chkPopups").checked;
            aplicarVisibilidadPopups();
            setTimeout(aplicarVisibilidadPopups, 80);
        });
        function toggleFormPerfil() {
            $("formPerfil").classList.toggle("oculto");
        }
        $("btnTogglePerfil").addEventListener("click", toggleFormPerfil);
        if ($("btnTogglePerfilCola")) {
            $("btnTogglePerfilCola").addEventListener("click", toggleFormPerfil);
        }
        $("btnElegirIcono").addEventListener("click", function (ev) {
            ev.stopPropagation();
            abrirModalIcono();
        });
        if ($("btnAvatarPerfil")) {
            $("btnAvatarPerfil").addEventListener("click", function (ev) {
                ev.stopPropagation();
                abrirModalIcono();
            });
        }
        $("btnCerrarIcono").addEventListener("click", cerrarModalIcono);
        $("fondoModalIcono").addEventListener("click", cerrarModalIcono);
        document.addEventListener("keydown", function (e) {
            if (e.key !== "Escape") return;
            if (window.RadioMapCarrera && RadioMapCarrera.teclaEscape()) return;
            if (cartelLlegasteVisible()) {
                ocultarCartelLlegaste();
                return;
            }
            if (modalEncuentroVisible()) {
                cerrarModalEncuentro();
                return;
            }
            if (modalRetomarVisible()) {
                descartarRutaGuardada();
                return;
            }
            if (modalAvisosVisible()) {
                marcarAvisoConsumido();
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
        if ($("btnCentrar")) {
            $("btnCentrar").addEventListener("click", function (ev) {
                ev.stopPropagation();
                vistaRadio = false;
                seguirMe = true;
                if (miPosicion) setVistaSeguir([miPosicion.lat, miPosicion.lng], modoNavGps ? map.getZoom() : 16);
                else iniciarGps();
            });
        }
        if ($("btnZoomIn")) $("btnZoomIn").addEventListener("click", function () { map.zoomIn(); });
        if ($("btnZoomOut")) $("btnZoomOut").addEventListener("click", function () { map.zoomOut(); });
        $("btnToggleComms").addEventListener("click", function () {
            if (commsAbierto()) {
                cerrarComms();
                return;
            }
            mostrarVistaComms("avisos");
            abrirComms();
        });
        $("btnCerrarComms").addEventListener("click", function () {
            cerrarComms();
        });
        if ($("btnDockMapa")) {
            $("btnDockMapa").addEventListener("click", function () {
                cerrarComms();
            });
        }
        if ($("btnDockGrupos")) {
            $("btnDockGrupos").addEventListener("click", function () {
                mostrarVistaComms("grupos");
                abrirComms();
            });
        }
        if ($("btnDockAvisos")) {
            $("btnDockAvisos").addEventListener("click", function () {
                mostrarVistaComms("avisos");
                abrirComms();
            });
        }
        if ($("btnDockAyuda")) {
            $("btnDockAyuda").addEventListener("click", function () {
                alternarAsistencia();
            });
        }
        if ($("btnMapaDock")) {
            $("btnMapaDock").addEventListener("click", function () {
                cerrarMenuMasDock();
                cerrarComms();
            });
        }
        if ($("btnRadioDock")) {
            $("btnRadioDock").addEventListener("click", function () {
                cerrarMenuMasDock();
                if (commsAbierto()) {
                    cerrarComms();
                    return;
                }
                mostrarVistaComms("avisos");
                abrirComms();
            });
        }
        if ($("btnAyudaDock")) {
            $("btnAyudaDock").addEventListener("click", function () {
                cerrarMenuMasDock();
                alternarAsistencia();
            });
        }
        if ($("btnMasDock")) {
            $("btnMasDock").addEventListener("click", function (ev) {
                ev.stopPropagation();
                alternarMenuMasDock();
            });
        }
        if ($("btnCarreraDock")) {
            $("btnCarreraDock").addEventListener("click", function () {
                cerrarMenuMasDock();
            });
        }
        if ($("btnFantasmaDock")) {
            $("btnFantasmaDock").addEventListener("click", function () {
                cerrarMenuMasDock();
            });
        }
        document.addEventListener("click", function (ev) {
            const mas = document.querySelector(".dock-mas");
            if (!mas || !menuMasDockAbierto()) return;
            if (mas.contains(ev.target)) return;
            cerrarMenuMasDock();
        });
        if ($("btnHudComms")) {
            $("btnHudComms").addEventListener("click", function () {
                if (commsAbierto()) {
                    cerrarComms();
                    return;
                }
                mostrarVistaComms("avisos");
                abrirComms();
            });
        }
        if ($("btnMostrarCrearGrupo")) {
            $("btnMostrarCrearGrupo").addEventListener("click", function () {
                irACrearGrupo();
            });
        }
        if ($("btnIrAGrupos")) {
            $("btnIrAGrupos").addEventListener("click", function () {
                irACrearGrupo();
            });
        }
        if ($("btnNuevaPrivada")) {
            $("btnNuevaPrivada").addEventListener("click", function () {
                mostrarTab("privado");
                abrirComms();
            });
        }
        $("btnActivarGps").addEventListener("click", iniciarGps);
        $("radioFiltro").addEventListener("change", function () {
            localStorage.setItem("radiomap_radio", String(radioKmActual()));
            Object.keys(autos).forEach(function (id) {
                actualizarMarker(autos[id]);
            });
            renderizarContactos();
            actualizarCirculoRadio(true);
            emitirTelemetria(true);
        });
        if ($("btnEnRuta")) $("btnEnRuta").addEventListener("click", alternarEnRuta);
        pintarBotonEnRuta();
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
        if ($("btnNavGps")) $("btnNavGps").addEventListener("click", alternarModoNavGps);
        if ($("btnModoTransito")) {
            $("btnModoTransito").addEventListener("click", function (ev) {
                ev.stopPropagation();
                alternarModoTransito();
            });
        }
        if ($("btnTestFantasma")) $("btnTestFantasma").addEventListener("click", alternarFantasma);
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
        if ($("btnEnviarGrupo")) $("btnEnviarGrupo").addEventListener("click", enviarGrupo);
        if ($("txtAvisoGrupo")) {
            $("txtAvisoGrupo").addEventListener("keydown", function (e) {
                if (e.key === "Enter") enviarGrupo();
            });
        }
        if ($("txtGrupoNombre")) {
            $("txtGrupoNombre").addEventListener("keydown", function (e) {
                if (e.key === "Enter") crearGrupo();
            });
        }
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
        if ($("btnVozGrupo")) {
            $("btnVozGrupo").addEventListener("click", function () {
                if (!miGrupo) {
                    alert("Creá o unite a un grupo primero.");
                    return;
                }
                vozATexto(function (texto) {
                    if (!texto) return;
                    $("txtAvisoGrupo").value = texto;
                    enviarGrupo();
                });
            });
        }
        document.querySelectorAll(".tab").forEach(function (btn) {
            btn.addEventListener("click", function () {
                mostrarTab(btn.getAttribute("data-tab"));
            });
        });
        bindPtt($("btnPttMapa"), modoPttTab);
        bindPtt($("btnPttDock"), modoPttTab);
        bindPtt($("btnHablarRadio"), "general");
        bindPtt($("btnHablarGrupo"), "grupo");
        bindPtt($("btnCarreraPtt"), "carrera");
        if (esInvitadoFantasma()) pintarLeyendaPttFantasma();
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
        preguntarRetomarRutaSiCorresponde();
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
            $("formEncuentro").querySelectorAll('input[name="encAlcance"]').forEach(function (el) {
                el.addEventListener("change", actualizarCajaPrivadoEncuentro);
            });
        }
        if ($("btnCancelarRuta")) $("btnCancelarRuta").addEventListener("click", cancelarNavegacion);
        if ($("cartelLlegaste")) $("cartelLlegaste").addEventListener("click", ocultarCartelLlegaste);
        if ($("btnRetomarRuta")) $("btnRetomarRuta").addEventListener("click", retomarRutaGuardada);
        if ($("btnDescartarRuta")) $("btnDescartarRuta").addEventListener("click", descartarRutaGuardada);
        if ($("btnOirAvisosPendientes")) $("btnOirAvisosPendientes").addEventListener("click", reproducirColaAudios);
        if ($("btnVerAvisosPrivado")) $("btnVerAvisosPrivado").addEventListener("click", abrirAvisosEnPrivado);
        if ($("btnCerrarAvisosPendientes")) $("btnCerrarAvisosPendientes").addEventListener("click", marcarAvisoConsumido);
        if ($("fondoModalAvisosPendientes")) $("fondoModalAvisosPendientes").addEventListener("click", marcarAvisoConsumido);
        document.addEventListener("click", function (ev) {
            const btn = ev.target && ev.target.closest && ev.target.closest(".btn-play-msg");
            if (!btn) return;
            const clipId = btn.getAttribute("data-clip");
            if (clipId) reproducirClip(clipId);
        });
        if (yaEntroMapa() && !esInvitadoFantasma()) pedirWakeLock();
        if (miGrupo && !esInvitadoFantasma()) {
            emitirTelemetria(true);
            if (socket.connected) {
                socket.emit("grupoUnirse", { codigo: miGrupo, nombre: miGrupoNombre });
            }
        }
        if (!esInvitadoFantasma() && !commsEsOverlay()) {
            mostrarVistaComms("avisos");
            abrirComms();
        }
        if (window.RadioMapCarrera) {
            window.RadioMapCarrera.init({
                map: map,
                miId: miId,
                markers: markers,
                $: $,
                crearIcono: crearIcono,
                iconoDeAuto: iconoDeAuto,
                aplicarRumbo: aplicarRumbo,
                rumboEntre: rumboEntre,
                setMapaBearing: setMapaBearing,
                detenerPtt: detenerPtt,
                calcularDistanciaKm: calcularDistanciaKm,
                iniciarGps: iniciarGps,
                emitirTelemetria: emitirTelemetria,
                guardarIconoLocal: guardarIconoLocal,
                iconoGrilla: function () {
                    return { cols: iconoCfg.cols || 15, rows: iconoCfg.rows || 8 };
                },
                actualizarPerfilLocal: function () {
                    actualizarResumenPerfil();
                    aplicarIconoEnMarker(miId, leerIconoLocal());
                    emitirTelemetria(true);
                },
                rutaPorCalle: function (a, b) {
                    return rutaPorCalle(a, b, false).then(function (res) {
                        if (Array.isArray(res)) return res;
                        if (res && res.path) return res.path;
                        return null;
                    });
                },
                socket: socket,
                conectados: function () {
                    return Object.keys(autos).filter(function (id) {
                        return id && id !== miId && id !== FANTASMA_ID && autos[id] && autos[id].ausente !== true;
                    }).map(function (id) {
                        const a = autos[id];
                        return {
                            id: id,
                            nombre: a.nombre || "Invitado",
                            vehiculo: a.vehiculo || "",
                            iconoX: a.iconoX,
                            iconoY: a.iconoY
                        };
                    });
                },
                cerrarComms: cerrarComms,
                cerrarModales: function () {
                    cerrarModalMapaClick();
                    cerrarModalEncuentro();
                    if (typeof cerrarModalBuscar === "function") cerrarModalBuscar();
                    cerrarComms();
                    if (typeof cancelarNavegacion === "function") cancelarNavegacion();
                },
                alSalir: function () {
                    seguirMe = true;
                    Object.keys(autos).forEach(function (id) {
                        if (autos[id]) actualizarMarker(autos[id]);
                    });
                    if (miPosicion) {
                        posGpsObjetivo = {
                            lat: miPosicion.lat,
                            lng: miPosicion.lng,
                            rumbo: miPosicion.rumbo,
                            vel: miPosicion.velocidad || 0
                        };
                        if (markers[miId]) {
                            markers[miId].setLatLng([miPosicion.lat, miPosicion.lng]);
                            markers[miId].setZIndexOffset(1000);
                        }
                        setVistaSeguir([miPosicion.lat, miPosicion.lng], 16);
                        asegurarTickGps();
                    }
                    map.invalidateSize();
                }
            });
        }
        if (window.RadioMapFantasma) {
            window.RadioMapFantasma.init({
                map: map,
                socket: socket,
                $: $,
                markers: markers,
                posicion: function () { return miPosicion; },
                navegacion: function () {
                    if (!navegacion) return null;
                    return {
                        path: navegacion.path || [],
                        dest: navegacion.dest || null
                    };
                },
                navGps: function () { return !!modoNavGps; },
                nombre: function () {
                    const el = $("nombre");
                    const n = el && el.value ? el.value.trim() : "";
                    return n || "Alguien";
                },
                vehiculo: function () {
                    const el = $("vehiculo");
                    return el && el.value ? el.value.trim() : "";
                },
                icono: function () {
                    return leerIconoLocal();
                },
                crearIcono: crearIcono,
                metrosEntre: function (a, b) {
                    return metrosEntre(a, b);
                }
            });
        }
    }

    function irACrearGrupo() {
        const caja = $("cajaGrupo");
        if (caja) caja.classList.remove("oculto");
        mostrarTab("grupo");
        abrirComms();
        const foco = miGrupo ? $("txtGrupo") : $("txtGrupoNombre");
        if (foco) foco.focus();
    }

    function mostrarTab(nombre) {
        if (nombre === "grupo") {
            if ($("tabGrupo")) $("tabGrupo").classList.remove("oculto");
        }
        tabActiva = nombre === "grupo" ? "grupo" : (nombre === "privado" ? "privado" : "general");
        document.querySelectorAll(".tab").forEach(function (t) {
            t.classList.toggle("activa", t.getAttribute("data-tab") === tabActiva);
        });
        if ($("vistaPublico")) $("vistaPublico").classList.toggle("oculto", tabActiva !== "general");
        if ($("vistaPrivado")) $("vistaPrivado").classList.toggle("oculto", tabActiva !== "privado");
        if ($("vistaGrupo")) $("vistaGrupo").classList.toggle("oculto", tabActiva !== "grupo");
        if ($("panelGeneral")) $("panelGeneral").classList.toggle("oculto", tabActiva !== "general");
        if ($("panelPrivado")) $("panelPrivado").classList.toggle("oculto", tabActiva !== "privado");
        if ($("panelGrupo")) $("panelGrupo").classList.toggle("oculto", tabActiva !== "grupo");
        const panel = $("commsPanel");
        if (panel) {
            panel.setAttribute("data-tab", tabActiva);
            panel.setAttribute("data-vista", tabActiva === "grupo" ? "grupos" : (tabActiva === "privado" ? "privado" : "avisos"));
        }
        if (tabActiva === "privado") {
            noLeidos = 0;
            actualizarBadge();
        }
        if (tabActiva !== "grupo" && !miGrupo && $("tabGrupo")) {
            $("tabGrupo").classList.add("oculto");
        }
        pintarDock();
    }

    function mostrarVistaComms(vista) {
        if (vista === "privado") mostrarTab("privado");
        else if (vista === "grupos") {
            if (miGrupo) mostrarTab("grupo");
            else irACrearGrupo();
        } else {
            mostrarTab("general");
        }
        pintarDock();
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
        if (esInvitadoFantasma()) return;
        $("commsPanel").classList.add("open");
        document.body.classList.add("comms-open");
        pintarDock();
        asegurarTrampaAtras();
    }

    function cerrarComms() {
        $("commsPanel").classList.remove("open");
        document.body.classList.remove("comms-open");
        pintarDock();
    }

    function menuMasDockAbierto() {
        const menu = $("menuMasDock");
        return !!(menu && !menu.classList.contains("oculto"));
    }

    function cerrarMenuMasDock() {
        const menu = $("menuMasDock");
        const btn = $("btnMasDock");
        if (menu) menu.classList.add("oculto");
        if (btn) {
            btn.classList.remove("on");
            btn.setAttribute("aria-expanded", "false");
        }
    }

    function alternarMenuMasDock() {
        const menu = $("menuMasDock");
        const btn = $("btnMasDock");
        if (!menu || !btn) return;
        const abrir = menu.classList.contains("oculto");
        menu.classList.toggle("oculto", !abrir);
        btn.classList.toggle("on", abrir);
        btn.setAttribute("aria-expanded", abrir ? "true" : "false");
    }

    function pintarDock() {
        const radio = $("btnToggleComms");
        const mapa = $("btnDockMapa");
        const grupos = $("btnDockGrupos");
        const avisos = $("btnDockAvisos");
        const mapaDock = $("btnMapaDock");
        const radioDock = $("btnRadioDock");
        const abierto = !commsEsOverlay() || commsAbierto();
        const vista = tabActiva || "general";
        if (radio) radio.classList.toggle("on", commsAbierto());
        if (mapa) mapa.classList.toggle("on", !commsAbierto());
        if (grupos) grupos.classList.toggle("on", abierto && vista === "grupo");
        if (avisos) avisos.classList.toggle("on", abierto && vista !== "grupo");
        if (mapaDock) mapaDock.classList.toggle("on", !commsAbierto());
        if (radioDock) radioDock.classList.toggle("on", commsAbierto());
        if (commsAbierto()) cerrarMenuMasDock();
        pintarCanalPtt();
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
        if (window.RadioMapCarrera && RadioMapCarrera.activo() && RadioMapCarrera.teclaEscape()) {
            return true;
        }
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
        if (modalRetomarVisible()) {
            descartarRutaGuardada();
            return true;
        }
        if (modalAvisosVisible()) {
            marcarAvisoConsumido();
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
        persistirRuta();
        persistirFlagsSesion();
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
        if (document.visibilityState === "visible") {
            pedirWakeLock();
            ctxPtt();
            if (!socket.connected) socket.connect();
            else {
                socket.emit("sesion", { id: miId });
                emitirTelemetria(true);
            }
            avisarSiHayPendientes();
        } else {
            persistirRuta();
            persistirFlagsSesion();
        }
    });

    window.addEventListener("pageshow", function () {
        if (!socket.connected) socket.connect();
        avisarSiHayPendientes();
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
