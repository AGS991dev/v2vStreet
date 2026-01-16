// main.js - Versión ajustada 2025/2026 + panel hi_status + GPS eficiente + Locate Control + Traza de ruta
// Enfoque: mensajes privados SIEMPRE visibles + GPS watchPosition con filtro 8m + botón centrar + toggle ruta recorrida

const socket = io();

// ────────────────────────────────────────────────
// Variables globales
// ────────────────────────────────────────────────
const campos = ['nombre', 'vehiculo', 'placa', 'seguro', 'contacto'];

let markers = {};
let miPosicion = null;
let miMarker = null;
let contactoActivo = null;           // socketId del chat abierto actualmente
let mensajesPorConversacion = {};    // { socketId: [ {from:'yo'|'el', text, time} ] }
let radioCircle = null;
let fadeTimeout = null;              // para fade out del círculo
let watchId = null;                  // para detener watchPosition si es necesario
let ultimaPosicionEnviada = null;    // {lat, lng} de la última posición ENVIADA al server
const MIN_MOVIMIENTO_METROS = 8;     // solo enviamos si nos movimos ≥ 8 metros
let primeraTelemetriaEnviada = false;
let socketToName = {};               // Mapa socketId → name

// ─── Variables para GPS eficiente y ruta ───
let miRuta = null;                   // polyline de ruta recorrida
let rutaPuntos = [];                 // array de coordenadas [lat, lng]
let mostrarRuta = false;             // toggle ruta ON/OFF

// ────────────────────────────────────────────────
// Inicialización del mapa y controles Leaflet
// ────────────────────────────────────────────────
const map = L.map('map').setView([-34.6037, -58.3816], 15);
L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png').addTo(map);

// Botón "Centrar en mí" con LocateControl
L.control.locate({
    position: 'topright',
    flyTo: true,
    flyToOptions: { animate: true, duration: 1.5 },
    keepCurrentZoomLevel: false,
    drawCircle: true,
    showCompass: true,
    strings: {
        title: "Centrar en mi posición actual",
        popup: "Estás aquí (precisión {distance} m)"
    },
    locateOptions: {
        maxZoom: 18,
        enableHighAccuracy: true
    }
}).addTo(map);

// Botón Toggle para ruta recorrida (usando EasyButton)
const rutaButton = L.easyButton({
    id: 'toggle-ruta-btn',
    states: [
        {
            stateName: 'off',
            icon: 'fa fa-route fa-lg',  // requiere Font Awesome
            title: 'Mostrar ruta recorrida',
            onClick: function(btn, map) {
                mostrarRuta = true;
                btn.state('on');
                if (miRuta) miRuta.addTo(map);
                console.log("[RUTA] Mostrando traza recorrida");
            }
        },
        {
            stateName: 'on',
            icon: 'fa fa-route fa-lg text-danger',
            title: 'Ocultar ruta recorrida',
            onClick: function(btn, map) {
                mostrarRuta = false;
                btn.state('off');
                if (miRuta) miRuta.remove();
                console.log("[RUTA] Ocultando traza recorrida");
            }
        }
    ]
});
rutaButton.addTo(map);

// ────────────────────────────────────────────────
// Persistencia con LocalStorage
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
// Funciones auxiliares (distancia, cambio posición)
// ────────────────────────────────────────────────
function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function haCambiadoSuficiente(nuevaLat, nuevaLng) {
    if (!ultimaPosicionEnviada) return true; // primera vez siempre enviar

    const distanciaKm = calcularDistanciaKm(
        ultimaPosicionEnviada.lat,
        ultimaPosicionEnviada.lng,
        nuevaLat,
        nuevaLng
    );
    return (distanciaKm * 1000) >= MIN_MOVIMIENTO_METROS;
}

