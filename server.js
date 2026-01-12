// ===================================================
// V2V - SERVIDOR DE COMUNICACIÓN VEHICULAR
// Archivo: server.js
// ===================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// ===================================================
// BLOQUE 1 - REGISTRO DE AUTOS CONECTADOS
// ===================================================

let autos = {}; // Almacena todos los vehículos activos por socket.id

// ===================================================
// BLOQUE 2 - CONEXIONES SOCKET.IO
// ===================================================

io.on('connection', socket => {

    // ===================================================
    // FUNCIÓN 01 - Recepción de telemetría de un vehículo
    // ===================================================
    socket.on('telemetria', data => {
        autos[socket.id] = { 
            id: socket.id, 
            ...data, 
            ultimaActualizacion: Date.now() 
        };
        io.emit('telemetria_global', autos);
    });

    // ===================================================
    // FUNCIÓN 02 - Envío del estado global al nuevo cliente
    // ===================================================
    socket.emit('telemetria_global', autos);

    // ===================================================
    // FUNCIÓN 03 - Chat global V2V (texto)
    // ===================================================
    socket.on('mensajeV2V', msg => {
        io.emit('mensajeV2V', msg);
    });

    // ===================================================
    // FUNCIÓN 04 - Mensajería privada entre vehículos
    // ===================================================
    socket.on('mensajePrivado', ({id, mensaje}) => {
        if(io.sockets.sockets.get(id)){
            io.to(id).emit('mensajePrivado', {id: socket.id, mensaje});
        }
    });

    // ===================================================
    // FUNCIÓN 05 - Desconexión de vehículo
    // ===================================================
    socket.on('disconnect', () => {
        delete autos[socket.id];
        io.emit('telemetria_global', autos);
    });
});

// ===================================================
// BLOQUE 3 - API DE INTELIGENCIA ARTIFICIAL (GROQ)
// ===================================================

// ===================================================
// FUNCIÓN 06 - Endpoint de consulta a IA
// Descripción: Reenvía prompts a Groq (Llama3)
// ===================================================
app.post('/api/ia', async (req,res)=>{
    const { apiKey, prompt } = req.body;

    try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method:'POST',
            headers:{
                'Content-Type':'application/json',
                'Authorization':'Bearer ' + apiKey
            },
            body: JSON.stringify({
                model:'llama3-70b-8192',
                messages:[{role:'user', content:prompt}]
            })
        });

        const data = await r.json();
        res.json(data.choices[0].message.content);

    } catch(e){
        console.error("Error IA:", e);
        res.status(500).json({error:'Error en servicio de IA'});
    }
});

// ===================================================
// BLOQUE 4 - INICIO DEL SERVIDOR
// ===================================================

// ===================================================
// FUNCIÓN 07 - Arranque del servidor HTTP + WebSocket
// ===================================================
server.listen(3000, ()=>{
    console.log('Servidor V2V + IA activo en http://localhost:3000');
});
