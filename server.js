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

    // 1. Registro de nombre
    socket.on('set username', (username) => {
        if (!username || typeof username !== 'string' || !username.trim()) {
            socket.emit('username error', 'Nombre inválido');
            return;
        }

        const cleanName = username.trim();

        // Guardamos el nombre asociado al socket
        socket.username = cleanName;

        console.log(`[USERNAME] ${cleanName} registrado para socket ${socket.id}`);

        socket.emit('username set', cleanName);

        // Notificar a los DEMÁS que alguien nuevo se unió
        socket.broadcast.emit('user joined', {
            socketId: socket.id,
            nombre: cleanName
        });

        // Opcional: reenviar telemetría global para que todos actualicen nombres
        emitirTelemetriaGlobal();
    });

    // Enviar estado actual a quien se acaba de conectar
    socket.emit('telemetria_global', autos);

    // 2. Actualización de posición y datos del vehículo
    socket.on('telemetria', (data) => {
        if (!data?.lat || !data?.lng) {
            console.warn('[TELE] Ignorada - sin coordenadas para socket', socket.id);
            return;
        }

        // Actualizamos o creamos
        autos[socket.id] = {
            ...data,
            id: socket.id,
            nombre: socket.username || data.nombre || 'Anónimo',
            ultimaActualizacion: Date.now()
        };

        emitirTelemetriaGlobal();
    });

    // 3. Mensaje general (broadcast con fromSocketId y fromName)
    socket.on('general message', (data) => {
        if (!data?.text?.trim()) return;

        const msg = {
            text: data.text.trim(),
            fromSocketId: socket.id,
            fromName: data.fromName || socket.username || 'Anónimo',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        console.log(`[GENERAL] ${msg.fromName} (${socket.id}): ${msg.text}`);

        io.emit('general message', msg);
    });

    // 4. Mensaje privado
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

    // 5. Desconexión - limpieza + notificación
    socket.on('disconnect', () => {
        console.log(`[DISCONN] Socket desconectado: ${socket.id}`);

        const nombre = socket.username || 'Anónimo';

        // Notificar a los DEMÁS que alguien se fue
        socket.broadcast.emit('user left', {
            socketId: socket.id,
            nombre
        });

        // Limpieza de datos
        if (autos[socket.id]) {
            delete autos[socket.id];
            emitirTelemetriaGlobal();
        }
    });
});