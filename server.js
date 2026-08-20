// ===================================================
// V2V - SERVIDOR DE COMUNICACIÓN VEHICULAR
// Archivo: server.js
// ===================================================

"use strict";

const express = require("express");
const http = require("http");
const https = require("https");
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

app.get("/api/osrm/nearest", (req, res) => {
    const par = parLngLat(req.query.lnglat);
    if (!par) return res.status(400).json({ code: "Error" });
    proxyOsrm(res, "/nearest/v1/driving/" + par + "?number=1");
});

app.get("/api/osrm/ruta", (req, res) => {
    const from = parLngLat(req.query.from);
    const to = parLngLat(req.query.to);
    if (!from || !to) return res.status(400).json({ code: "Error" });
    proxyOsrm(res, "/route/v1/driving/" + from + ";" + to + "?overview=full&geometries=geojson&continue_straight=true");
});

const PORT = process.env.PORT || 3000;

// vehiculoId persistente -> datos
const vehiculos = {};
// socket.id -> vehiculoId
const socketAVehiculo = {};

function sanitizarTexto(valor, max) {
    return String(valor || "").trim().slice(0, max);
}

function sanitizarEntero(valor, min, max, def) {
    const n = parseInt(valor, 10);
    if (!Number.isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
}

function publicarEstado() {
    io.emit("telemetria_global", vehiculos);
}

function emitirVehiculo(vehiculo) {
    io.emit("telemetria", vehiculo);
}

function tamanioAudio(audio) {
    if (!audio) return 0;
    if (Buffer.isBuffer(audio)) return audio.length;
    if (audio.byteLength) return audio.byteLength;
    if (audio.length) return audio.length;
    return 0;
}

function metaEmisor(socket) {
    const de = socketAVehiculo[socket.id];
    const v = de ? vehiculos[de] : null;
    return {
        de: de || socket.id,
        nombre: (v && v.nombre) || "Anónimo"
    };
}

io.on("connection", socket => {
    socket.emit("telemetria_global", vehiculos);

    socket.on("telemetria", data => {
        const raw = data && typeof data === "object" ? data : {};
        const id = sanitizarTexto(raw.id, 64) || socket.id;

        socketAVehiculo[socket.id] = id;

        const lat = Number(raw.lat);
        const lng = Number(raw.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

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
            ultimaActualizacion: Date.now()
        };

        emitirVehiculo(vehiculos[id]);
    });

    socket.on("mensajeV2V", payload => {
        const texto = sanitizarTexto(
            typeof payload === "string" ? payload : payload && payload.texto,
            500
        );
        if (!texto) return;

        const de = socketAVehiculo[socket.id];
        const v = de ? vehiculos[de] : null;

        io.emit("mensajeV2V", {
            de: de || socket.id,
            nombre: (v && v.nombre) || "Anónimo",
            texto: texto,
            ts: Date.now()
        });
    });

    socket.on("mensajePrivado", payload => {
        const destinoId = sanitizarTexto(payload && payload.id, 64);
        const mensaje = sanitizarTexto(payload && payload.mensaje, 500);
        if (!destinoId || !mensaje) return;

        const dest = vehiculos[destinoId];
        if (!dest || !dest.socketId) return;

        const de = socketAVehiculo[socket.id];
        const origen = de ? vehiculos[de] : null;

        io.to(dest.socketId).emit("mensajePrivado", {
            de: de || socket.id,
            nombre: (origen && origen.nombre) || "Anónimo",
            mensaje: mensaje,
            ts: Date.now()
        });
    });

    socket.on("audioV2V", (payload, ack) => {
        const audio = payload && payload.audio;
        const bytes = tamanioAudio(audio);
        if (bytes < 200 || bytes > 400000) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        const meta = metaEmisor(socket);
        socket.broadcast.emit("audioV2V", {
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
        if (!destinoId || bytes < 200 || bytes > 400000) {
            if (typeof ack === "function") ack({ ok: false });
            return;
        }
        const dest = vehiculos[destinoId];
        if (!dest || !dest.socketId) {
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
        if (!id || !vehiculos[id]) return;

        // Gracia breve: si reconecta con el mismo id, no parpadea en el mapa
        const socketQueSeFue = socket.id;
        setTimeout(() => {
            if (vehiculos[id] && vehiculos[id].socketId === socketQueSeFue) {
                delete vehiculos[id];
                io.emit("vehiculo_desconectado", id);
            }
        }, 4000);
    });
});

// Limpia vehículos colgados (sin telemetría)
setInterval(() => {
    const ahora = Date.now();
    Object.keys(vehiculos).forEach(id => {
        if (ahora - vehiculos[id].ultimaActualizacion > 25000) {
            delete vehiculos[id];
            io.emit("vehiculo_desconectado", id);
        }
    });
}, 8000);

server.listen(PORT, () => {
    console.log("Servidor V2V corriendo en puerto:", PORT);
});
