// ===================================================
// V2V - SERVIDOR DE COMUNICACIÓN VEHICULAR
// Archivo: server.js
// ===================================================

"use strict";

const express = require("express");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");
const crypto = require("crypto");
const escala = require("./lib/escala");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingInterval: 10000,
    pingTimeout: 20000,
    cors: { origin: true },
    maxHttpBufferSize: 5e5,
    perMessageDeflate: false
});

app.use(express.json());
app.use(express.static("public", {
    etag: true,
    setHeaders: function (res, filePath) {
        if (/\.html$/i.test(filePath)) {
            res.setHeader("Cache-Control", "no-cache");
            return;
        }
        if (/\.(js|css|png|jpe?g|webp|svg|json|woff2?)$/i.test(filePath)) {
            res.setHeader("Cache-Control", "public, max-age=86400");
        }
    }
}));

const RADIO_MIN = 1;
const RADIO_MAX = 10;
const RADIO_DEF = 3;
const ENC_KM = 200;
const CELDA_KM = 4;
const LAT_CELDA = CELDA_KM / 111.32;
const SNAPSHOT_MAX = 48;

function parLngLat(valor) {
    const m = String(valor || "").trim().match(/^(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)$/);
    return m ? (m[1] + "," + m[3]) : null;
}

function perfilOsrm(raw) {
    const p = String(raw || "driving").toLowerCase();
    if (p === "foot" || p === "walking" || p === "pie") return "walking";
    return "driving";
}

function urlOsrm(perfil, servicio, coords, query) {
    // El demo de project-osrm sirve walking con el grafo de auto (respeta manos).
    // A pie usamos la instancia peatonal de OSM, que ignora sentido y busca el camino más corto.
    if (perfil === "walking") {
        return "https://routing.openstreetmap.de/routed-foot/" + servicio + "/v1/driving/" + coords + query;
    }
    return "https://router.project-osrm.org/" + servicio + "/v1/driving/" + coords + query;
}

function proxyOsrm(res, url) {
    const reqUp = https.get(url, {
        headers: { "User-Agent": "RadioMap/1.0" },
        timeout: 10000
    }, up => {
        res.status(up.statusCode || 200);
        res.setHeader("Content-Type", "application/json");
        up.pipe(res);
    });
    reqUp.on("timeout", () => reqUp.destroy());
    reqUp.on("error", () => {
        if (!res.headersSent) res.status(502).json({ code: "Error" });
    });
}

app.get("/api/osrm/nearest", (req, res) => {
    const par = parLngLat(req.query.lnglat);
    if (!par) return res.status(400).json({ code: "Error" });
    const perfil = perfilOsrm(req.query.perfil);
    proxyOsrm(res, urlOsrm(perfil, "nearest", par, "?number=1"));
});

app.get("/api/osrm/ruta", (req, res) => {
    const from = parLngLat(req.query.from);
    const to = parLngLat(req.query.to);
    if (!from || !to) return res.status(400).json({ code: "Error" });
    const nav = req.query.nav === "1";
    const perfil = perfilOsrm(req.query.perfil);
    const extra = nav
        ? "&alternatives=true&steps=true"
        : "&continue_straight=true";
    proxyOsrm(res, urlOsrm(perfil, "route", from + ";" + to, "?overview=full&geometries=geojson" + extra));
});

let ultimoGeoTs = 0;

app.get("/api/geo/buscar", (req, res) => {
    const q = String(req.query.q || "").trim().slice(0, 80);
    if (q.length < 3) return res.status(400).json({ ok: false });
    const ahora = Date.now();
    if (ahora - ultimoGeoTs < 1100) {
        return res.status(429).json({ ok: false, error: "Esperá un segundo." });
    }
    ultimoGeoTs = ahora;

    const params = new URLSearchParams({
        q: q,
        format: "jsonv2",
        limit: "20",
        addressdetails: "0",
        countrycodes: "ar",
        "accept-language": "es",
        dedupe: "1"
    });
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
        params.set(
            "viewbox",
            (lng - 0.4) + "," + (lat + 0.3) + "," + (lng + 0.4) + "," + (lat - 0.3)
        );
        params.set("bounded", "0");
    }

    const reqUp = https.get("https://nominatim.openstreetmap.org/search?" + params.toString(), {
        headers: {
            "User-Agent": "RadioMap/1.0",
            Accept: "application/json"
        },
        timeout: 8000
    }, up => {
        let buf = "";
        up.on("data", c => {
            buf += c;
            if (buf.length > 250000) reqUp.destroy();
        });
        up.on("end", () => {
            let lista = [];
            try { lista = JSON.parse(buf); } catch (e) { lista = []; }
            if (!Array.isArray(lista)) lista = [];
            const yo = Number.isFinite(lat) && Number.isFinite(lng)
                ? { lat: lat, lng: lng }
                : null;
            const resultados = lista.map(x => {
                const item = {
                    nombre: String(x.display_name || "").slice(0, 160),
                    lat: Number(x.lat),
                    lng: Number(x.lon)
                };
                if (!item.nombre || !Number.isFinite(item.lat) || !Number.isFinite(item.lng)) return null;
                item.km = yo ? kmEntre(yo, item) : null;
                return item;
            }).filter(Boolean);
            if (yo) {
                resultados.sort((a, b) => (a.km == null ? 1 : a.km) - (b.km == null ? 1 : b.km));
            }
            res.json({
                ok: true,
                resultados: resultados.slice(0, 8)
            });
        });
    });
    reqUp.on("timeout", () => reqUp.destroy());
    reqUp.on("error", () => {
        if (!res.headersSent) res.status(502).json({ ok: false });
    });
});

app.get("/api/geo/calle", (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ ok: false });
    }
    const ahora = Date.now();
    if (ahora - ultimoGeoTs < 1100) {
        return res.status(429).json({ ok: false });
    }
    ultimoGeoTs = ahora;

    const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lng),
        format: "jsonv2",
        addressdetails: "1",
        zoom: "18",
        "accept-language": "es"
    });
    const reqUp = https.get("https://nominatim.openstreetmap.org/reverse?" + params.toString(), {
        headers: {
            "User-Agent": "RadioMap/1.0",
            Accept: "application/json"
        },
        timeout: 8000
    }, up => {
        let buf = "";
        up.on("data", c => {
            buf += c;
            if (buf.length > 80000) reqUp.destroy();
        });
        up.on("end", () => {
            let j = null;
            try { j = JSON.parse(buf); } catch (e) { j = null; }
            const a = j && j.address ? j.address : {};
            const calle = String(a.road || a.pedestrian || a.residential || a.footway || "").trim();
            const nro = String(a.house_number || "").trim();
            const barrio = String(a.suburb || a.neighbourhood || a.city_district || a.town || a.village || a.city || "").trim();
            const linea = calle ? (nro ? calle + " " + nro : calle) : "";
            const texto = (barrio && linea ? linea + ", " + barrio : (linea || barrio)).slice(0, 100);
            res.json({ ok: true, texto: texto });
        });
    });
    reqUp.on("timeout", () => reqUp.destroy());
    reqUp.on("error", () => {
        if (!res.headersSent) res.status(502).json({ ok: false });
    });
});

const dbSql = require("./lib/sql");
const ultimoSqlUsuario = {};
let puertoActivo = Number(process.env.PORT || 3000) || 3000;

const AUSENTE_MS = 18000;
const BORRAR_MS = 90000;
const INBOX_MAX = 8;
const INBOX_AUDIO_MAX = 3;
const INBOX_TTL_MS = 12 * 60 * 1000;
const ENC_FILE = path.join(__dirname, "data", "encuentros.json");
const GRUPOS_FILE = path.join(__dirname, "data", "grupos.json");

// vehiculoId persistente -> datos
const vehiculos = {};
// socket.id -> vehiculoId
const socketAVehiculo = {};
const ultimoAudioTs = {};
const ultimoMsgTs = {};
const encuentros = {};
const desafiosCarrera = {};
const carreras1v1 = {};
const invitesCarreraLink = {};
const inviteCarreraPorHost = {};
const ultimoCarreraTs = {};
const fantasmas = {};
const fantasmaPorHost = {};
const ultimoFantasmaVistaTs = {};
const FANTASMA_TTL_MS = 8 * 60 * 60 * 1000;
const CARRERA_LINK_TTL_MS = 30 * 60 * 1000;

function listaEncuentrosDisco() {
    return Object.keys(encuentros).map(id => {
        const e = encuentros[id];
        if (!e) return null;
        return {
            id: e.id,
            lat: e.lat,
            lng: e.lng,
            nombre: e.nombre || "",
            horario: e.horario || "",
            descripcion: e.descripcion || "",
            de: e.de || "",
            grupo: e.grupo || "",
            alcance: e.alcance || "",
            para: e.para || "",
            ts: e.ts || Date.now()
        };
    }).filter(Boolean);
}

function cargarEncuentrosDisco() {
    try {
        const raw = fs.readFileSync(ENC_FILE, "utf8");
        const lista = JSON.parse(raw);
        const arr = Array.isArray(lista) ? lista : [];
        arr.forEach(e => {
            if (!e || !e.id || !Number.isFinite(Number(e.lat)) || !Number.isFinite(Number(e.lng))) return;
            encuentros[e.id] = {
                id: String(e.id).slice(0, 40),
                lat: Number(e.lat),
                lng: Number(e.lng),
                nombre: sanitizarTexto(e.nombre, 40) || "Encuentro",
                horario: sanitizarTexto(e.horario, 40),
                descripcion: sanitizarTexto(e.descripcion, 200),
                de: sanitizarTexto(e.de, 64),
                grupo: sanitizarTexto(e.grupo, 8),
                alcance: sanitizarAlcance(e.alcance, true),
                para: sanitizarTexto(e.para, 64),
                ts: Number(e.ts) || Date.now()
            };
        });
    } catch (err) {
        if (err && err.code !== "ENOENT") console.error("No se pudieron leer los encuentros:", err.message);
    }
}

let guardarEncTimer = null;
function guardarEncuentrosDisco() {
    if (dbSql.activo()) return;
    if (guardarEncTimer) clearTimeout(guardarEncTimer);
    guardarEncTimer = setTimeout(() => {
        try {
            fs.mkdirSync(path.dirname(ENC_FILE), { recursive: true });
            fs.writeFileSync(ENC_FILE, JSON.stringify(listaEncuentrosDisco(), null, 2), "utf8");
        } catch (err) {
            console.error("No se pudieron guardar los encuentros:", err.message);
        }
    }, 120);
}

cargarEncuentrosDisco();

const gruposReg = {};
const grupoVivos = {};
const celdas = {};

function sanitizarNombreGrupo(valor) {
    return String(valor || "").trim().replace(/\s+/g, " ").slice(0, 32);
}

function nombreDeGrupo(codigo) {
    return (gruposReg[codigo] && gruposReg[codigo].nombre) || "";
}

function sqlCatch(promesa) {
    Promise.resolve(promesa).catch(function (err) {
        console.error("SQL Server:", err && err.message ? err.message : err);
    });
}

function persistirUsuarioSql(v, forzar) {
    if (!v || !v.id || !dbSql.activo()) return;
    const ahora = Date.now();
    if (!forzar && ultimoSqlUsuario[v.id] && ahora - ultimoSqlUsuario[v.id] < 90000) return;
    ultimoSqlUsuario[v.id] = ahora;
    sqlCatch(dbSql.upsertUsuario(v));
}

function persistirGrupoSql(codigo, nombre) {
    if (!codigo || !dbSql.activo()) return;
    sqlCatch(dbSql.upsertGrupo(codigo, nombre || nombreDeGrupo(codigo)));
}

