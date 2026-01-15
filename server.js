// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static('public'));

// Estructuras de datos
const autos = {};            // socket.id → datos de telemetría

// Cola y throttle para telemetría global
let ultimoEmitTimeout = null;

function emitirTelemetriaGlobal() {
    if (ultimoEmitTimeout) clearTimeout(ultimoEmitTimeout);

    ultimoEmitTimeout = setTimeout(() => {
        console.log(`[TELE GLOBAL] Emitiendo (${Object.keys(autos).length} vehículos)`);
        io.emit('telemetria_global', { ...autos });
        ultimoEmitTimeout = null;
    }, 800);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor iniciado en http://localhost:${PORT} — ${new Date().toLocaleString('es-AR')}`);
});

io.on('connection', (socket) => {
    console.log(`[CONN] Nuevo socket: ${socket.id}`);

    // Enviar estado actual a quien se acaba de conectar
    socket.emit('telemetria_global', autos);

    // 1. Actualización de posición y datos del vehículo
    socket.on('telemetria', (data) => {
        if (!data?.lat || !data?.lng) {
            console.warn('[TELE] Ignorada - sin coordenadas para socket', socket.id);
            return;
        }

        // Actualizamos o creamos
        autos[socket.id] = {
            ...data,
            id: socket.id,
            ultimaActualizacion: Date.now()
        };

        emitirTelemetriaGlobal();
    });

    // 2. Mensaje general (broadcast con fromSocketId y fromName)
    socket.on('general message', (data) => {
        if (!data?.text?.trim()) return;

        const msg = {
            text: data.text.trim(),
            fromSocketId: socket.id,
            fromName: data.fromName || 'Anónimo',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        console.log(`[GENERAL] ${msg.fromName} (${socket.id}): ${msg.text}`);

        io.emit('general message', msg);
    });

    // 3. Mensaje privado
    socket.on('private message', ({ toSocketId, text }) => {
        if (!toSocketId || !text?.trim()) {
            console.warn("[PRIVATE] Mensaje inválido", { toSocketId, text });
            return;
        }

        const msg = {
            fromSocketId: socket.id,
            text: text.trim(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        console.log(`[PRIVATE] ${socket.id} → ${toSocketId} : ${msg.text}`);

        // Enviamos al destinatario
        io.to(toSocketId).emit('private message', msg);

        // Eco al emisor
        socket.emit('private message', msg);
    });

    // Desconexión - limpieza
    socket.on('disconnect', () => {
        console.log(`[DISCONN] Socket desconectado: ${socket.id}`);

        if (autos[socket.id]) {
            delete autos[socket.id];
            emitirTelemetriaGlobal();
        }
    });
});