// ────────────────────────────────────────────────
// Funciones del mapa y GPS (enviar posición, círculo, etc.)
// ────────────────────────────────────────────────
function enviarPosicion(pos) {
    const nuevaLat = pos.coords.latitude;
    const nuevaLng = pos.coords.longitude;
    const velocidad = pos.coords.speed || 0;
    const precision = pos.coords.accuracy;

    // Filtrado: ignorar si el movimiento es muy pequeño (salvo la primera vez)
    if (!haCambiadoSuficiente(nuevaLat, nuevaLng) && primeraTelemetriaEnviada) {
        console.log(`[GPS] Movimiento pequeño (${(calcularDistanciaKm(ultimaPosicionEnviada.lat, ultimaPosicionEnviada.lng, nuevaLat, nuevaLng)*1000).toFixed(1)} m) → ignorado`);
        return;
    }

    miPosicion = { lat: nuevaLat, lng: nuevaLng };
    ultimaPosicionEnviada = { lat: nuevaLat, lng: nuevaLng };

    const data = {};
    campos.forEach(c => data[c] = $(`#${c}`).val().trim());
    data.lat = miPosicion.lat;
    data.lng = miPosicion.lng;
    data.velocidad = velocidad;

    const nombre = data.nombre;
    if (!nombre) {
        console.warn("⚠️ No se envía telemetría: falta nombre");
        // return; // descomentar si querés bloquear envíos sin nombre
    }

    // Actualizar panel hi_status
    $('#mi_ultima_pos').val(miPosicion.lat.toFixed(6) + ', ' + miPosicion.lng.toFixed(6));
    $('#mi_velocidad').val(velocidad.toFixed(1) + ' km/h');
    $('#mi_ultima_update').val(new Date().toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', second:'2-digit'}));

    // Marcador propio
    if (!miMarker) {
        miMarker = L.marker([miPosicion.lat, miPosicion.lng], {
            icon: L.divIcon({
                className: 'mi-marcador',
                html: '<div class="pulsar">YO</div>',
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            })
        }).addTo(map);

        miMarker.bindPopup(`<b>YO: ${nombre}</b><br>Vel: ${velocidad || 0} km/h`);
    } else {
        miMarker.slideTo([miPosicion.lat, miPosicion.lng], { duration: 1200 });
    }

    // Centrado y zoom progresivo
    if (!map.getCenter().equals([miPosicion.lat, miPosicion.lng], 0.002)) {
        map.setView([miPosicion.lat, miPosicion.lng], 14);
        setTimeout(() => {
            map.flyTo([miPosicion.lat, miPosicion.lng], 18);
        }, 3500);
    }

    socket.emit('telemetria', data);
    console.log(`[TX] Telemetría → ${nombre} @ ${miPosicion.lat.toFixed(5)},${miPosicion.lng.toFixed(5)} (prec: ${precision.toFixed(0)}m)`);

    // Quitar cortina de carga en la primera fix válida
    if (!primeraTelemetriaEnviada) {
        primeraTelemetriaEnviada = true;
        $('#loadingOverlay').css('opacity', 0);
        setTimeout(() => {
            $('#loadingOverlay').remove();
            console.log("Cortina de carga desaparecida – primera telemetría enviada");
        }, 1000);
    }

    // ─── Traza de ruta recorrida ───
    if (mostrarRuta) {
        const nuevaPos = [miPosicion.lat, miPosicion.lng];

        // Filtrar puntos muy cercanos (mínimo 5m para no saturar)
        if (rutaPuntos.length === 0 || 
            calcularDistanciaKm(
                rutaPuntos[rutaPuntos.length - 1][0],
                rutaPuntos[rutaPuntos.length - 1][1],
                nuevaPos[0],
                nuevaPos[1]
            ) * 1000 > 5) {
            rutaPuntos.push(nuevaPos);
        }

        // Limitar a 5000 puntos para no consumir memoria infinita
        if (rutaPuntos.length > 5000) {
            rutaPuntos = rutaPuntos.slice(-5000);
        }

        if (!miRuta) {
            miRuta = L.polyline(rutaPuntos, {
                color: '#ff0000',       // rojo
                weight: 5,
                opacity: 0.85,
                smoothFactor: 1,
                className: 'mi-ruta-trazada'
            }).addTo(map);
        } else {
            miRuta.setLatLngs(rutaPuntos);
        }
    }

    actualizarCirculoRadio();
}

function actualizarCirculoRadio() {
    if (fadeTimeout) clearTimeout(fadeTimeout);

    if (!miPosicion) {
        console.warn("No hay posición → no se dibuja círculo");
        return;
    }

    const radioKm = parseFloat($('#radioFiltro').val()) || 50;
    const radioMetros = radioKm * 1000;

    if (!radioCircle) {
        radioCircle = L.circle([miPosicion.lat, miPosicion.lng], {
            radius: radioMetros,
            color: '#00bfff',
            fillColor: '#00bfff',
            fillOpacity: 0.15,
            weight: 2,
            className: 'radio-line-gps',
            opacity: 1,
            interactive: false
        }).addTo(map);
    } else {
        radioCircle.setLatLng([miPosicion.lat, miPosicion.lng]);
        radioCircle.setRadius(radioMetros);
        radioCircle.setStyle({ opacity: 1, fillOpacity: 0.15 });
    }

    console.log(`Círculo visible: ${radioKm} km`);

    fadeTimeout = setTimeout(() => {
        radioCircle.setStyle({ opacity: 0, fillOpacity: 0 });
        console.log("Círculo haciendo fade out...");
    }, 3500);
}

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

        const $item = $(`
            <div class="contacto-item" data-socketid="${socketId}">
                <strong>${data.nombre || 'Anónimo'}</strong><br>
                <small>${data.vehiculo || ''} • ${data.placa || '---'} • ${dist.toFixed(1)} km</small>
            </div>
        `);

        $item.click(() => abrirChatConUsuario(socketId, data));
        $lista.append($item);
    });
}