function persistirMiembroSql(codigo, vehiculo) {
    if (!codigo || !vehiculo || !dbSql.activo()) return;
    sqlCatch(dbSql.upsertMiembro(codigo, Object.assign({}, vehiculo, {
        grupoNombre: nombreDeGrupo(codigo)
    })));
}

function persistirEncuentroSql(e) {
    if (!e || !dbSql.activo()) return;
    sqlCatch(dbSql.upsertEncuentro(e));
}

function borrarEncuentroSql(id) {
    if (!id || !dbSql.activo()) return;
    sqlCatch(dbSql.borrarEncuentro(id));
}

function asegurarGrupo(codigo, nombre) {
    if (!codigo) return;
    if (!gruposReg[codigo]) {
        gruposReg[codigo] = { nombre: nombre || ("Grupo " + codigo), miembros: {} };
    } else if (nombre) {
        gruposReg[codigo].nombre = nombre;
    }
    persistirGrupoSql(codigo, gruposReg[codigo].nombre);
}

function persistirGrupos() {
    const out = {};
    Object.keys(gruposReg).forEach(function (codigo) {
        const g = gruposReg[codigo];
        if (!g) return;
        const miembros = {};
        const src = g.miembros || {};
        const ids = Object.keys(src);
        ids.sort(function (a, b) {
            return (src[b].ts || 0) - (src[a].ts || 0);
        });
        ids.slice(0, 80).forEach(function (id) {
            const m = src[id];
            if (!m) return;
            miembros[id] = { nombre: sanitizarTexto(m.nombre, 40), ts: Number(m.ts) || 0 };
        });
        out[codigo] = { nombre: g.nombre || "", miembros: miembros };
    });
    return out;
}

