// main.js - Versión ajustada 2025/2026 + panel hi_status
// Enfoque: garantizar que los mensajes privados se vean SIEMPRE en "Mensajes Recibidos"
// + mejor manejo de chat activo + debug más claro + info en .hi_status

const socket = io();

const map = L.map('map').setView([-34.6037, -58.3816], 15);
L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png').addTo(map);

let markers = {};
let miPosicion = null;
let miMarker = null;
let contactoActivo = null;           // username del chat abierto actualmente
let mensajesPorConversacion = {};    // { username: [ {from:'yo'|'el', text, time?} ] }
let radioCircle = null;
let fadeTimeout = null;     // para controlar el fade out
const campos = ['nombre', 'vehiculo', 'placa', 'seguro', 'contacto'];



// ────────────────────────────────────────────────
// LocalStorage persistencia
// ────────────────────────────────────────────────
campos.forEach(id => {
    const $el = $(`#${id}`);
    const val = localStorage.getItem(id);
    if (val) $el.val(val);

    $el.on('input', function () {
        localStorage.setItem(id, $(this).val());
    });
});

// ────────────────────────────────────────────────
// Inicialización del panel hi_status al conectar
// ────────────────────────────────────────────────
socket.on('connect', () => {
    console.log("[SOCKET] Conectado →", socket.id);
    // Intentamos enviar el nombre guardado en localStorage si existe
    const nombreGuardado = localStorage.getItem('nombre')?.trim() || "Anónimo";
    if (nombreGuardado) {
        socket.emit('set username', nombreGuardado);
    }
    // Completamos inmediatamente el socket ID
    $('#mi_username').val('esperando nombre...');
    $('#mi_socket_id').val(socket.id || '---');
    $('#mi_ultima_pos').val('---');
    $('#mi_velocidad').val('--- km/h');
    $('#mi_ultima_update').val('---');
});

// Cuando el servidor confirma el username
socket.on('username set', nombre => {
    console.log("[USERNAME] Confirmado por servidor:", nombre);
    $('#mi_username').val(nombre || '---');
});

// ────────────────────────────────────────────────
// Inicialización de envío de posición + telemetría + actualizar panel hi_status
// ────────────────────────────────────────────────
// ────────────────────────────────────────────────
// Control de la cortina de carga
// ────────────────────────────────────────────────
let primeraTelemetriaEnviada = false;  // bandera para saber si ya enviamos la primera

function enviarPosicion(pos) {
    miPosicion = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
    };

    const data = {};
    campos.forEach(c => data[c] = $(`#${c}`).val().trim());
    data.lat = miPosicion.lat;
    data.lng = miPosicion.lng;
    data.velocidad = pos.coords.speed || 0;

    const nombre = data.nombre;
    if (!nombre) {
        console.warn("⚠️ No se envía telemetría: falta nombre");
        //return; DISABLE
    }

    // ─── Actualizamos panel hi_status (como ya tenías) ───
    $('#mi_ultima_pos').val(miPosicion.lat.toFixed(6) + ', ' + miPosicion.lng.toFixed(6));
    $('#mi_velocidad').val(data.velocidad.toFixed(1) + ' km/h');
    $('#mi_ultima_update').val(new Date().toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', second:'2-digit'}));

    // Marcador propio, centrado, etc. (tu código existente)
    if (!miMarker) {
        miMarker = L.marker([miPosicion.lat, miPosicion.lng], {
            icon: L.divIcon({
                className: 'mi-marcador',
                html: '<div class="pulsar">YO</div>',
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            })
        }).addTo(map);

        miMarker.bindPopup(`<b>YO: ${nombre}</b><br>Vel: ${data.velocidad || 0} km/h`);
    } else {
        miMarker.slideTo([miPosicion.lat, miPosicion.lng], { duration: 1200 });
    }

    if (!map.getCenter().equals([miPosicion.lat, miPosicion.lng], 0.002)) {
        map.setView([miPosicion.lat, miPosicion.lng], 14);
        setTimeout(() => {
                   map.flyTo([miPosicion.lat, miPosicion.lng], 18); 
        }, 3500);
    }

    socket.emit('telemetria', data);
    console.log(`[TX] Telemetría → ${nombre} @ ${miPosicion.lat.toFixed(5)},${miPosicion.lng.toFixed(5)}`);

    // ─── ¡AQUÍ DESAPARECE LA CORTINA! ───
    if (!primeraTelemetriaEnviada) {
        primeraTelemetriaEnviada = true;

        // Fade out suave
        $('#loadingOverlay').css('opacity', 0);

        // La quitamos del DOM después de la transición
        setTimeout(() => {
            $('#loadingOverlay').remove();
            console.log("Cortina de carga desaparecida – primera telemetría enviada");
        }, 1000); // 1 segundo = duración de la transición CSS
    }

    // Actualizamos círculo de radio (si tenés esa función)
    actualizarCirculoRadio();
}

