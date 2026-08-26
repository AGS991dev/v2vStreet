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

function proxyOsrm(res, ruta) {
    const reqUp = https.get("https://router.project-osrm.org" + ruta, {
        headers: { "User-Agent": "v2vstreet/1.0" },
        timeout: 8000
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

function perfilOsrm(raw) {
    const p = String(raw || "driving").toLowerCase();
    if (p === "foot" || p === "walking" || p === "pie") return "walking";
    return "driving";
}

app.get("/api/osrm/nearest", (req, res) => {
    const par = parLngLat(req.query.lnglat);
    if (!par) return res.status(400).json({ code: "Error" });
    const perfil = perfilOsrm(req.query.perfil);
    proxyOsrm(res, "/nearest/v1/" + perfil + "/" + par + "?number=1");
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
    proxyOsrm(res, "/route/v1/" + perfil + "/" + from + ";" + to + "?overview=full&geometries=geojson" + extra);
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

const dbSql = require("./lib/sql");
const ultimoSqlUsuario = {};
let puertoActivo = Number(process.env.PORT || 3000) || 3000;

const AUSENTE_MS = 18000;
const BORRAR_MS = 90000;
const ENC_FILE = path.join(__dirname, "data", "encuentros.json");
const GRUPOS_FILE = path.join(__dirname, "data", "grupos.json");

// vehiculoId persistente -> datos
const vehiculos = {};
// socket.id -> vehiculoId
const socketAVehiculo = {};
const ultimoAudioTs = {};
const ultimoMsgTs = {};
const encuentros = {};

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
    prev.forEach(function (sala) {
        if (next.indexOf(sala) >= 0) return;
        if (vehiculo.socketId) io.to(sala).except(vehiculo.socketId).emit("vehiculo_desconectado", vehiculo.id);
        else io.to(sala).emit("vehiculo_desconectado", vehiculo.id);
    });
    emitirASalas(next, "telemetria", Object.assign(publicoDe(vehiculo, false), {
        enGrupo: false,
        grupo: vehiculo.grupo || ""
    }), vehiculo.socketId);
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

function emitirASalas(salas, evento, payload, exceptoSid) {
    const limpio = [];
    const visto = {};
    (salas || []).forEach(function (s) {
        if (!s || visto[s]) return;
        visto[s] = true;
        limpio.push(s);
    });
    if (!limpio.length) return;
    let n = io.to(limpio);
    if (exceptoSid) n = n.except(exceptoSid);
    n.emit(evento, payload);
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

function idOcupado(id, socketId) {
    const v = vehiculos[id];
    if (!v || !v.socketId || v.socketId === socketId) return false;
    return io.sockets.sockets.has(v.socketId);
}

function resolverId(socket, claimed) {
    const actual = socketAVehiculo[socket.id];
    if (actual) return actual;
    let id = sanitizarTexto(claimed, 64);
    if (!/^v[a-z0-9]+$/i.test(id) || idOcupado(id, socket.id)) {
        id = "v" + socket.id.replace(/[^a-z0-9]/gi, "").slice(0, 18);
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

io.on("connection", socket => {
    socket.join("rm:all");
    socket.emit("telemetria_global", {});

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

        if (prev && !socketCambio && radioAntes === radioKm && grupoAntes === grupo) {
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
            v.nombre = sanitizarTexto(raw.nombre, 40);
            v.vehiculo = sanitizarTexto(raw.vehiculo, 40);
            if (raw.placa) v.placa = sanitizarTexto(raw.placa, 20);
            if (raw.seguro) v.seguro = sanitizarTexto(raw.seguro, 40);
            if (raw.contacto) v.contacto = sanitizarTexto(raw.contacto, 40);
            v.iconoX = sanitizarEntero(raw.iconoX, 0, 64, 0);
            v.iconoY = sanitizarEntero(raw.iconoY, 0, 64, 0);
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

        ponerEnCelda(v);
        ponerEnGrupoVivo(v);
        unirSalas(socket, v);
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
        const yo = vehiculoDeSocket(socket);
        if (!codigo || !yo) {
            if (typeof ack === "function") ack({ ok: false, error: "Código inválido o todavía no hay GPS." });
            return;
        }
        const nombreIn = sanitizarNombreGrupo(payload && payload.nombre);
        if (nombreIn) asegurarGrupo(codigo, nombreDeGrupo(codigo) ? "" : nombreIn);
        else asegurarGrupo(codigo, "");
        const nombre = nombreDeGrupo(codigo) || "";
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
    });

    socket.on("mensajePrivado", payload => {
        if (!rateOk(ultimoMsgTs, socket.id, 250)) return;
        const destinoId = sanitizarTexto(payload && payload.id, 64);
        const mensaje = sanitizarTexto(payload && payload.mensaje, 500);
        if (!destinoId || !mensaje) return;

        const dest = vehiculos[destinoId];
        const origen = vehiculoDeSocket(socket);
        if (!dest || !dest.socketId || !origen) return;
        if (!puedeVer(origen, dest) && !puedeVer(dest, origen)) return;

        io.to(dest.socketId).emit("mensajePrivado", {
            de: origen.id,
            nombre: origen.nombre || "Anónimo",
            mensaje: mensaje,
            ts: Date.now()
        });
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
        if (!dest || !dest.socketId || !origen || (!puedeVer(origen, dest) && !puedeVer(dest, origen))) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        const meta = metaEmisor(socket);
        io.to(dest.socketId).emit("audioPrivado", {
            de: meta.de,
            nombre: meta.nombre,
            mime: sanitizarTexto(payload.mime, 40) || "audio/webm",
            texto: sanitizarTexto(payload.texto, 500),
            audio: audio,
            ts: Date.now()
        });
        if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("disconnect", () => {
        const id = socketAVehiculo[socket.id];
        delete socketAVehiculo[socket.id];
        delete ultimoAudioTs[socket.id];
        delete ultimoMsgTs[socket.id];
        if (!id || !vehiculos[id]) return;

        const v = vehiculos[id];
        if (v.socketId !== socket.id) return;
        v.socketId = null;
        v.ausente = true;
        aplicarVisibilidad(v, v.vistoPor ? v.vistoPor.slice() : []);
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
