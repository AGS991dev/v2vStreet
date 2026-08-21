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
app.use(express.static("public"));

const RADIO_MIN = 1;
const RADIO_MAX = 50;
const RADIO_DEF = 5;

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

const PORT = process.env.PORT || 3000;

const AUSENTE_MS = 18000;
const BORRAR_MS = 90000;
const ENC_FILE = path.join(__dirname, "data", "encuentros.json");

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
                ts: Number(e.ts) || Date.now()
            };
        });
    } catch (err) {
        if (err && err.code !== "ENOENT") console.error("No se pudieron leer los encuentros:", err.message);
    }
}

let guardarEncTimer = null;
function guardarEncuentrosDisco() {
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

function sanitizarTexto(valor, max) {
    return String(valor || "").trim().slice(0, max);
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

function publicoDe(v) {
    if (!v) return null;
    return {
        id: v.id,
        nombre: v.nombre,
        vehiculo: v.vehiculo,
        iconoX: v.iconoX,
        iconoY: v.iconoY,
        lat: v.lat,
        lng: v.lng,
        velocidad: v.velocidad,
        rumbo: v.rumbo,
        precision: v.precision,
        ultimaActualizacion: v.ultimaActualizacion,
        grupo: v.grupo || "",
        asistencia: v.asistencia || null,
        ausente: !!v.ausente
    };
}

function publicoEncuentro(e) {
    if (!e) return null;
    return {
        id: e.id,
        lat: e.lat,
        lng: e.lng,
        nombre: e.nombre,
        horario: e.horario || "",
        descripcion: e.descripcion || "",
        de: e.de,
        grupo: e.grupo || ""
    };
}

function puedeVerEncuentro(oyente, e) {
    if (!oyente || !e) return false;
    if (e.de && e.de === oyente.id) return true;
    if (e.grupo && oyente.grupo && e.grupo === oyente.grupo) return true;
    return kmEntre(oyente, e) <= radioDe(oyente);
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
    const r = [];
    Object.keys(vehiculos).forEach(id => {
        const o = vehiculos[id];
        if (o && o.socketId && puedeVerEncuentro(o, e)) r.push(o.socketId);
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

function socketsQueVen(objetivo) {
    const r = [];
    Object.keys(vehiculos).forEach(id => {
        const o = vehiculos[id];
        if (o && o.socketId && puedeVer(o, objetivo)) r.push(o.socketId);
    });
    return r;
}

function snapshotPara(oyente) {
    const estado = {};
    if (!oyente) return estado;
    Object.keys(vehiculos).forEach(id => {
        const v = vehiculos[id];
        if (!puedeVer(oyente, v)) return;
        estado[id] = Object.assign(publicoDe(v), { enGrupo: mismoGrupo(oyente, v) });
    });
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

function aplicarVisibilidad(vehiculo, prevSockets) {
    if (!vehiculo) return [];
    const next = socketsQueVen(vehiculo);
    const nextSet = {};
    next.forEach(sid => { nextSet[sid] = true; });
    (prevSockets || []).forEach(sid => {
        if (!nextSet[sid]) io.to(sid).emit("vehiculo_desconectado", vehiculo.id);
    });
    const pub = publicoDe(vehiculo);
    next.forEach(sid => {
        const oyente = oyentePorSocket(sid);
        io.to(sid).emit("telemetria", Object.assign({}, pub, {
            enGrupo: mismoGrupo(oyente, vehiculo)
        }));
    });
    vehiculo.vistoPor = next;
    return next;
}

function destinosRadio(emisor) {
    const r = [];
    if (!emisor) return r;
    Object.keys(vehiculos).forEach(id => {
        const v = vehiculos[id];
        if (v && v.socketId && puedeHablarRadio(emisor, v)) r.push(v.socketId);
    });
    return r;
}

function destinosGrupo(emisor) {
    const r = [];
    if (!emisor || !emisor.grupo) return r;
    Object.keys(vehiculos).forEach(id => {
        const v = vehiculos[id];
        if (v && v.socketId && v.id !== emisor.id && mismoGrupo(emisor, v)) r.push(v.socketId);
    });
    return r;
}

function destinosCanal(emisor) {
    if (emisor && emisor.grupo) return destinosGrupo(emisor);
    return destinosRadio(emisor);
}

function destinosAsistencia(emisor) {
    const r = destinosRadio(emisor).slice();
    destinosGrupo(emisor).forEach(sid => {
        if (r.indexOf(sid) < 0) r.push(sid);
    });
    return r;
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

io.on("connection", socket => {
    socket.emit("telemetria_global", {});

    socket.on("telemetria", data => {
        const raw = data && typeof data === "object" ? data : {};
        const id = resolverId(socket, raw.id);

        const lat = Number(raw.lat);
        const lng = Number(raw.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const prev = vehiculos[id];
        const prevSockets = prev && prev.vistoPor ? prev.vistoPor.slice() : [];
        const radioAntes = prev ? prev.radioKm : null;
        const grupoAntes = prev ? prev.grupo : "";
        const eraNuevo = !prev;
        const socketCambio = !prev || prev.socketId !== socket.id;

        const grupo = normalizarGrupo(raw.grupo);
        const radioKm = sanitizarEntero(raw.radioKm, RADIO_MIN, RADIO_MAX, RADIO_DEF);

        vehiculos[id] = {
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
            precision: Number(raw.precision) || null,
            radioKm: radioKm,
            grupo: grupo,
            asistencia: prev && prev.asistencia ? prev.asistencia : null,
            vistoPor: prevSockets,
            ultimaActualizacion: Date.now(),
            ausente: false
        };

        aplicarVisibilidad(vehiculos[id], prevSockets);
        if (eraNuevo || radioAntes !== radioKm || grupoAntes !== grupo || socketCambio) {
            socket.emit("telemetria_global", snapshotPara(vehiculos[id]));
            socket.emit("grupoEstado", { codigo: grupo });
            emitirEncuentrosA(vehiculos[id]);
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
        if (typeof ack === "function") ack(res);
        else if (res.ok) socket.emit("fichaDetalle", res);
    });

    socket.on("grupoCrear", (_payload, ack) => {
        const codigo = crearCodigoGrupo();
        const yo = vehiculoDeSocket(socket);
        if (yo) {
            const prev = yo.vistoPor ? yo.vistoPor.slice() : [];
            yo.grupo = codigo;
            socket.emit("telemetria_global", snapshotPara(yo));
            aplicarVisibilidad(yo, prev);
        }
        const res = { ok: true, codigo: codigo };
        if (typeof ack === "function") ack(res);
        socket.emit("grupoEstado", { codigo: codigo });
        if (yo) emitirEncuentrosA(vehiculos[yo.id] || yo);
    });

    socket.on("grupoUnirse", (payload, ack) => {
        const codigo = normalizarGrupo(payload && (payload.codigo || payload));
        const yo = vehiculoDeSocket(socket);
        if (!codigo || !yo) {
            if (typeof ack === "function") ack({ ok: false, error: "Código inválido o todavía no hay GPS." });
            return;
        }
        const prev = yo.vistoPor ? yo.vistoPor.slice() : [];
        yo.grupo = codigo;
        socket.emit("telemetria_global", snapshotPara(yo));
        aplicarVisibilidad(yo, prev);
        if (typeof ack === "function") ack({ ok: true, codigo: codigo });
        socket.emit("grupoEstado", { codigo: codigo });
        emitirEncuentrosA(yo);
    });

    socket.on("grupoSalir", (_payload, ack) => {
        const yo = vehiculoDeSocket(socket);
        if (yo) {
            const prev = yo.vistoPor ? yo.vistoPor.slice() : [];
            yo.grupo = "";
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
        const e = {
            id: id,
            lat: lat,
            lng: lng,
            nombre: sanitizarTexto(raw.nombre, 40) || "Encuentro",
            horario: sanitizarTexto(raw.horario, 40),
            descripcion: sanitizarTexto(raw.descripcion, 200),
            de: yo.id,
            grupo: yo.grupo || "",
            ts: Date.now()
        };
        encuentros[id] = e;
        guardarEncuentrosDisco();
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
        const destinos = destinosAsistencia(yo);
        emitirA(destinos, "asistencia", msg);
        socket.emit("asistencia", msg);
        aplicarVisibilidad(yo, yo.vistoPor ? yo.vistoPor.slice() : []);
        if (activo) {
            const aviso = {
                de: yo.id,
                nombre: yo.nombre || "Anónimo",
                texto: "Necesito ayuda. Estoy parado en ruta.",
                ts: Date.now(),
                asistencia: true
            };
            emitirA(destinos, "mensajeV2V", aviso);
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
        const msg = {
            de: (v && v.id) || socket.id,
            nombre: (v && v.nombre) || "Anónimo",
            texto: texto,
            ts: Date.now(),
            grupo: !!(v && v.grupo)
        };
        socket.emit("mensajeV2V", msg);
        emitirA(destinosCanal(v), "mensajeV2V", msg);
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
        if (bytes < 200 || bytes > 400000 || !rateOk(ultimoAudioTs, socket.id, 800)) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        const v = vehiculoDeSocket(socket);
        const meta = metaEmisor(socket);
        emitirA(destinosCanal(v), "audioV2V", {
            de: meta.de,
            nombre: meta.nombre,
            mime: sanitizarTexto(payload.mime, 40) || "audio/webm",
            texto: sanitizarTexto(payload.texto, 500),
            audio: audio,
            ts: Date.now()
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
            emitirA(v.vistoPor || [], "vehiculo_desconectado", id);
            delete vehiculos[id];
            return;
        }
        if (age > AUSENTE_MS && !v.ausente) {
            v.ausente = true;
            aplicarVisibilidad(v, v.vistoPor ? v.vistoPor.slice() : []);
        }
    });
}, 5000);

server.listen(PORT, () => {
    console.log("Servidor V2V corriendo en puerto:", PORT);
});
