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
const messages = {};         // username → array de mensajes privados
const users = {};            // socket.id → username
const autos = {};            // username → datos de telemetría

// Variable global del módulo (solo una vez, fuera de las funciones)
let ultimoEmitTimeout = null;

// Cola para emisiones de telemetría (evita spam)
let colaTelemetria = Promise.resolve();
let tareaId = 0;

function emitirTelemetriaGlobal() {
    const id = ++tareaId;
    colaTelemetria = colaTelemetria
        .then(() => {
            console.log(`[T${id}] Emitiendo telemetria_global (${Object.keys(autos).length} autos)`);
            io.emit('telemetria_global', { ...autos });
        })
        .catch(err => {
            console.error(`[T${id}] Error emitiendo telemetria_global:`, err);
        });
    return colaTelemetria;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor iniciado en http://localhost:${PORT} — ${new Date().toLocaleString('es-AR')}`);
});

io.on('connection', (socket) => {
    console.log(`[CONN] Nuevo socket: ${socket.id}  ${new Date().toLocaleTimeString('es-AR')}`);

    let warnedNoUsername = false;

    // Registro de usuario
    socket.on('set username', (username) => {
        if (!username || typeof username !== 'string' || username.trim() === '') {
            socket.emit('username error', 'Nombre inválido');
            return;
        }

        const cleanName = username.trim();
        users[socket.id] = cleanName;

        console.log(`[USER] ${cleanName} registrado → socket ${socket.id}`);
        socket.emit('username set', cleanName);
        io.emit('users list', Object.values(users));

        if (messages[cleanName]) {
            socket.emit('load messages', messages[cleanName]);
        }
    });

    // Recepción de telemetría

// Recepción de telemetría
socket.on('telemetria', data => {
    const nombre = (data?.nombre || '').trim();

    if (!nombre) {
        console.log(`[TELE] Ignorada - sin nombre en data para socket ${socket.id}`);
        return;
    }

    // Guardamos usando el nombre como clave principal
    autos[nombre] = { 
        ...data,
        id: socket.id,                    // socket actual (útil para limpiar en disconnect)
        username: nombre,
        ultimaActualizacion: Date.now()
    };

    console.log(`[TELE] Guardada para ${nombre} (socket ${socket.id})`);

    // Throttle: máximo 1 emisión cada 800 ms
    if (ultimoEmitTimeout) {
        clearTimeout(ultimoEmitTimeout);
    }

    ultimoEmitTimeout = setTimeout(() => {
        console.log(`[TELE GLOBAL] Emitiendo actualización (${Object.keys(autos).length} vehículos)`);
        io.emit('telemetria_global', { ...autos });  // copia shallow para seguridad
        ultimoEmitTimeout = null;
    }, 800);
});
    // Limpieza al desconectar
    socket.on('disconnect', () => {
        // Buscar y borrar autos que usaban este socket.id
        for (let key in autos) {
            if (autos[key].id === socket.id) {
                console.log(`[DISCONN] Borrando auto de ${key} (socket ${socket.id})`);
                delete autos[key];
            }
        }
        io.emit('telemetria_global', { ...autos });
    });


    // Mensaje privado
    socket.on('private message', ({ to, text }) => {
        const from = users[socket.id];
        if (!from || !to || !text?.trim()) return;

        const msg = {
            from,
            to,
            text: text.trim(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        messages[from] = messages[from] || [];
        messages[to]   = messages[to]   || [];

        messages[from].push(msg);
        messages[to].push(msg);

        const recipientId = Object.keys(users).find(id => users[id] === to);
        if (recipientId) {
            io.to(recipientId).emit('private message', msg);
        }
        socket.emit('private message', msg);
    });

    // Mensaje general (chat público)
    socket.on('general message', (text) => {
        const from = users[socket.id];
        if (!from || !text?.trim()) return;

        const msg = `${from}: ${text.trim()}`;
        io.emit('general message', msg);
    });

    // Desconexión
    socket.on('disconnect', () => {
        const username = users[socket.id];
        if (username) {
            console.log(`[DISCONN] ${username} (${socket.id}) desconectado`);
            delete users[socket.id];
            delete autos[username];

            io.emit('users list', Object.values(users));
            emitirTelemetriaGlobal();
        }
    });
});