// ────────────────────────────────────────────────
// Inicio de geolocalización
// ────────────────────────────────────────────────
if (navigator.geolocation) {
    const geoOptions = {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000              // permite algo de caché para ahorrar batería
    };

    watchId = navigator.geolocation.watchPosition(
        enviarPosicion,
        err => {
            console.error("[GPS ERROR]", err.code, err.message);
            // Opcional: mostrar alerta al usuario si es grave (ej: permiso denegado)
        },
        geoOptions
    );

    console.log("[GPS] watchPosition iniciado – filtro ≥ " + MIN_MOVIMIENTO_METROS + " metros");
} else {
    console.error("[GPS] Geolocalización no disponible en este navegador");
}

// ────────────────────────────────────────────────
// Eventos del mapa (ej: change radioFiltro)
// ────────────────────────────────────────────────
$('#radioFiltro').on('change', function() {
    actualizarCirculoRadio();
});

// ────────────────────────────────────────────────
// Funciones de sockets (on connect, on username, on messages, etc.)
// ────────────────────────────────────────────────
socket.on('connect', () => {
    console.log("[SOCKET] Conectado →", socket.id);
    const nombreGuardado = localStorage.getItem('nombre')?.trim() || "Anónimo";
    if (nombreGuardado) {
        socket.emit('set username', nombreGuardado);
    }
    $('#mi_username').val('esperando nombre...');
    $('#mi_socket_id').val(socket.id || '---');
    $('#mi_ultima_pos').val('---');
    $('#mi_velocidad').val('--- km/h');
    $('#mi_ultima_update').val('---');
});

socket.on('username set', nombre => {
    console.log("[USERNAME] Confirmado por servidor:", nombre);
    $('#mi_username').val(nombre || '---');
});

socket.on('username error', err => {
    alert("Error al registrar nombre: " + err);
});

socket.on('private message', msg => {
    const { fromSocketId, text, time } = msg;
    const esMio = fromSocketId === $('.mi_socket_id').val().trim();

    agregarMensajeEnChat(esMio ? 'yo' : 'el', text, fromSocketId, time);
    renderizarMensajesRecibidos();

    if (fromSocketId === contactoActivo) {
        $('#chatPrivado').scrollTop($('#chatPrivado')[0].scrollHeight);
        if (!esMio) textoAVoz(text);
    } else if (!esMio) {
        $(`[data-user="${fromSocketId}"]`).addClass('tiene-mensaje');
    }

    console.log(`[RX Private] ${fromSocketId} : ${text}`);
});

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

socket.on('general message', msg => {
    $('#msgsV2V').append(`<div class="msg">${msg.fromName}: ${msg.text}</div>`).scrollTop($('#msgsV2V')[0].scrollHeight);
});

// ────────────────────────────────────────────────
// Funciones de chat y voz
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
        toSocketId: contactoActivo,
        text: texto
    });

    $('#txtPrivado').val('');
}

function hablarPrivado() {
    vozATexto(texto => {
        if (!texto) return;
        $('#txtPrivado').val(texto);
        enviarPrivado();
    });
}

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

function renderizarMensajesRecibidos() {
    const $cont = $('#conversacionesRecibidas').empty();

    Object.entries(mensajesPorConversacion).forEach(([socketId, msgs]) => {
        if (msgs.length === 0) return;

        const userName = getNameFromSocketId(socketId);

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

function getNameFromSocketId(socketId) {
    return socketToName[socketId] || 'Anónimo';
}

function abrirChatConUsuario(socketId, userData) {
    if (!socketId) {
        console.warn("No se puede abrir chat: falta socketId");
        Swal.fire({
            icon: 'warning',
            title: 'Error',
            text: 'No se pudo identificar al usuario seleccionado'
        });
        return;
    }

    contactoActivo = socketId;

    const nombre = userData?.nombre || 'Usuario desconocido';
    $('#contactoSeleccionado').text(`Chat con ${nombre} (${socketId.slice(0,8)}...)`);

    $('#chatPrivado').empty();

    if (mensajesPorConversacion[socketId] && mensajesPorConversacion[socketId].length > 0) {
        mensajesPorConversacion[socketId].forEach(msg => {
            const prefijo = msg.from === 'yo' ? 'YO: ' : 'ÉL: ';
            $('#chatPrivado').append(`<div class="msg">${prefijo}${msg.text} <small>${msg.time}</small></div>`);
        });
        $('#chatPrivado').scrollTop($('#chatPrivado')[0].scrollHeight);
    } else {
        $('#chatPrivado').append('<div class="msg system">Conversación iniciada</div>');
    }

    $('.contacto-item').removeClass('active');
    $(`.contacto-item[data-socketid="${socketId}"]`).addClass('active');

    if (!$('#commsPanel').hasClass('open')) {
        toggleComms();
    }

    console.log(`[CHAT ABIERTO] con socketId: ${socketId} (${nombre})`);
}

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

function textoAVoz(texto) {
    if (!texto) return;
    const utterance = new SpeechSynthesisUtterance(texto);
    utterance.lang = 'es-AR';
    speechSynthesis.speak(utterance);
}

function toggleComms() {
    $('#commsPanel').toggleClass('open');
}