// Función para actualizar/dibujar el círculo de radio
function actualizarCirculoRadio() {
    // Cancelamos cualquier fade pendiente para evitar conflictos
    if (fadeTimeout) clearTimeout(fadeTimeout);

    if (!miPosicion) {
        console.warn("No hay posición → no se dibuja círculo");
        return;
    }

    const radioKm = parseFloat($('#radioFiltro').val()) || 50;
    const radioMetros = radioKm * 1000;

    // Si el círculo no existe → lo creamos
    if (!radioCircle) {
        radioCircle = L.circle([miPosicion.lat, miPosicion.lng], {
            radius: radioMetros,
            color: '#00bfff',
            fillColor: '#00bfff',
            fillOpacity: 0.15,
            weight: 2,
            className: 'radio-line-gps',
            opacity: 1,               // aparece inmediatamente
            interactive: false
        }).addTo(map);
    } else {
        // Actualizamos posición y radio
        radioCircle.setLatLng([miPosicion.lat, miPosicion.lng]);
        radioCircle.setRadius(radioMetros);
        radioCircle.setStyle({
            opacity: 1,
            fillOpacity: 0.15
        });
    }

    console.log(`Círculo visible: ${radioKm} km`);

    // ─── Después de 5 segundos → fade out ───
    fadeTimeout = setTimeout(() => {
        radioCircle.setStyle({
            opacity: 0,
            fillOpacity: 0
        });
        console.log("Círculo haciendo fade out...");
    }, 3500);
}