function cargarNombresGrupo() {
    try {
        const raw = fs.readFileSync(GRUPOS_FILE, "utf8");
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object") return;
        Object.keys(obj).forEach(function (codigo) {
            const c = String(codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (c.length < 4 || c.length > 8) return;
            const val = obj[codigo];
            if (typeof val === "string") {
                gruposReg[c] = { nombre: sanitizarNombreGrupo(val), miembros: {} };
                return;
            }
            if (!val || typeof val !== "object") return;
            const miembros = {};
            const src = val.miembros && typeof val.miembros === "object" ? val.miembros : {};
            Object.keys(src).forEach(function (id) {
                const m = src[id] || {};
                miembros[String(id)] = {
                    nombre: sanitizarTexto(m.nombre, 40),
                    ts: Number(m.ts) || 0
                };
            });
            gruposReg[c] = { nombre: sanitizarNombreGrupo(val.nombre), miembros: miembros };
        });
    } catch (err) {
        if (err && err.code !== "ENOENT") console.error("No se pudieron leer los grupos:", err.message);
    }
}

let guardarGruposTimer = null;
function guardarNombresGrupo() {
    if (dbSql.activo()) return;
    if (guardarGruposTimer) clearTimeout(guardarGruposTimer);
    guardarGruposTimer = setTimeout(function () {
        try {
            fs.mkdirSync(path.dirname(GRUPOS_FILE), { recursive: true });
            fs.writeFileSync(GRUPOS_FILE, JSON.stringify(persistirGrupos(), null, 2), "utf8");
        } catch (err) {
            console.error("No se pudieron guardar los grupos:", err.message);
        }
    }, 250);
}

function registrarMiembroGrupo(codigo, vehiculo) {
    if (!codigo || !vehiculo) return;
    asegurarGrupo(codigo, "");
    gruposReg[codigo].miembros[vehiculo.id] = {
        nombre: sanitizarTexto(vehiculo.nombre, 40),
        ts: Date.now()
    };
    guardarNombresGrupo();
    persistirMiembroSql(codigo, vehiculo);
}

function quitarMiembroGrupo(codigo, id) {
    if (!codigo || !id || !gruposReg[codigo] || !gruposReg[codigo].miembros) return;
    delete gruposReg[codigo].miembros[id];
    guardarNombresGrupo();
    if (dbSql.activo()) sqlCatch(dbSql.borrarMiembro(codigo, id));
}

cargarNombresGrupo();

function sanitizarTexto(valor, max) {
    return String(valor || "").trim().slice(0, max);
}

function sanitizarAlcance(valor, permitirVacio) {
    const a = String(valor || "").trim().toLowerCase();
    if (a === "global" || a === "privado" || a === "grupo") return a;
    return permitirVacio ? "" : "global";
}

function sanitizarEntero(valor, min, max, def) {
    const n = parseInt(valor, 10);
    if (!Number.isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
}

function kmEntre(a, b) {
    if (!a || !b) return Infinity;
    const lat1 = Number(a.lat);
    const lon1 = Number(a.lng);
    const lat2 = Number(b.lat);
    const lon2 = Number(b.lng);
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const x =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    return R * c;
}

function radioDe(v) {
    return sanitizarEntero(v && v.radioKm, RADIO_MIN, RADIO_MAX, RADIO_DEF);
}

function lngCelda(lat) {
    const c = Math.cos((Number(lat) || 0) * Math.PI / 180);
    return CELDA_KM / (111.32 * Math.max(0.25, Math.abs(c)));
}

function claveCelda(lat, lng) {
    const i = Math.floor(Number(lat) / LAT_CELDA);
    const j = Math.floor(Number(lng) / lngCelda(lat));
    return i + ":" + j;
}

function sacarDeCelda(v) {
    if (!v || !v.celda || !celdas[v.celda]) return;
    delete celdas[v.celda][v.id];
    if (!Object.keys(celdas[v.celda]).length) delete celdas[v.celda];
    v.celda = "";
}

function ponerEnCelda(v) {
    if (!v || !Number.isFinite(Number(v.lat)) || !Number.isFinite(Number(v.lng))) return;
    const k = claveCelda(v.lat, v.lng);
    if (v.celda === k) {
        if (!celdas[k]) celdas[k] = {};
        celdas[k][v.id] = true;
        return;
    }
    sacarDeCelda(v);
    v.celda = k;
    if (!celdas[k]) celdas[k] = {};
    celdas[k][v.id] = true;
}

function idsCeldasVecinas(lat, lng) {
    const i0 = Math.floor(Number(lat) / LAT_CELDA);
    const step = lngCelda(lat);
    const j0 = Math.floor(Number(lng) / step);
    const keys = [];
    let di;
    let dj;
    for (di = -1; di <= 1; di++) {
        for (dj = -1; dj <= 1; dj++) keys.push((i0 + di) + ":" + (j0 + dj));
    }
    return keys;
}

function candidatosCerca(v) {
    if (!v || !Number.isFinite(Number(v.lat))) return [];
    const ids = {};
    idsCeldasVecinas(v.lat, v.lng).forEach(function (k) {
        const bucket = celdas[k];
        if (!bucket) return;
        Object.keys(bucket).forEach(function (id) { ids[id] = true; });
    });
    return Object.keys(ids);
}

function ponerEnGrupoVivo(v) {
    if (!v || !v.id) return;
    if (v.grupo) {
        if (!grupoVivos[v.grupo]) grupoVivos[v.grupo] = {};
        grupoVivos[v.grupo][v.id] = true;
    }
}

function sacarDeGrupoVivo(id, codigo) {
    if (!id || !codigo || !grupoVivos[codigo]) return;
    delete grupoVivos[codigo][id];
    if (!Object.keys(grupoVivos[codigo]).length) delete grupoVivos[codigo];
}

function mismoGrupo(a, b) {
    return !!(a && b && a.grupo && b.grupo && a.grupo === b.grupo);
}

function puedeVer(oyente, objetivo) {
    if (!oyente || !objetivo || oyente.id === objetivo.id) return false;
    if (mismoGrupo(oyente, objetivo)) return true;
    const d = kmEntre(oyente, objetivo);
    return d <= radioDe(oyente);
}

function puedeHablarRadio(emisor, dest) {
    if (!emisor || !dest || emisor.id === dest.id) return false;
    const d = kmEntre(emisor, dest);
    return d <= radioDe(emisor) && d <= radioDe(dest);
}

function publicoDe(v, lite) {
    if (!v) return null;
    const o = {
        id: v.id,
        lat: v.lat,
        lng: v.lng,
        rumbo: v.rumbo,
        velocidad: v.velocidad,
        radioKm: v.radioKm,
        grupo: v.grupo || "",
        iconoX: v.iconoX,
        iconoY: v.iconoY,
        ultimaActualizacion: v.ultimaActualizacion,
        ausente: !!v.ausente,
        enRuta: v.enRuta !== false,
        asistencia: v.asistencia || null
    };
    if (!lite) {
        o.nombre = v.nombre;
        o.vehiculo = v.vehiculo;
    }
    return o;
}

function publicoEncuentro(e) {
    if (!e) return null;
    const dest = e.para ? vehiculos[e.para] : null;
    return {
        id: e.id,
        lat: e.lat,
        lng: e.lng,
        nombre: e.nombre,
        horario: e.horario || "",
        descripcion: e.descripcion || "",
        de: e.de,
        grupo: e.grupo || "",
        alcance: e.alcance || "",
        para: e.para || "",
        paraNombre: dest && dest.nombre ? dest.nombre : ""
    };
}

function puedeVerEncuentro(oyente, e) {
    if (!oyente || !e) return false;
    if (e.de && e.de === oyente.id) return true;
    if (kmEntre(oyente, e) > ENC_KM) return false;
    const alcance = sanitizarAlcance(e.alcance, true);
    if (alcance === "privado") return !!(e.para && e.para === oyente.id);
    if (alcance === "grupo") return !!(e.grupo && oyente.grupo && e.grupo === oyente.grupo);
    return true;
}

function encuentrosPara(oyente) {
    const lista = [];
    Object.keys(encuentros).forEach(id => {
        const e = encuentros[id];
        if (puedeVerEncuentro(oyente, e)) lista.push(publicoEncuentro(e));
    });
    return lista;
}

function destinosEncuentro(e) {
    if (!e) return [];
    const r = [];
    const visto = {};
    Object.keys(vehiculos).forEach(function (id) {
        const o = vehiculos[id];
        if (!o || !o.socketId || visto[o.socketId] || !puedeVerEncuentro(o, e)) return;
        visto[o.socketId] = true;
        r.push(o.socketId);
    });
    return r;
}

function emitirEncuentrosA(oyente) {
    if (!oyente || !oyente.socketId) return;
    io.to(oyente.socketId).emit("encuentrosLista", encuentrosPara(oyente));
}

function oyentePorSocket(socketId) {
    const id = socketAVehiculo[socketId];
    return id ? vehiculos[id] : null;
}

function snapshotPara(oyente) {
    const estado = {};
    if (!oyente) return estado;
    const ids = {};
    candidatosCerca(oyente).forEach(function (id) { ids[id] = true; });
    if (oyente.grupo && grupoVivos[oyente.grupo]) {
        Object.keys(grupoVivos[oyente.grupo]).forEach(function (id) { ids[id] = true; });
    }
    const filas = [];
    Object.keys(ids).forEach(function (id) {
        const v = vehiculos[id];
        if (!puedeVer(oyente, v)) return;
        const enG = mismoGrupo(oyente, v);
        filas.push({
            id: id,
            d: enG ? -1 : kmEntre(oyente, v),
            enG: enG,
            pub: Object.assign(publicoDe(v, false), { enGrupo: enG })
        });
    });
    filas.sort(function (a, b) { return a.d - b.d; });
    let i;
    for (i = 0; i < filas.length; i++) {
        if (i < SNAPSHOT_MAX || filas[i].enG) estado[filas[i].id] = filas[i].pub;
    }
    return estado;
}

function emitirA(sockets, evento, payload) {
    const visto = {};
    (sockets || []).forEach(sid => {
        if (!sid || visto[sid]) return;
        visto[sid] = true;
        io.to(sid).emit(evento, payload);
    });
}

function aplicarVisibilidad(vehiculo) {
    if (!vehiculo) return [];
    const next = salasDeVehiculo(vehiculo);
    const prev = vehiculo.salasEmit || [];
    const sids = socketsDelVehiculo(vehiculo.id);
    prev.forEach(function (sala) {
        if (next.indexOf(sala) >= 0) return;
        if (sids.length) exceptuar(io.to(sala), sids).emit("vehiculo_desconectado", vehiculo.id);
        else io.to(sala).emit("vehiculo_desconectado", vehiculo.id);
    });
    emitirASalas(next, "telemetria", Object.assign(publicoDe(vehiculo, false), {
        enGrupo: false,
        grupo: vehiculo.grupo || ""
    }), sids);
    vehiculo.salasEmit = next;
    if (escala.activo()) {
        escala.publicar("upsert", Object.assign(publicoDe(vehiculo, false), {
            grupo: vehiculo.grupo || "",
            ultimaActualizacion: vehiculo.ultimaActualizacion,
            ausente: !!vehiculo.ausente
        }));
    }
    return next;
}

function aplicarRemoto(pub) {
    if (!pub || !pub.id) return;
    const id = String(pub.id);
    const local = vehiculos[id];
    if (local && local.socketId && io.sockets.sockets.has(local.socketId)) return;
    const v = local || {
        id: id,
        socketId: null,
        celda: "",
        asistencia: null,
        vistoPor: []
    };
    v.nombre = sanitizarTexto(pub.nombre, 40);
    v.vehiculo = sanitizarTexto(pub.vehiculo, 40);
    v.iconoX = sanitizarEntero(pub.iconoX, 0, 64, 0);
    v.iconoY = sanitizarEntero(pub.iconoY, 0, 64, 0);
    v.lat = Number(pub.lat);
    v.lng = Number(pub.lng);
    v.velocidad = Number(pub.velocidad) || 0;
    v.rumbo = Number.isFinite(Number(pub.rumbo)) ? Number(pub.rumbo) : v.rumbo;
    v.radioKm = sanitizarEntero(pub.radioKm, RADIO_MIN, RADIO_MAX, RADIO_DEF);
    v.grupo = sanitizarTexto(pub.grupo, 8);
    v.enRuta = pub.enRuta !== false;
    v.ausente = !!pub.ausente;
    v.ultimaActualizacion = Number(pub.ultimaActualizacion) || Date.now();
    v.remoto = true;
    vehiculos[id] = v;
    if (Number.isFinite(v.lat) && Number.isFinite(v.lng)) ponerEnCelda(v);
    ponerEnGrupoVivo(v);
}

function borrarRemoto(id) {
    id = String(id || "");
    const v = vehiculos[id];
    if (!v) return;
    if (v.socketId && io.sockets.sockets.has(v.socketId)) return;
    sacarDeCelda(v);
    sacarDeGrupoVivo(id, v.grupo);
    delete vehiculos[id];
}

function salaCelda(k) {
    return k ? ("c:" + k) : "";
}

function salaGrupo(codigo) {
    return codigo ? ("g:" + codigo) : "";
}

function socketsDeSala(sala) {
    const set = sala && io.sockets.adapter.rooms.get(sala);
    if (!set) return [];
    const r = [];
    set.forEach(function (sid) { r.push(sid); });
    return r;
}

function salasRadioDe(emisor) {
    if (!emisor || !Number.isFinite(Number(emisor.lat))) return [];
    return idsCeldasVecinas(emisor.lat, emisor.lng).map(salaCelda);
}

function salasDeVehiculo(v) {
    const s = salasRadioDe(v);
    if (v && v.grupo) s.push(salaGrupo(v.grupo));
    return s;
}

function clientesAhora() {
    return (io.engine && io.engine.clientsCount) || 0;
}

function umbralGps(v) {
    const n = v && v.celda && celdas[v.celda] ? Object.keys(celdas[v.celda]).length : 0;
    const vivos = clientesAhora();
    if (vivos > 400) return { dt: 12000, dm: 40 };
    if (n > 50 || vivos > 250) return { dt: 8000, dm: 32 };
    if (n > 22 || vivos > 120) return { dt: 4500, dm: 16 };
    return { dt: 2200, dm: 10 };
}

function minMsAudio() {
    const n = clientesAhora();
    if (n > 120) return 1600;
    if (n > 60) return 1100;
    return 800;
}

function socketsDelVehiculo(id) {
    const out = [];
    if (!id) return out;
    Object.keys(socketAVehiculo).forEach(function (sid) {
        if (socketAVehiculo[sid] === id) out.push(sid);
    });
    return out;
}

function exceptuar(n, sids) {
    const lista = Array.isArray(sids) ? sids : (sids ? [sids] : []);
    lista.forEach(function (sid) {
        if (sid) n = n.except(sid);
    });
    return n;
}

function emitirASalas(salas, evento, payload, exceptoSid) {
    const limpio = [];
    const visto = {};
    (salas || []).forEach(function (s) {
        if (!s || visto[s]) return;
        visto[s] = true;
        limpio.push(s);
    });
    if (!limpio.length) return;
    exceptuar(io.to(limpio), exceptoSid).emit(evento, payload);
}

function unirSalas(socket, v) {
    if (!socket || !v) return;
    const nextCelda = v.celda ? salaCelda(v.celda) : "";
    const nextGrupo = v.grupo ? salaGrupo(v.grupo) : "";
    if (socket.salaCelda && socket.salaCelda !== nextCelda) socket.leave(socket.salaCelda);
    if (socket.salaGrupo && socket.salaGrupo !== nextGrupo) socket.leave(socket.salaGrupo);
    if (nextCelda) socket.join(nextCelda);
    if (nextGrupo) socket.join(nextGrupo);
    socket.salaCelda = nextCelda;
    socket.salaGrupo = nextGrupo;
}

function payloadZona(emisor, extra) {
    const o = extra && typeof extra === "object" ? extra : {};
    if (emisor) {
        o.lat = emisor.lat;
        o.lng = emisor.lng;
        o.radioKm = emisor.radioKm;
        if (emisor.grupo) o.grupo = emisor.grupo;
    }
    return o;
}

function vehiculoDeSocket(socket) {
    const id = socketAVehiculo[socket.id];
    return id ? vehiculos[id] : null;
}

function socketVivo(v) {
    return !!(v && v.socketId && io.sockets.sockets.has(v.socketId));
}

function clonarAudioInbox(audio) {
    if (!audio) return null;
    try {
        if (Buffer.isBuffer(audio)) return Buffer.from(audio);
        if (audio instanceof ArrayBuffer) return Buffer.from(new Uint8Array(audio));
        if (ArrayBuffer.isView(audio)) return Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
    } catch (e) {
        return null;
    }
    return null;
}

function podarInbox(v) {
    if (!v || !Array.isArray(v.inbox)) return;
    const ahora = Date.now();
    v.inbox = v.inbox.filter(function (it) {
        return it && (ahora - (it.ts || 0)) <= INBOX_TTL_MS;
    });
    while (v.inbox.length > INBOX_MAX) v.inbox.shift();
    let audios = 0;
    for (let i = v.inbox.length - 1; i >= 0; i--) {
        if (v.inbox[i] && v.inbox[i].audio) {
            audios += 1;
            if (audios > INBOX_AUDIO_MAX) {
                v.inbox[i].audio = null;
                v.inbox[i].sinAudio = true;
            }
        }
    }
}

function encolarInbox(v, item) {
    if (!v || !item) return;
    if (!v.inbox) v.inbox = [];
    v.inbox.push({
        evento: item.evento || "mensajeV2V",
        de: item.de || "",
        nombre: sanitizarTexto(item.nombre, 40) || "Alguien",
        texto: sanitizarTexto(item.texto || item.mensaje, 500),
        mensaje: sanitizarTexto(item.mensaje || item.texto, 500),
        canal: item.canal || "",
        mime: sanitizarTexto(item.mime, 40),
        ts: item.ts || Date.now(),
        privado: !!item.privado,
        audio: item.audio ? clonarAudioInbox(item.audio) : null
    });
    podarInbox(v);
}

function entregarInbox(v, socket) {
    if (!v || !socket) return;
    podarInbox(v);
    const lista = v.inbox;
    if (!lista || !lista.length) return;
    v.inbox = [];
    socket.emit("avisosPendientes", lista);
}

function encolarParaAusentes(item, emisorId, acepta) {
    Object.keys(vehiculos).forEach(function (id) {
        if (!id || id === emisorId) return;
        const dest = vehiculos[id];
        if (!dest || socketVivo(dest)) return;
        if (typeof acepta === "function" && !acepta(dest)) return;
        encolarInbox(dest, item);
    });
}

function perfilCambioDe(v, raw) {
    if (!v || !raw) return false;
    const nom = sanitizarTexto(raw.nombre, 40);
    const veh = sanitizarTexto(raw.vehiculo, 40);
    const ix = sanitizarEntero(raw.iconoX, 0, 64, v.iconoX || 0);
    const iy = sanitizarEntero(raw.iconoY, 0, 64, v.iconoY || 0);
    if (raw.nombre != null && nom !== (v.nombre || "")) return true;
    if (raw.vehiculo != null && veh !== (v.vehiculo || "")) return true;
    if (ix !== (v.iconoX || 0) || iy !== (v.iconoY || 0)) return true;
    return false;
}

function aplicarPerfilRaw(v, raw) {
    if (!v || !raw) return;
    if (raw.nombre != null) v.nombre = sanitizarTexto(raw.nombre, 40);
    if (raw.vehiculo != null) v.vehiculo = sanitizarTexto(raw.vehiculo, 40);
    if (raw.placa) v.placa = sanitizarTexto(raw.placa, 20);
    if (raw.seguro) v.seguro = sanitizarTexto(raw.seguro, 40);
    if (raw.contacto) v.contacto = sanitizarTexto(raw.contacto, 40);
    v.iconoX = sanitizarEntero(raw.iconoX, 0, 64, v.iconoX || 0);
    v.iconoY = sanitizarEntero(raw.iconoY, 0, 64, v.iconoY || 0);
}

function podarGemelosAusentes(vivo) {
    if (!vivo || !vivo.id) return;
    Object.keys(vehiculos).forEach(function (id) {
        if (id === vivo.id) return;
        const o = vehiculos[id];
        if (!o) return;
        if (o.socketId && io.sockets.sockets.has(o.socketId)) return;
        if (socketsDelVehiculo(id).length) return;
        const d = kmEntre(vivo, o) * 1000;
        if (!Number.isFinite(d) || d > 35) return;
        const nomVivo = sanitizarTexto(vivo.nombre, 40);
        const nomOtro = sanitizarTexto(o.nombre, 40);
        if (nomOtro && nomVivo && nomOtro !== nomVivo) return;
        emitirASalas(salasDeVehiculo(o), "vehiculo_desconectado", id);
        if (escala.activo()) escala.publicar("borrar", id);
        sacarDeCelda(o);
        sacarDeGrupoVivo(id, o.grupo);
        delete vehiculos[id];
    });
}

function resolverId(socket, claimed) {
    const actual = socketAVehiculo[socket.id];
    if (actual) return actual;
    let id = sanitizarTexto(claimed, 64);
    if (!/^v[a-z0-9]+$/i.test(id)) {
        id = "v" + socket.id.replace(/[^a-z0-9]/gi, "").slice(0, 18);
        socket.emit("identidad", { id: id });
    }
    socketAVehiculo[socket.id] = id;
    return id;
}

function normalizarGrupo(valor) {
    const s = String(valor || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (s.length < 4 || s.length > 8) return "";
    return s;
}

function crearCodigoGrupo() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let c = "";
    let i;
    for (i = 0; i < 6; i++) c += chars.charAt(Math.floor(Math.random() * chars.length));
    return c;
}

function tamanioAudio(audio) {
    if (!audio) return 0;
    if (Buffer.isBuffer(audio)) return audio.length;
    if (audio.byteLength) return audio.byteLength;
    if (audio.length) return audio.length;
    return 0;
}

function metaEmisor(socket) {
    const v = vehiculoDeSocket(socket);
    return {
        de: (v && v.id) || socket.id,
        nombre: (v && v.nombre) || "Anónimo"
    };
}

function rateOk(mapa, socketId, minMs) {
    const ahora = Date.now();
    if ((mapa[socketId] || 0) + minMs > ahora) return false;
    mapa[socketId] = ahora;
    return true;
}

function idCarreraNuevo() {
    return "c" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

function tokenFantasmaNuevo() {
    return crypto.randomBytes(9).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function salaFantasma(token) {
    return "fan:" + token;
}

function tokenFantasmaDeSocket(socket) {
    if (socket.fantasmaToken && recFantasmaVivo(socket.fantasmaToken)) return socket.fantasmaToken;
    const yo = vehiculoDeSocket(socket);
    if (!yo) return "";
    const t = fantasmaPorHost[yo.id];
    return recFantasmaVivo(t) ? t : "";
}

function socketDeId(sid) {
    return sid && io.sockets.sockets.get(sid) ? io.sockets.sockets.get(sid) : null;
}

function socketHostFantasma(rec) {
    if (!rec) return null;
    const porRec = socketDeId(rec.socketId);
    if (porRec) return porRec;
    const v = rec.hostId ? vehiculos[rec.hostId] : null;
    return v ? socketDeId(v.socketId) : null;
}

function vincularSocketAFantasma(socket, rec) {
    if (!socket || !rec || !rec.token) return;
    socket.fantasmaToken = rec.token;
    socket.join(salaFantasma(rec.token));
    rec.socketId = socket.id;
}

function asegurarHostEnSalaFantasma(rec) {
    const hostSock = socketHostFantasma(rec);
    if (hostSock) vincularSocketAFantasma(hostSock, rec);
}

function recFantasmaVivo(token) {
    const rec = token ? fantasmas[token] : null;
    if (!rec) return null;
    if (Date.now() > rec.exp) {
        cortarFantasma(rec, "expiro");
        return null;
    }
    return rec;
}

function cortarFantasma(rec, motivo) {
    if (!rec || !rec.token) return;
    if (rec.corteTimer) {
        clearTimeout(rec.corteTimer);
        rec.corteTimer = null;
    }
    io.to(salaFantasma(rec.token)).emit("fantasmaFin", { motivo: motivo || "cortado" });
    delete fantasmas[rec.token];
    if (rec.hostId && fantasmaPorHost[rec.hostId] === rec.token) delete fantasmaPorHost[rec.hostId];
}

function avisarPausaFantasma(rec, pausa) {
    if (!rec || !rec.token) return;
    io.to(salaFantasma(rec.token)).emit("fantasmaPausa", {
        pausa: !!pausa,
        nombre: rec.nombre || "Alguien"
    });
}

function puedeReclamarFantasma(rec, yo, hostKey) {
    if (!rec || !yo) return false;
    if (rec.hostId === yo.id) return true;
    const key = sanitizarTexto(hostKey, 40);
    return !!(key && rec.hostKey && key === rec.hostKey);
}

function sanitizarPtsFantasma(raw, maxN) {
    if (!Array.isArray(raw) || raw.length < 1) return [];
    const tope = Math.min(raw.length, maxN || 80);
    const out = [];
    for (let i = 0; i < tope; i++) {
        const p = sanitizarPuntoCarrera(raw[i]);
        if (p) out.push(p);
    }
    return out;
}

function sanitizarVistaFantasma(raw) {
    if (!raw || typeof raw !== "object") return null;
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const c0 = Number(raw.clat);
    const c1 = Number(raw.clng);
    const clat = Number.isFinite(c0) ? c0 : lat;
    const clng = Number.isFinite(c1) ? c1 : lng;
    const zoom = sanitizarEntero(raw.zoom, 3, 20, 16);
    let bearing = Number(raw.bearing);
    if (!Number.isFinite(bearing)) bearing = 0;
    bearing = ((bearing % 360) + 360) % 360;
    let rumbo = Number(raw.rumbo);
    if (!Number.isFinite(rumbo)) rumbo = null;
    return {
        lat: lat,
        lng: lng,
        rumbo: rumbo,
        vel: Math.max(0, Math.min(220, Number(raw.vel) || 0)),
        clat: clat,
        clng: clng,
        zoom: zoom,
        bearing: bearing,
        navGps: !!raw.navGps,
        path: sanitizarPtsFantasma(raw.path, 120),
        trail: sanitizarPtsFantasma(raw.trail, 80),
        dest: sanitizarPuntoCarrera(raw.dest),
        nombre: sanitizarTexto(raw.nombre, 40) || "Alguien",
        vehiculo: sanitizarTexto(raw.vehiculo, 40),
        iconoX: sanitizarEntero(raw.iconoX, 0, 64, 0),
        iconoY: sanitizarEntero(raw.iconoY, 0, 64, 0)
    };
}

function vistaDesdeVehiculoFantasma(v, rec, extras) {
    if (!rec) return null;
    const prev = rec.ultimaVista || {};
    const extra = extras && typeof extras === "object" ? extras : {};
    const lat = v && Number.isFinite(Number(v.lat)) ? Number(v.lat) : Number(prev.lat);
    const lng = v && Number.isFinite(Number(v.lng)) ? Number(v.lng) : Number(prev.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const rumboV = v && Number.isFinite(Number(v.rumbo)) ? Number(v.rumbo) : null;
    return {
        lat: lat,
        lng: lng,
        rumbo: rumboV != null ? rumboV : (Number.isFinite(Number(prev.rumbo)) ? Number(prev.rumbo) : null),
        vel: (v && Number(v.velocidad)) || extra.vel || prev.vel || 0,
        clat: lat,
        clng: lng,
        zoom: sanitizarEntero(extra.zoom != null ? extra.zoom : prev.zoom, 3, 20, 16),
        bearing: 0,
        navGps: extra.navGps != null ? !!extra.navGps : !!prev.navGps,
        path: extra.path || prev.path || [],
        trail: extra.trail || prev.trail || [],
        dest: extra.dest !== undefined ? extra.dest : (prev.dest || null),
        nombre: sanitizarTexto((v && v.nombre) || rec.nombre || prev.nombre, 40) || "Alguien",
        vehiculo: sanitizarTexto((v && v.vehiculo) || extra.vehiculo || prev.vehiculo, 40),
        iconoX: sanitizarEntero((v && v.iconoX) != null ? v.iconoX : prev.iconoX, 0, 64, 0),
        iconoY: sanitizarEntero((v && v.iconoY) != null ? v.iconoY : prev.iconoY, 0, 64, 0),
        vivo: !!rec.socketId
    };
}

function guardarVistaFantasma(rec, vista) {
    if (!rec || !vista) return null;
    rec.ultimaVista = vista;
    if (vista.nombre) rec.nombre = vista.nombre;
    return vista;
}

function emitirVistaSalaFantasma(rec, vista) {
    if (!rec || !vista) return;
    io.to(salaFantasma(rec.token)).emit("fantasmaVista", vista);
}

function publicarPosicionFantasma(v) {
    if (!v || !v.id) return;
    const token = fantasmaPorHost[v.id];
    const rec = recFantasmaVivo(token);
    if (!rec) return;
    asegurarHostEnSalaFantasma(rec);
    const vista = vistaDesdeVehiculoFantasma(v, rec);
    if (!vista) return;
    guardarVistaFantasma(rec, vista);
    if (!rateOk(ultimoFantasmaVistaTs, "host:" + v.id, 280)) return;
    emitirVistaSalaFantasma(rec, vista);
}

function sanitizarPuntoCarrera(p) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const lat = Number(p[0]);
    const lng = Number(p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return [lat, lng];
}

function sanitizarPathCarrera(raw) {
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > 900) return null;
    const out = [];
    for (let i = 0; i < raw.length; i++) {
        const p = sanitizarPuntoCarrera(raw[i]);
        if (!p) return null;
        out.push(p);
    }
    return out;
}

function fichaCarrera(v) {
    if (!v) return null;
    return {
        id: v.id,
        nombre: (v.nombre && String(v.nombre).trim()) || "Invitado",
        vehiculo: v.vehiculo || "",
        iconoX: sanitizarEntero(v.iconoX, 0, 64, 0),
        iconoY: sanitizarEntero(v.iconoY, 0, 64, 0)
    };
}

function tokenCarreraNuevo() {
    return tokenFantasmaNuevo();
}

function recInviteCarrera(token) {
    const rec = token ? invitesCarreraLink[token] : null;
    if (!rec) return null;
    if (Date.now() > rec.exp) {
        borrarInviteCarrera(token, "expiro");
        return null;
    }
    return rec;
}

function borrarInviteCarrera(token, motivo) {
    const rec = token ? invitesCarreraLink[token] : null;
    if (!rec) return;
    delete invitesCarreraLink[token];
    if (rec.hostId && inviteCarreraPorHost[rec.hostId] === token) {
        delete inviteCarreraPorHost[rec.hostId];
    }
    if (motivo && rec.hostId) {
        emitirAJugador(rec.hostId, "carreraCancelada", { motivo: motivo || "cancelada", link: true });
    }
}

function borrarInviteDeHost(hostId) {
    const token = hostId ? inviteCarreraPorHost[hostId] : "";
    if (!token) return;
    const rec = invitesCarreraLink[token];
    if (rec) {
        delete invitesCarreraLink[token];
        delete inviteCarreraPorHost[hostId];
    } else {
        delete inviteCarreraPorHost[hostId];
    }
}

function carreraDeJugador(id) {
    const keys = Object.keys(carreras1v1);
    for (let i = 0; i < keys.length; i++) {
        const c = carreras1v1[keys[i]];
        if (!c) continue;
        if (c.hostId === id || c.rivalId === id) return c;
        if (Array.isArray(c.ids) && c.ids.indexOf(id) >= 0) return c;
    }
    return null;
}

function desafioDeJugador(id) {
    if (desafiosCarrera[id]) return desafiosCarrera[id];
    const ids = Object.keys(desafiosCarrera);
    for (let i = 0; i < ids.length; i++) {
        const d = desafiosCarrera[ids[i]];
        if (d && d.de === id) return d;
    }
    return null;
}

function emitirAJugador(id, evento, payload) {
    const v = vehiculos[id];
    if (!v || !v.socketId) return false;
    io.to(v.socketId).emit(evento, payload);
    return true;
}

function limpiarDesafioCarrera(d, motivo) {
    if (!d) return;
    if (desafiosCarrera[d.para] === d) delete desafiosCarrera[d.para];
    if (d.linkToken) borrarInviteCarrera(d.linkToken, null);
    emitirAJugador(d.de, "carreraCancelada", { motivo: motivo || "cancelada" });
    emitirAJugador(d.para, "carreraCancelada", { motivo: motivo || "cancelada" });
}

function cerrarCarrera1v1(c, motivo, extra) {
    if (!c || c.cerrada) return;
    c.cerrada = true;
    delete carreras1v1[c.id];
    const payload = Object.assign({
        carreraId: c.id,
        motivo: motivo || "fin"
    }, extra || {});
    const ids = idsDeCarrera(c);
    for (let i = 0; i < ids.length; i++) emitirAJugador(ids[i], "carreraFin", payload);
}

function idsDeCarrera(c) {
    if (!c) return [];
    if (Array.isArray(c.ids) && c.ids.length) {
        const seen = {};
        const out = [];
        for (let i = 0; i < c.ids.length; i++) {
            const id = c.ids[i];
            if (id && !seen[id]) {
                seen[id] = true;
                out.push(id);
            }
        }
        return out;
    }
    const out = [];
    if (c.hostId) out.push(c.hostId);
    if (c.rivalId && c.rivalId !== c.hostId) out.push(c.rivalId);
    return out;
}

function rivalDeCarrera(c, id) {
    if (!c) return null;
    return c.hostId === id ? c.rivalId : c.rivalId === id ? c.hostId : null;
}

app.get("/api/salud", (_req, res) => {
    let enVivo = 0;
    Object.keys(vehiculos).forEach(function (id) {
        if (vehiculos[id] && vehiculos[id].socketId) enVivo += 1;
    });
    res.json({
        ok: true,
        puerto: puertoActivo,
        sql: dbSql.activo(),
        fase: 5,
        redis: escala.activo(),
        shard: escala.info().shard,
        shards: escala.info().shards,
        enVivo: enVivo,
        sockets: clientesAhora(),
        grupos: Object.keys(gruposReg).length,
        encuentros: Object.keys(encuentros).length
    });
});

io.use((socket, next) => {
    const claimed = sanitizarTexto(socket.handshake.auth && socket.handshake.auth.id, 64);
    if (/^v[a-z0-9]+$/i.test(claimed)) socketAVehiculo[socket.id] = claimed;
    next();
});

io.on("connection", socket => {
    socket.join("rm:all");
    socket.emit("telemetria_global", {});
    const idSesion = socketAVehiculo[socket.id];
    if (idSesion && vehiculos[idSesion]) {
        vehiculos[idSesion].socketId = socket.id;
        entregarInbox(vehiculos[idSesion], socket);
    }

    socket.on("sesion", payload => {
        const id = resolverId(socket, payload && payload.id);
        if (!id) return;
        const v = vehiculos[id];
        if (!v) return;
        v.socketId = socket.id;
        entregarInbox(v, socket);
    });

    socket.on("telemetria", data => {
        const raw = data && typeof data === "object" ? data : {};
        const id = resolverId(socket, raw.id);

        const lat = Number(raw.lat);
        const lng = Number(raw.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const redir = escala.hintShard(lat, lng);
        if (redir) socket.emit("shardRedirect", redir);

        const prev = vehiculos[id];
        const prevSockets = prev && prev.vistoPor ? prev.vistoPor.slice() : [];
        const radioAntes = prev ? prev.radioKm : null;
        const grupoAntes = prev ? prev.grupo : "";
        const eraNuevo = !prev;
        const socketCambio = !prev || prev.socketId !== socket.id;
        const grupo = normalizarGrupo(raw.grupo);
        const radioKm = sanitizarEntero(raw.radioKm, RADIO_MIN, RADIO_MAX, RADIO_DEF);
        const enRuta = raw.enRuta !== false;
        const ahora = Date.now();

        if (prev && !socketCambio && radioAntes === radioKm && grupoAntes === grupo &&
                !perfilCambioDe(prev, raw)) {
            const u = umbralGps(prev);
            const dt = ahora - (prev.ultimaActualizacion || 0);
            const dm = kmEntre(prev, { lat: lat, lng: lng }) * 1000;
            if (dt < u.dt && dm < u.dm && prev.enRuta === enRuta) {
                prev.lat = lat;
                prev.lng = lng;
                prev.velocidad = Number(raw.velocidad) || 0;
                if (Number.isFinite(Number(raw.rumbo))) prev.rumbo = Number(raw.rumbo);
                prev.ultimaActualizacion = ahora;
                prev.ausente = false;
                ponerEnCelda(prev);
                unirSalas(socket, prev);
                if (prev.encSyncLat == null ||
                    kmEntre({ lat: prev.encSyncLat, lng: prev.encSyncLng }, prev) >= 10) {
                    emitirEncuentrosA(prev);
                    prev.encSyncLat = prev.lat;
                    prev.encSyncLng = prev.lng;
                }
                publicarPosicionFantasma(prev);
                return;
            }
        }

        let v = prev;
        if (!v) {
            v = {
                id: id,
                socketId: socket.id,
                nombre: sanitizarTexto(raw.nombre, 40),
                vehiculo: sanitizarTexto(raw.vehiculo, 40),
                placa: sanitizarTexto(raw.placa, 20),
                seguro: sanitizarTexto(raw.seguro, 40),
                contacto: sanitizarTexto(raw.contacto, 40),
                iconoX: sanitizarEntero(raw.iconoX, 0, 64, 0),
                iconoY: sanitizarEntero(raw.iconoY, 0, 64, 0),
                lat: lat,
                lng: lng,
                velocidad: Number(raw.velocidad) || 0,
                rumbo: Number.isFinite(Number(raw.rumbo)) ? Number(raw.rumbo) : null,
                radioKm: radioKm,
                grupo: grupo,
                enRuta: enRuta,
                asistencia: null,
                vistoPor: prevSockets,
                ultimaActualizacion: ahora,
                ausente: false,
                celda: ""
            };
            vehiculos[id] = v;
        } else {
            v.socketId = socket.id;
            aplicarPerfilRaw(v, raw);
            v.lat = lat;
            v.lng = lng;
            v.velocidad = Number(raw.velocidad) || 0;
            v.rumbo = Number.isFinite(Number(raw.rumbo)) ? Number(raw.rumbo) : v.rumbo;
            v.radioKm = radioKm;
            v.enRuta = enRuta;
            v.asistencia = prev && prev.asistencia ? prev.asistencia : null;
            v.vistoPor = prevSockets;
            v.ultimaActualizacion = ahora;
            v.ausente = false;
            if (grupoAntes !== grupo) {
                sacarDeGrupoVivo(v.id, grupoAntes);
                if (grupoAntes) quitarMiembroGrupo(grupoAntes, v.id);
                v.grupo = grupo;
            }
        }

        if (socket.grupoPendiente) {
            const pend = normalizarGrupo(socket.grupoPendiente);
            socket.grupoPendiente = "";
            if (pend && v.grupo !== pend) {
                sacarDeGrupoVivo(v.id, v.grupo);
                if (v.grupo) quitarMiembroGrupo(v.grupo, v.id);
                v.grupo = pend;
                grupo = pend;
            }
        }

        ponerEnCelda(v);
        ponerEnGrupoVivo(v);
        unirSalas(socket, v);
        if (eraNuevo || socketCambio) podarGemelosAusentes(v);
        if (grupo && (eraNuevo || grupoAntes !== grupo)) registrarMiembroGrupo(grupo, v);

        aplicarVisibilidad(v, prevSockets);
        persistirUsuarioSql(v, eraNuevo || grupoAntes !== grupo);
        const encPrev = v.encSyncLat != null
            ? { lat: v.encSyncLat, lng: v.encSyncLng }
            : null;
        const encMovio = !encPrev || kmEntre(encPrev, v) >= 10;
        if (eraNuevo || radioAntes !== radioKm || grupoAntes !== grupo || socketCambio) {
            socket.emit("telemetria_global", snapshotPara(v));
            socket.emit("grupoEstado", { codigo: grupo, nombre: nombreDeGrupo(grupo) });
            emitirEncuentrosA(v);
            v.encSyncLat = v.lat;
            v.encSyncLng = v.lng;
        } else if (encMovio) {
            emitirEncuentrosA(v);
            v.encSyncLat = v.lat;
            v.encSyncLng = v.lng;
        }
        publicarPosicionFantasma(v);
        entregarInbox(v, socket);
    });

    socket.on("pedirFicha", (payload, ack) => {
        const yo = vehiculoDeSocket(socket);
        const destId = sanitizarTexto(payload && payload.id, 64);
        const dest = destId ? vehiculos[destId] : null;
        const ok = yo && dest && (yo.id === dest.id || puedeVer(yo, dest));
        const res = ok
            ? {
                ok: true,
                id: dest.id,
                placa: dest.placa || "",
                seguro: dest.seguro || "",
                contacto: dest.contacto || ""
            }
            : { ok: false };
        const responder = function (dato) {
            if (typeof ack === "function") ack(dato);
            else if (dato.ok) socket.emit("fichaDetalle", dato);
        };
        if (!ok) {
            responder(res);
            return;
        }
        if ((res.placa || res.seguro || res.contacto) || !dbSql.activo()) {
            responder(res);
            return;
        }
        dbSql.leerFicha(dest.id).then(function (f) {
            if (f) {
                dest.placa = dest.placa || f.placa;
                dest.seguro = dest.seguro || f.seguro;
                dest.contacto = dest.contacto || f.contacto;
                res.placa = dest.placa || "";
                res.seguro = dest.seguro || "";
                res.contacto = dest.contacto || "";
            }
            responder(res);
        }).catch(function () {
            responder(res);
        });
    });

    socket.on("grupoCrear", (payload, ack) => {
        const yo = vehiculoDeSocket(socket);
        const raw = payload && typeof payload === "object" ? payload : {};
        let codigo = normalizarGrupo(raw.codigo);
        if (!codigo) codigo = crearCodigoGrupo();
        const nombre = sanitizarNombreGrupo(raw.nombre) || ("Grupo " + codigo);
        asegurarGrupo(codigo, nombre);
        guardarNombresGrupo();
        if (yo) {
            const prev = yo.vistoPor ? yo.vistoPor.slice() : [];
            sacarDeGrupoVivo(yo.id, yo.grupo);
            if (yo.grupo && yo.grupo !== codigo) quitarMiembroGrupo(yo.grupo, yo.id);
            yo.grupo = codigo;
            ponerEnGrupoVivo(yo);
            registrarMiembroGrupo(codigo, yo);
            unirSalas(socket, yo);
            socket.emit("telemetria_global", snapshotPara(yo));
            aplicarVisibilidad(yo, prev);
        }
        const res = { ok: true, codigo: codigo, nombre: nombreDeGrupo(codigo) || nombre };
        if (typeof ack === "function") ack(res);
        socket.emit("grupoEstado", { codigo: codigo, nombre: nombre });
        if (yo) emitirEncuentrosA(vehiculos[yo.id] || yo);
    });

    socket.on("grupoUnirse", (payload, ack) => {
        const codigo = normalizarGrupo(payload && (payload.codigo || payload));
        if (!codigo) {
            if (typeof ack === "function") ack({ ok: false, error: "Código inválido. Usá 4 a 8 letras o números." });
            return;
        }
        const yo = vehiculoDeSocket(socket);
        const nombreIn = sanitizarNombreGrupo(payload && payload.nombre);
        if (nombreIn) asegurarGrupo(codigo, nombreDeGrupo(codigo) ? "" : nombreIn);
        else asegurarGrupo(codigo, "");
        const nombre = nombreDeGrupo(codigo) || "";
        if (!yo) {
            // Todavía no hay telemetría/GPS: reservamos el código y el cliente reintenta.
            socket.grupoPendiente = codigo;
            if (typeof ack === "function") {
                ack({ ok: false, error: "Todavía no hay GPS. El grupo quedó pendiente; reintentamos al ubicarte." });
            }
            return;
        }
        const prev = yo.vistoPor ? yo.vistoPor.slice() : [];
        sacarDeGrupoVivo(yo.id, yo.grupo);
        if (yo.grupo && yo.grupo !== codigo) quitarMiembroGrupo(yo.grupo, yo.id);
        yo.grupo = codigo;
        ponerEnGrupoVivo(yo);
        registrarMiembroGrupo(codigo, yo);
        unirSalas(socket, yo);
        socket.emit("telemetria_global", snapshotPara(yo));
        aplicarVisibilidad(yo, prev);
        if (typeof ack === "function") ack({ ok: true, codigo: codigo, nombre: nombre });
        socket.emit("grupoEstado", { codigo: codigo, nombre: nombre });
        emitirEncuentrosA(yo);
    });

    socket.on("grupoSalir", (_payload, ack) => {
        const yo = vehiculoDeSocket(socket);
        if (yo) {
            const prev = yo.vistoPor ? yo.vistoPor.slice() : [];
            const codigoAntes = yo.grupo;
            sacarDeGrupoVivo(yo.id, codigoAntes);
            quitarMiembroGrupo(codigoAntes, yo.id);
            yo.grupo = "";
            unirSalas(socket, yo);
            socket.emit("telemetria_global", snapshotPara(yo));
            aplicarVisibilidad(yo, prev);
            emitirEncuentrosA(yo);
        }
        if (typeof ack === "function") ack({ ok: true, codigo: "" });
        socket.emit("grupoEstado", { codigo: "" });
    });

    socket.on("encuentroCrear", (payload, ack) => {
        const yo = vehiculoDeSocket(socket);
        const raw = payload && typeof payload === "object" ? payload : {};
        const lat = Number(raw.lat);
        const lng = Number(raw.lng);
        if (!yo || !Number.isFinite(lat) || !Number.isFinite(lng)) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        const id = sanitizarTexto(raw.id, 40) || ("enc" + Date.now().toString(36));
        const alcance = sanitizarAlcance(raw.alcance, false);
        let grupo = "";
        let para = "";
        if (alcance === "grupo") {
            if (!yo.grupo) {
                if (typeof ack === "function") ack({ ok: false, error: "Uníte a un grupo para compartir el punto ahí." });
                return;
            }
            grupo = yo.grupo;
        } else if (alcance === "privado") {
            para = sanitizarTexto(raw.para, 64);
            if (!para || para === yo.id) {
                if (typeof ack === "function") ack({ ok: false, error: "Elegí un contacto para el punto privado." });
                return;
            }
            const dest = vehiculos[para];
            if (!dest) {
                if (typeof ack === "function") ack({ ok: false, error: "Ese contacto no está en el mapa ahora." });
                return;
            }
        }
        const e = {
            id: id,
            lat: lat,
            lng: lng,
            nombre: sanitizarTexto(raw.nombre, 40) || "Encuentro",
            horario: sanitizarTexto(raw.horario, 40),
            descripcion: sanitizarTexto(raw.descripcion, 200),
            de: yo.id,
            grupo: grupo,
            alcance: alcance,
            para: para,
            ts: Date.now()
        };
        encuentros[id] = e;
        guardarEncuentrosDisco();
        persistirEncuentroSql(e);
        const pub = publicoEncuentro(e);
        emitirA(destinosEncuentro(e), "encuentroNuevo", pub);
        if (typeof ack === "function") ack({ ok: true, encuentro: pub });
    });

    socket.on("encuentroQuitar", (payload, ack) => {
        const yo = vehiculoDeSocket(socket);
        const id = sanitizarTexto(payload && (payload.id || payload), 40);
        const e = id ? encuentros[id] : null;
        if (!yo || !e || e.de !== yo.id) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        const dest = destinosEncuentro(e);
        delete encuentros[id];
        guardarEncuentrosDisco();
        borrarEncuentroSql(id);
        emitirA(dest, "encuentroQuitar", { id: id });
        if (typeof ack === "function") ack({ ok: true, id: id });
    });

    socket.on("encuentrosPedir", () => {
        emitirEncuentrosA(vehiculoDeSocket(socket));
    });

    socket.on("asistencia", (payload, ack) => {
        const yo = vehiculoDeSocket(socket);
        if (!yo) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        const activo = !!(payload && payload.activo);
        yo.asistencia = activo ? { activo: true, ts: Date.now() } : null;
        const msg = {
            id: yo.id,
            de: yo.id,
            nombre: yo.nombre || "Anónimo",
            activo: activo,
            lat: yo.lat,
            lng: yo.lng,
            ts: Date.now()
        };
        const salasAsist = salasRadioDe(yo).concat(yo.grupo ? [salaGrupo(yo.grupo)] : []);
        emitirASalas(salasAsist, "asistencia", payloadZona(yo, msg), socket.id);
        socket.emit("asistencia", msg);
        aplicarVisibilidad(yo, yo.vistoPor ? yo.vistoPor.slice() : []);
        if (activo) {
            const aviso = {
                de: yo.id,
                nombre: yo.nombre || "Anónimo",
                texto: "Necesito ayuda. Estoy parado en ruta.",
                ts: Date.now(),
                asistencia: true,
                canal: "radio"
            };
            emitirASalas(salasAsist, "mensajeV2V", payloadZona(yo, aviso), socket.id);
            socket.emit("mensajeV2V", aviso);
        }
        if (typeof ack === "function") ack({ ok: true, activo: activo });
    });

    socket.on("mensajeV2V", payload => {
        if (!rateOk(ultimoMsgTs, socket.id, 250)) return;
        const texto = sanitizarTexto(
            typeof payload === "string" ? payload : payload && payload.texto,
            500
        );
        if (!texto) return;

        const v = vehiculoDeSocket(socket);
        const canal = (payload && payload.canal) === "grupo" ? "grupo" : "radio";
        if (canal === "grupo" && !(v && v.grupo)) return;
        const msg = {
            de: (v && v.id) || socket.id,
            nombre: (v && v.nombre) || "Anónimo",
            texto: texto,
            ts: Date.now(),
            grupo: canal === "grupo",
            canal: canal
        };
        socket.emit("mensajeV2V", msg);
        if (canal === "grupo") {
            emitirASalas([salaGrupo(v.grupo)], "mensajeV2V", msg, socket.id);
        } else {
            emitirASalas(salasRadioDe(v), "mensajeV2V", payloadZona(v, msg), socket.id);
        }
        encolarParaAusentes({
            evento: "mensajeV2V",
            de: msg.de,
            nombre: msg.nombre,
            texto: msg.texto,
            ts: msg.ts,
            canal: canal
        }, msg.de, function (dest) {
            if (canal === "grupo") return !!(v && dest.grupo && dest.grupo === v.grupo);
            return puedeHablarRadio(v, dest);
        });
    });

    socket.on("mensajePrivado", payload => {
        if (!rateOk(ultimoMsgTs, socket.id, 250)) return;
        const destinoId = sanitizarTexto(payload && payload.id, 64);
        const mensaje = sanitizarTexto(payload && payload.mensaje, 500);
        if (!destinoId || !mensaje) return;

        const dest = vehiculos[destinoId];
        const origen = vehiculoDeSocket(socket);
        if (!dest || !origen) return;
        if (!puedeVer(origen, dest) && !puedeVer(dest, origen)) return;

        const paquete = {
            de: origen.id,
            nombre: origen.nombre || "Anónimo",
            mensaje: mensaje,
            ts: Date.now()
        };
        if (socketVivo(dest)) {
            io.to(dest.socketId).emit("mensajePrivado", paquete);
        } else {
            encolarInbox(dest, {
                evento: "mensajePrivado",
                de: paquete.de,
                nombre: paquete.nombre,
                mensaje: paquete.mensaje,
                texto: paquete.mensaje,
                ts: paquete.ts,
                privado: true,
                canal: "privado"
            });
        }
    });

    socket.on("audioV2V", (payload, ack) => {
        const audio = payload && payload.audio;
        const bytes = tamanioAudio(audio);
        const carga = clientesAhora();
        if (bytes < 200 || bytes > 400000 || !rateOk(ultimoAudioTs, socket.id, minMsAudio())) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        const v = vehiculoDeSocket(socket);
        const canal = (payload && payload.canal) === "grupo" ? "grupo" : "radio";
        if (canal === "grupo" && !(v && v.grupo)) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        if (canal === "radio" && carga > 180 && bytes > 90000) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        const meta = metaEmisor(socket);
        const paquete = {
            de: meta.de,
            nombre: meta.nombre,
            mime: sanitizarTexto(payload.mime, 40) || "audio/webm",
            texto: sanitizarTexto(payload.texto, 500),
            audio: audio,
            ts: Date.now(),
            canal: canal
        };
        if (canal === "grupo") {
            emitirASalas([salaGrupo(v.grupo)], "audioV2V", paquete, socket.id);
        } else {
            emitirASalas(salasRadioDe(v), "audioV2V", payloadZona(v, paquete), socket.id);
        }
        encolarParaAusentes({
            evento: "audioV2V",
            de: paquete.de,
            nombre: paquete.nombre,
            texto: paquete.texto,
            mime: paquete.mime,
            audio: paquete.audio,
            ts: paquete.ts,
            canal: canal
        }, paquete.de, function (dest) {
            if (canal === "grupo") return !!(v && dest.grupo && dest.grupo === v.grupo);
            return puedeHablarRadio(v, dest);
        });
        if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("audioPrivado", (payload, ack) => {
        const destinoId = sanitizarTexto(payload && payload.id, 64);
        const audio = payload && payload.audio;
        const bytes = tamanioAudio(audio);
        if (!destinoId || bytes < 200 || bytes > 400000 || !rateOk(ultimoAudioTs, socket.id, 800)) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        const dest = vehiculos[destinoId];
        const origen = vehiculoDeSocket(socket);
        if (!dest || !origen || (!puedeVer(origen, dest) && !puedeVer(dest, origen))) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        const meta = metaEmisor(socket);
        const paquete = {
            de: meta.de,
            nombre: meta.nombre,
            mime: sanitizarTexto(payload.mime, 40) || "audio/webm",
            texto: sanitizarTexto(payload.texto, 500),
            audio: audio,
            ts: Date.now()
        };
        if (socketVivo(dest)) {
            io.to(dest.socketId).emit("audioPrivado", paquete);
        } else {
            encolarInbox(dest, {
                evento: "audioPrivado",
                de: paquete.de,
                nombre: paquete.nombre,
                texto: paquete.texto,
                mime: paquete.mime,
                audio: paquete.audio,
                ts: paquete.ts,
                privado: true,
                canal: "privado"
            });
        }
        if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("audioCarrera", (payload, ack) => {
        const yo = vehiculoDeSocket(socket);
        const audio = payload && payload.audio;
        const bytes = tamanioAudio(audio);
        if (!yo || bytes < 200 || bytes > 400000 || !rateOk(ultimoAudioTs, socket.id, minMsAudio())) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        const c = carreraDeJugador(yo.id);
        const carreraId = sanitizarTexto(payload && payload.carreraId, 40);
        if (!c || c.cerrada || (carreraId && c.id !== carreraId)) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        const ids = idsDeCarrera(c);
        if (ids.indexOf(yo.id) < 0) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        const meta = metaEmisor(socket);
        const paquete = {
            de: meta.de,
            nombre: meta.nombre,
            mime: sanitizarTexto(payload.mime, 40) || "audio/webm",
            texto: sanitizarTexto(payload.texto, 500),
            audio: audio,
            ts: Date.now(),
            canal: "carrera",
            carreraId: c.id
        };
        let n = 0;
        for (let i = 0; i < ids.length; i++) {
            if (ids[i] === yo.id) continue;
            if (emitirAJugador(ids[i], "audioCarrera", paquete)) n += 1;
        }
        if (typeof ack === "function") ack({ ok: true, n: n });
    });

    socket.on("carreraDesafiar", (payload, ack) => {
        const origen = vehiculoDeSocket(socket);
        const rivalId = sanitizarTexto(payload && payload.rivalId, 64);
        const path = sanitizarPathCarrera(payload && payload.path);
        const a = sanitizarPuntoCarrera(payload && payload.a);
        const b = sanitizarPuntoCarrera(payload && payload.b);
        const km = Number(payload && payload.km);
        if (!origen) {
            if (typeof ack === "function") ack({ ok: false, error: "Sin conexión." });
            return;
        }
        if (!rateOk(ultimoCarreraTs, socket.id, 800)) {
            if (typeof ack === "function") ack({ ok: false, error: "Esperá un segundo." });
            return;
        }
        const dest = rivalId ? vehiculos[rivalId] : null;
        if (!path || !a || !b || !dest || !dest.socketId || dest.id === origen.id) {
            if (typeof ack === "function") ack({ ok: false, error: "Esa persona no está conectada." });
            return;
        }
        if (carreraDeJugador(origen.id) || carreraDeJugador(dest.id)) {
            if (typeof ack === "function") ack({ ok: false, error: "Alguien ya está en una carrera." });
            return;
        }
        if (desafioDeJugador(origen.id) || desafiosCarrera[dest.id] || inviteCarreraPorHost[origen.id]) {
            if (typeof ack === "function") ack({ ok: false, error: "Ya hay un desafío en curso." });
            return;
        }
        borrarInviteDeHost(origen.id);
        const d = {
            de: origen.id,
            para: dest.id,
            path: path,
            a: a,
            b: b,
            km: Number.isFinite(km) ? Math.max(0.05, Math.min(5, km)) : 0,
            ts: Date.now()
        };
        desafiosCarrera[dest.id] = d;
        emitirAJugador(dest.id, "carreraInvitacion", {
            de: origen.id,
            nombre: (origen.nombre && String(origen.nombre).trim()) || "Invitado",
            vehiculo: origen.vehiculo || "",
            km: d.km,
            path: path,
            a: a,
            b: b
        });
        if (typeof ack === "function") ack({ ok: true, rival: fichaCarrera(dest) });
    });

    socket.on("carreraInvitarLink", (payload, ack) => {
        const origen = vehiculoDeSocket(socket);
        const path = sanitizarPathCarrera(payload && payload.path);
        const a = sanitizarPuntoCarrera(payload && payload.a);
        const b = sanitizarPuntoCarrera(payload && payload.b);
        const km = Number(payload && payload.km);
        if (!origen) {
            if (typeof ack === "function") ack({ ok: false, error: "Sin conexión." });
            return;
        }
        if (!rateOk(ultimoCarreraTs, socket.id, 800)) {
            if (typeof ack === "function") ack({ ok: false, error: "Esperá un segundo." });
            return;
        }
        if (!path || !a || !b) {
            if (typeof ack === "function") ack({ ok: false, error: "Falta el circuito." });
            return;
        }
        if (carreraDeJugador(origen.id) || desafioDeJugador(origen.id)) {
            if (typeof ack === "function") ack({ ok: false, error: "Ya hay un desafío en curso." });
            return;
        }
        borrarInviteDeHost(origen.id);
        const token = tokenCarreraNuevo();
        const ahora = Date.now();
        invitesCarreraLink[token] = {
            token: token,
            hostId: origen.id,
            path: path,
            a: a,
            b: b,
            km: Number.isFinite(km) ? Math.max(0.05, Math.min(5, km)) : 0,
            ts: ahora,
            exp: ahora + CARRERA_LINK_TTL_MS,
            nombreHost: (origen.nombre && String(origen.nombre).trim()) || "Invitado"
        };
        inviteCarreraPorHost[origen.id] = token;
        if (typeof ack === "function") {
            ack({
                ok: true,
                token: token,
                exp: ahora + CARRERA_LINK_TTL_MS,
                nombreHost: invitesCarreraLink[token].nombreHost
            });
        }
    });

    socket.on("carreraUnirseLink", (payload, ack) => {
        const yo = vehiculoDeSocket(socket);
        const token = sanitizarTexto(payload && payload.token, 40);
        const rec = recInviteCarrera(token);
        if (!yo) {
            if (typeof ack === "function") ack({ ok: false, error: "Esperá a estar en el mapa." });
            return;
        }
        if (!rec) {
            if (typeof ack === "function") ack({ ok: false, error: "Ese desafío ya no está. Pedile un link nuevo." });
            return;
        }
        if (rec.hostId === yo.id) {
            if (typeof ack === "function") ack({ ok: false, error: "Ese link lo creaste vos." });
            return;
        }
        if (carreraDeJugador(yo.id) || carreraDeJugador(rec.hostId)) {
            if (typeof ack === "function") ack({ ok: false, error: "Alguien ya está en una carrera." });
            return;
        }
        if (desafiosCarrera[yo.id] || desafioDeJugador(yo.id)) {
            if (typeof ack === "function") ack({ ok: false, error: "Ya tenés un desafío en curso." });
            return;
        }
        const host = vehiculos[rec.hostId];
        if (!host || !host.socketId) {
            borrarInviteCarrera(token, "no_disponible");
            if (typeof ack === "function") ack({ ok: false, error: "Quien te desafió ya no está conectado." });
            return;
        }
        const prev = Object.keys(desafiosCarrera).find(function (para) {
            const d = desafiosCarrera[para];
            return d && d.linkToken === token;
        });
        if (prev && prev !== yo.id) {
            if (typeof ack === "function") ack({ ok: false, error: "Alguien más ya abrió este desafío." });
            return;
        }
        const d = {
            de: rec.hostId,
            para: yo.id,
            path: rec.path,
            a: rec.a,
            b: rec.b,
            km: rec.km,
            ts: Date.now(),
            linkToken: token,
            link: true
        };
        desafiosCarrera[yo.id] = d;
        const invitacion = {
            de: rec.hostId,
            nombre: rec.nombreHost || (host.nombre && String(host.nombre).trim()) || "Invitado",
            vehiculo: host.vehiculo || "",
            km: d.km,
            path: d.path,
            a: d.a,
            b: d.b,
            link: true
        };
        emitirAJugador(yo.id, "carreraInvitacion", invitacion);
        emitirAJugador(rec.hostId, "carreraLinkListo", { rival: fichaCarrera(yo) });
        if (typeof ack === "function") ack({ ok: true, invitacion: invitacion });
    });

    socket.on("carreraResponder", (payload, ack) => {
        const yo = vehiculoDeSocket(socket);
        if (!yo) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        const d = desafiosCarrera[yo.id];
        const aceptar = !!(payload && payload.aceptar);
        if (!d) {
            if (typeof ack === "function") ack({ ok: false, error: "El desafío ya no está." });
            return;
        }
        delete desafiosCarrera[yo.id];
        if (d.linkToken) borrarInviteCarrera(d.linkToken, null);
        const host = vehiculos[d.de];
        if (!aceptar) {
            emitirAJugador(d.de, "carreraCancelada", { motivo: "rechazo", de: yo.id });
            if (typeof ack === "function") ack({ ok: true, aceptar: false });
            return;
        }
        if (!host || !host.socketId || carreraDeJugador(d.de) || carreraDeJugador(yo.id)) {
            emitirAJugador(d.de, "carreraCancelada", { motivo: "no_disponible" });
            if (typeof ack === "function") ack({ ok: false, error: "No se pudo largar." });
            return;
        }
        const id = idCarreraNuevo();
        const tLargada = Date.now() + 3800;
        const c = {
            id: id,
            hostId: d.de,
            rivalId: yo.id,
            path: d.path,
            a: d.a,
            b: d.b,
            km: d.km,
            tLargada: tLargada,
            estado: "cuenta",
            ids: [d.de, yo.id],
            snapshots: {},
            ganador: null,
            cerrada: false
        };
        carreras1v1[id] = c;
        const inicio = {
            carreraId: id,
            path: d.path,
            a: d.a,
            b: d.b,
            km: d.km,
            tLargada: tLargada,
            host: fichaCarrera(host),
            rival: fichaCarrera(yo)
        };
        emitirAJugador(d.de, "carreraInicio", inicio);
        emitirAJugador(yo.id, "carreraInicio", inicio);
        if (typeof ack === "function") ack({ ok: true, aceptar: true, carreraId: id });
    });

    socket.on("carreraEstado", payload => {
        const yo = vehiculoDeSocket(socket);
        if (!yo || !payload) return;
        const c = carreras1v1[sanitizarTexto(payload.carreraId, 40)];
        if (!c || c.cerrada) return;
        if (c.hostId !== yo.id && c.rivalId !== yo.id) return;
        const otro = rivalDeCarrera(c, yo.id);
        const snap = {
            id: yo.id,
            s: Math.max(0, Math.min(1, Number(payload.s) || 0)),
            velKmh: Math.max(0, Math.min(160, Number(payload.velKmh) || 0)),
            lat: Number(payload.lat),
            lng: Number(payload.lng),
            rumbo: Number(payload.rumbo),
            fase: sanitizarTexto(payload.fase, 20),
            choques: Math.max(0, Math.min(3, Number(payload.choques) || 0)),
            choqueFx: sanitizarTexto(payload.choqueFx, 20) || null
        };
        c.snapshots[yo.id] = snap;
        emitirAJugador(otro, "carreraRival", snap);
        if (snap.fase === "meta" && !c.ganador) {
            c.ganador = yo.id;
            c.estado = "fin";
            emitirAJugador(yo.id, "carreraResultado", { carreraId: c.id, resultado: "ganaste", motivo: "meta" });
            emitirAJugador(otro, "carreraResultado", {
                carreraId: c.id,
                resultado: "perdiste",
                motivo: "meta",
                ganador: fichaCarrera(vehiculos[yo.id])
            });
        }
        if (snap.fase === "choque" && (snap.choqueFx === "explosion" || snap.choqueFx === "mecanico")) {
            emitirAJugador(otro, "carreraRivalChoque", {
                id: yo.id,
                carreraId: c.id,
                lat: snap.lat,
                lng: snap.lng,
                rumbo: snap.rumbo,
                choqueFx: snap.choqueFx
            });
        }
    });

    socket.on("carreraSalir", () => {
        const yo = vehiculoDeSocket(socket);
        if (!yo) return;
        borrarInviteDeHost(yo.id);
        const d = desafioDeJugador(yo.id);
        if (d) limpiarDesafioCarrera(d, "salio");
        const c = carreraDeJugador(yo.id);
        if (c) {
            const otro = rivalDeCarrera(c, yo.id);
            emitirAJugador(otro, "carreraResultado", {
                carreraId: c.id,
                resultado: "ganaste",
                motivo: "abandono"
            });
            cerrarCarrera1v1(c, "abandono", { abandono: yo.id });
        }
    });

    socket.on("fantasmaCrear", (payload, ack) => {
        const yo = vehiculoDeSocket(socket);
        if (!yo) {
            if (typeof ack === "function") ack({ ok: false, retry: true, error: "Esperá a estar en el mapa." });
            return;
        }
        const raw = payload && typeof payload === "object" ? payload : {};
        const tokenIn = sanitizarTexto(raw.token, 40);
        const hostKeyIn = sanitizarTexto(raw.hostKey, 40);
        let token = fantasmaPorHost[yo.id];
        let rec = recFantasmaVivo(token);
        if (!rec && tokenIn) rec = recFantasmaVivo(tokenIn);
        if (rec && !puedeReclamarFantasma(rec, yo, hostKeyIn)) rec = null;
        const reanudado = !!rec;
        if (!rec && !rateOk(ultimoCarreraTs, socket.id, 600)) {
            if (typeof ack === "function") ack({ ok: false, retry: true, error: "Esperá un segundo." });
            return;
        }
        if (!rec) {
            token = tokenFantasmaNuevo();
            rec = {
                token: token,
                hostKey: tokenFantasmaNuevo(),
                hostId: yo.id,
                socketId: socket.id,
                nombre: yo.nombre || "Alguien",
                exp: Date.now() + FANTASMA_TTL_MS
            };
            fantasmas[token] = rec;
            fantasmaPorHost[yo.id] = token;
        } else {
            if (rec.hostId && rec.hostId !== yo.id && fantasmaPorHost[rec.hostId] === rec.token) {
                delete fantasmaPorHost[rec.hostId];
            }
            rec.hostId = yo.id;
            rec.socketId = socket.id;
            rec.nombre = yo.nombre || rec.nombre;
            if (!rec.hostKey) rec.hostKey = tokenFantasmaNuevo();
            rec.exp = Date.now() + FANTASMA_TTL_MS;
            if (rec.corteTimer) {
                clearTimeout(rec.corteTimer);
                rec.corteTimer = null;
            }
            fantasmaPorHost[yo.id] = rec.token;
            token = rec.token;
            avisarPausaFantasma(rec, false);
        }
        vincularSocketAFantasma(socket, rec);
        const semilla = vistaDesdeVehiculoFantasma(yo, rec);
        if (semilla) guardarVistaFantasma(rec, Object.assign({}, semilla, { vivo: true }));
        if (reanudado && rec.ultimaVista) {
            emitirVistaSalaFantasma(rec, Object.assign({}, rec.ultimaVista, { vivo: true }));
        }
        if (typeof ack === "function") {
            ack({ ok: true, token: token, hostKey: rec.hostKey, exp: rec.exp, reanudado: reanudado });
        }
    });

    socket.on("fantasmaCortar", (_payload, ack) => {
        const yo = vehiculoDeSocket(socket);
        if (yo) cortarFantasma(recFantasmaVivo(fantasmaPorHost[yo.id]), "cortado");
        if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("fantasmaUnirse", (payload, ack) => {
        const token = sanitizarTexto(payload && payload.token, 40);
        const rec = recFantasmaVivo(token);
        if (!rec) {
            if (typeof ack === "function") ack({ ok: false, error: "Ese fantasma ya no está al aire." });
            return;
        }
        socket.fantasmaToken = token;
        socket.fantasmaNombre = sanitizarTexto(payload && payload.nombre, 40);
        socket.join(salaFantasma(token));
        asegurarHostEnSalaFantasma(rec);
        const host = rec.hostId ? vehiculos[rec.hostId] : null;
        const vista = vistaDesdeVehiculoFantasma(host, rec) || rec.ultimaVista || null;
        if (vista) {
            vista.vivo = !!rec.socketId;
            guardarVistaFantasma(rec, vista);
        }
        if (typeof ack === "function") {
            ack({
                ok: true,
                nombre: (vista && vista.nombre) || rec.nombre || "Alguien",
                exp: rec.exp,
                pausa: !rec.socketId,
                vista: vista
            });
        }
        if (vista) socket.emit("fantasmaVista", vista);
    });

    socket.on("fantasmaVista", payload => {
        const yo = vehiculoDeSocket(socket);
        if (!yo) return;
        const token = fantasmaPorHost[yo.id];
        const rec = recFantasmaVivo(token);
        if (!rec) return;
        if (!rateOk(ultimoFantasmaVistaTs, socket.id, 180)) return;
        const vista = sanitizarVistaFantasma(payload);
        if (!vista) return;
        vista.nombre = yo.nombre || vista.nombre;
        vista.vehiculo = yo.vehiculo || vista.vehiculo;
        vista.iconoX = sanitizarEntero(yo.iconoX, 0, 64, vista.iconoX || 0);
        vista.iconoY = sanitizarEntero(yo.iconoY, 0, 64, vista.iconoY || 0);
        vista.vivo = true;
        rec.nombre = vista.nombre;
        rec.ultimaVista = vista;
        vincularSocketAFantasma(socket, rec);
        socket.to(salaFantasma(token)).emit("fantasmaVista", vista);
    });

    socket.on("audioFantasma", (payload, ack) => {
        const token = tokenFantasmaDeSocket(socket);
        const rec = recFantasmaVivo(token);
        const audio = payload && payload.audio;
        const bytes = tamanioAudio(audio);
        if (!rec || bytes < 200 || bytes > 400000 || !rateOk(ultimoAudioTs, socket.id, minMsAudio())) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        const yo = vehiculoDeSocket(socket);
        const claimed = sanitizarTexto(payload && payload.id, 64);
        const de = (yo && yo.id) || (/^v[a-z0-9]+$/i.test(claimed) ? claimed : socket.id);
        const nombre = sanitizarTexto(
            (yo && yo.nombre) || (payload && payload.nombre) || socket.fantasmaNombre,
            40
        ) || "Alguien";
        const paquete = {
            de: de,
            nombre: nombre,
            mime: sanitizarTexto(payload.mime, 40) || "audio/webm",
            texto: sanitizarTexto(payload.texto, 500),
            audio: audio,
            ts: Date.now(),
            canal: "fantasma"
        };
        const sala = salaFantasma(token);
        const hostSock = socketHostFantasma(rec) || ((yo && rec.hostId === yo.id) ? socket : null);
        const hostAparte = !!(hostSock && hostSock.id !== socket.id);
        const hostYaEnSala = !!(hostAparte && hostSock.rooms && hostSock.rooms.has(sala));
        socket.to(sala).emit("audioFantasma", paquete);
        if (hostAparte && !hostYaEnSala) {
            hostSock.emit("audioFantasma", paquete);
        }
        if (hostSock) vincularSocketAFantasma(hostSock, rec);
        if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("disconnect", () => {
        const id = socketAVehiculo[socket.id];
        delete socketAVehiculo[socket.id];
        delete ultimoAudioTs[socket.id];
        delete ultimoMsgTs[socket.id];
        if (!id || !vehiculos[id]) return;

        const v = vehiculos[id];
        const restantes = socketsDelVehiculo(id);
        if (restantes.length) {
            v.socketId = restantes[0];
            v.ausente = false;
            return;
        }
        v.socketId = null;
        v.ausente = true;
        aplicarVisibilidad(v, v.vistoPor ? v.vistoPor.slice() : []);
        borrarInviteDeHost(id);
        const d = desafioDeJugador(id);
        if (d) limpiarDesafioCarrera(d, "desconexion");
        const c = carreraDeJugador(id);
        if (c) {
            const otro = rivalDeCarrera(c, id);
            emitirAJugador(otro, "carreraResultado", {
                carreraId: c.id,
                resultado: "ganaste",
                motivo: "desconexion"
            });
            cerrarCarrera1v1(c, "desconexion");
        }
        const fan = fantasmas[fantasmaPorHost[id]];
        if (fan) {
            fan.socketId = null;
            if (fan.corteTimer) {
                clearTimeout(fan.corteTimer);
                fan.corteTimer = null;
            }
            avisarPausaFantasma(fan, true);
        }
    });
});

setInterval(() => {
    const ahora = Date.now();
    Object.keys(vehiculos).forEach(id => {
        const v = vehiculos[id];
        if (!v) return;
        const age = ahora - v.ultimaActualizacion;
        if (age > BORRAR_MS) {
            emitirASalas(salasDeVehiculo(v), "vehiculo_desconectado", id);
            if (escala.activo()) escala.publicar("borrar", id);
            sacarDeCelda(v);
            sacarDeGrupoVivo(id, v.grupo);
            delete vehiculos[id];
            return;
        }
        if (age > AUSENTE_MS && !v.ausente) {
            v.ausente = true;
            aplicarVisibilidad(v, v.vistoPor ? v.vistoPor.slice() : []);
        }
    });
    Object.keys(desafiosCarrera).forEach(function (para) {
        const d = desafiosCarrera[para];
        if (!d) return;
        const limite = d.link ? 90000 : 28000;
        if (ahora - d.ts > limite) limpiarDesafioCarrera(d, "timeout");
    });
    Object.keys(invitesCarreraLink).forEach(function (token) {
        const rec = invitesCarreraLink[token];
        if (rec && ahora > rec.exp) borrarInviteCarrera(token, "expiro");
    });
    Object.keys(fantasmas).forEach(function (token) {
        const rec = fantasmas[token];
        if (rec && ahora > rec.exp) cortarFantasma(rec, "expiro");
    });
}, 5000);

async function migrarJsonASql() {
    if (!dbSql.activo()) return;
    const codigos = Object.keys(gruposReg);
    let i;
    for (i = 0; i < codigos.length; i++) {
        const codigo = codigos[i];
        const g = gruposReg[codigo];
        await dbSql.upsertGrupo(codigo, g && g.nombre);
        const miembros = (g && g.miembros) || {};
        const ids = Object.keys(miembros);
        let j;
        for (j = 0; j < ids.length; j++) {
            await dbSql.upsertMiembro(codigo, {
                id: ids[j],
                nombre: miembros[ids[j]].nombre || "",
                grupoNombre: g.nombre || ""
            });
        }
    }
    const lista = listaEncuentrosDisco();
    for (i = 0; i < lista.length; i++) await dbSql.upsertEncuentro(lista[i]);
}

async function cargarDesdeSql() {
    if (!dbSql.activo()) return false;
    const g = await dbSql.leerGrupos();
    const hayGrupos = g && Object.keys(g).length;
    if (hayGrupos) {
        Object.keys(g).forEach(function (c) {
            gruposReg[c] = g[c];
        });
    }
    const enc = await dbSql.leerEncuentros();
    if (enc && enc.length) {
        enc.forEach(function (e) {
            if (!e || !e.id || !Number.isFinite(Number(e.lat)) || !Number.isFinite(Number(e.lng))) return;
            encuentros[e.id] = e;
        });
    }
    if (!hayGrupos && Object.keys(gruposReg).length) await migrarJsonASql();
    else if (hayGrupos && listaEncuentrosDisco().length && !(enc && enc.length)) await migrarJsonASql();
    return true;
}

async function arrancar() {
    const puerto = Number(process.env.PORT || 3000) || 3000;
    puertoActivo = puerto;
    await new Promise(function (resolve, reject) {
        server.listen(puerto, "0.0.0.0", function () {
            const addr = server.address();
            puertoActivo = addr && addr.port ? addr.port : puerto;
            console.log("Servidor V2V corriendo en 0.0.0.0:" + puertoActivo);
            resolve();
        });
        server.once("error", reject);
    });
    try {
        const ok = await dbSql.conectar();
        if (ok) {
            console.log("SQL Server conectado: 001_v2v_gps");
            try {
                await cargarDesdeSql();
            } catch (err) {
                console.error("No se pudo leer SQL Server:", err.message);
            }
        } else {
            console.log("SQL Server no disponible; se usa JSON en data/.");
        }
    } catch (err) {
        console.error("SQL Server omitido:", err && err.message ? err.message : err);
    }
    try {
        await escala.conectar(io, { onUpsert: aplicarRemoto, onBorrar: borrarRemoto });
    } catch (err) {
        console.error("Redis omitido:", err && err.message ? err.message : err);
    }
}

arrancar().catch(function (err) {
    console.error("No se pudo abrir el puerto:", err && err.message ? err.message : err);
    process.exit(1);
});