// ────────────────────────────────────────────────
// Escuchar cambio en el select
// ────────────────────────────────────────────────
$('#radioFiltro').on('change', function() {
    actualizarCirculoRadio();
});
// Geolocalización
if (navigator.geolocation) {
    // LOOP
    setInterval(() => {
        navigator.geolocation.getCurrentPosition(enviarPosicion, err => {
            console.error("Geolocalización falló:", err);
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    }, 2500);
    // UNICA VEZ
    // navigator.geolocation.getCurrentPosition(enviarPosicion, err => {
    //         console.error("Geolocalización falló:", err);
    //     }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
} else {
    console.error("Geolocalización no disponible en este navegador");
}

// ────────────────────────────────────────────────
// Distancia Haversine
// ────────────────────────────────────────────────
function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ────────────────────────────────────────────────
// Renderizar contactos cercanos
// ────────────────────────────────────────────────
function renderizarContactos(autos) {
    const $lista = $('#listaContactos');
    if (!$lista.length || !miPosicion) return;

    const radio = parseFloat($('#radioFiltro').val()) || 50;
    const miNombre = ($('#nombre').val() || 'YO').trim();

    $lista.empty();

    Object.entries(autos).forEach(([socketId, data]) => {
        if (!data.lat || !data.lng) return;

        const dist = calcularDistanciaKm(miPosicion.lat, miPosicion.lng, data.lat, data.lng);
        if (dist > radio) return;

        const esYo = data.nombre === miNombre;

        const $item = $(`
            <div class="contacto-item">
                <strong>${data.nombre || 'Anónimo'}</strong><br>
                <small>${data.vehiculo || ''} • ${data.placa || '---'} • ${dist.toFixed(1)} km</small>
            </div>
        `);

        $item.click(() => abrirChatConUsuario(socketId, data));

        $lista.append($item);
    });
}

// ────────────────────────────────────────────────
// Enviar mensaje privado (usando socket ID del target)
// ────────────────────────────────────────────────
function enviarPrivado() {
    const texto = $('#txtPrivado').val().trim();
    if (!texto || !contactoActivo) return;

    const mySocketId = $('.mi_socket_id').val().trim();
    if (!mySocketId) {
        console.warn("⚠️ No se envía privado: falta mySocketId");
        return;
    }

    socket.emit('private message', {
        toSocketId: contactoActivo,  // socket ID del target
        text: texto
    });

    $('#txtPrivado').val('');
}

// ────────────────────────────────────────────────
// Voz para chat privado
// ────────────────────────────────────────────────
function hablarPrivado() {
    vozATexto(texto => {
        if (!texto) return;
        $('#txtPrivado').val(texto);
        enviarPrivado();
    });
}

// ────────────────────────────────────────────────
// Recibir mensaje privado
// ────────────────────────────────────────────────
socket.on('private message', msg => {
    const { fromSocketId, text, time } = msg;

    const interlocutor = fromSocketId;  // Ahora interlocutor es socket ID
    const esMio = fromSocketId === $('.mi_socket_id').val().trim();

    agregarMensajeEnChat(esMio ? 'yo' : 'el', text, interlocutor, time);

    renderizarMensajesRecibidos();

    if (interlocutor === contactoActivo) {
        $('#chatPrivado').scrollTop($('#chatPrivado')[0].scrollHeight);
        if (!esMio) textoAVoz(text);
    } else if (!esMio) {
        $(`[data-user="${fromSocketId}"]`).addClass('tiene-mensaje');
    }

    console.log(`[RX Private] ${fromSocketId} : ${text}`);
});

// ────────────────────────────────────────────────
// Agregar mensaje a memoria + DOMs
// ────────────────────────────────────────────────
function agregarMensajeEnChat(origen, texto, interlocutor, time = null) {
    if (!mensajesPorConversacion[interlocutor]) {
        mensajesPorConversacion[interlocutor] = [];
    }

    const mensaje = { 
        from: origen, 
        text: texto, 
        time: time || new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) 
    };
    mensajesPorConversacion[interlocutor].push(mensaje);

    if (interlocutor === contactoActivo) {
        const prefijo = origen === 'yo' ? 'YO: ' : 'ÉL: ';
        $('#chatPrivado').append(`<div class="msg">${prefijo}${texto}</div>`);
        $('#chatPrivado').scrollTop($('#chatPrivado')[0].scrollHeight);
    }
}

// ────────────────────────────────────────────────
// Renderizar sección "MENSAJES RECIBIDOS" (usando socket ID como key)
// ────────────────────────────────────────────────
function renderizarMensajesRecibidos() {
    const $cont = $('#conversacionesRecibidas').empty();

    Object.entries(mensajesPorConversacion).forEach(([socketId, msgs]) => {
        if (msgs.length === 0) return;

        const userName = getNameFromSocketId(socketId);  // Función nueva para resolver name de socket ID

        const $details = $('<details>').append(
            $('<summary>').text(`${userName || socketId} (${msgs.length})`)
        );

        const $mensajesDiv = $('<div class="chat-mensajes">');

        msgs.forEach(m => {
            const prefijo = m.from === 'yo' ? 'YO: ' : 'ÉL: ';
            $mensajesDiv.append(`<div class="msg">${prefijo}${m.text} <small>${m.time}</small></div>`);
        });

        $details.append($mensajesDiv);
        $cont.append($details);
    });
}

// Nueva función para resolver name de socket ID (usando autos de telemetria_global)
let socketToName = {};  // Mapa socketId → name, actualizado en telemetria_global

function getNameFromSocketId(socketId) {
    return socketToName[socketId] || 'Anónimo';
}

// ────────────────────────────────────────────────
// Render telemetría global + actualizar mapa socketToName
// ────────────────────────────────────────────────
socket.on('telemetria_global', autos => {
    console.log(`[TELE GLOBAL] Recibidos ${Object.keys(autos).length} vehículos`);

    // Actualizar mapa socketToName
    socketToName = {};
    Object.entries(autos).forEach(([socketId, data]) => {
        socketToName[socketId] = data.nombre || 'Anónimo';
    });

    Object.entries(autos).forEach(([socketId, data]) => {
        if (!data.lat || !data.lng) return;

        if (!markers[socketId]) {
            markers[socketId] = L.marker([data.lat, data.lng]).addTo(map);
        }

        markers[socketId].slideTo([data.lat, data.lng], { duration: 1000 });

        const popup = `
            <b>${data.nombre || 'Anónimo'}</b><br>
            ${data.vehiculo || ''}<br>
            Vel: ${data.velocidad || 0} km/h<br>
            <button onclick="abrirChatConUsuario('${socketId}', ${JSON.stringify(data).replace(/"/g, '&quot;')} )">
                Chatear
            </button>
        `;
        markers[socketId].bindPopup(popup);
    });

    renderizarContactos(autos);
});
// Abre el chat privado con un usuario específico
// Recibe el socketId del destinatario y los datos del usuario (opcional)
function abrirChatConUsuario(socketId, userData) {
    // Validación básica
    if (!socketId) {
        console.warn("No se puede abrir chat: falta socketId");
        Swal.fire({
            icon: 'warning',
            title: 'Error',
            text: 'No se pudo identificar al usuario seleccionado'
        });
        return;
    }

    // Guardamos el socketId del contacto activo
    contactoActivo = socketId;

    // Actualizamos el título del chat privado
    const nombre = userData?.nombre || 'Usuario desconocido';
    $('#contactoSeleccionado').text(`Chat con ${nombre} (${socketId.slice(0,8)}...)`);

    // Limpiamos o mostramos mensajes previos de esa conversación
    $('#chatPrivado').empty();

    // Si hay mensajes guardados para este socketId
    if (mensajesPorConversacion[socketId] && mensajesPorConversacion[socketId].length > 0) {
        mensajesPorConversacion[socketId].forEach(msg => {
            const prefijo = msg.from === 'yo' ? 'YO: ' : 'ÉL: ';
            $('#chatPrivado').append(`<div class="msg">${prefijo}${msg.text} <small>${msg.time}</small></div>`);
        });
        $('#chatPrivado').scrollTop($('#chatPrivado')[0].scrollHeight);
    } else {
        $('#chatPrivado').append('<div class="msg system">Conversación iniciada</div>');
    }

    // Opcional: resaltar el contacto en la lista
    $('.contacto-item').removeClass('active');
    $(`.contacto-item[data-socketid="${socketId}"]`).addClass('active');

    // Abrimos el panel de comunicaciones si está colapsado (móvil)
    if (!$('#commsPanel').hasClass('open')) {
        toggleComms();
    }

    console.log(`[CHAT ABIERTO] con socketId: ${socketId} (${nombre})`);
}
// ────────────────────────────────────────────────
// Chat general (público)
// ────────────────────────────────────────────────
function enviarV2V() {
    const texto = $('#txtV2V').val().trim();
    if (!texto) return;

    const mySocketId = $('.mi_socket_id').val().trim();
    if (!mySocketId) {
        console.warn("⚠️ No se envía general: falta mySocketId");
        return;
    }

    const myName = $('#nombre').val().trim() || 'Anónimo';

    socket.emit('general message', {
        text: texto,
        fromSocketId: mySocketId,
        fromName: myName
    });

    $('#txtV2V').val('');
}

socket.on('general message', msg => {
    $('#msgsV2V').append(`<div class="msg">${msg.fromName}: ${msg.text}</div>`).scrollTop($('#msgsV2V')[0].scrollHeight);
});

// ────────────────────────────────────────────────
// Voz → texto
// ────────────────────────────────────────────────
function vozATexto(callback) {
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
        alert("Reconocimiento de voz no soportado en este navegador");
        return;
    }

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SpeechRec();
    rec.lang = 'es-AR';
    rec.interimResults = false;

    rec.onresult = e => {
        const texto = e.results[0][0].transcript.trim();
        if (texto && callback) callback(texto);
    };

    rec.onerror = e => console.error("Error en reconocimiento de voz:", e.error);
    rec.start();
}

// ────────────────────────────────────────────────
// Texto → voz
// ────────────────────────────────────────────────
function textoAVoz(texto) {
    if (!texto) return;
    const utterance = new SpeechSynthesisUtterance(texto);
    utterance.lang = 'es-AR';
    speechSynthesis.speak(utterance);
}

// ────────────────────────────────────────────────
// Toggle panel comunicaciones (móvil)
// ────────────────────────────────────────────────
function toggleComms() {
    $('#commsPanel').toggleClass('open');
}

// ────────────────────────────────────────────────
// Errores de username
// ────────────────────────────────────────────────
socket.on('username error', err => {
    alert("Error al registrar nombre: " + err);
});