// main.js - Versión ajustada 2025/2026 + panel hi_status + GPS eficiente con watchPosition
// Enfoque: mensajes privados SIEMPRE visibles en "Mensajes Recibidos"
// + mejor manejo de chat activo + debug claro + info en .hi_status
// + GPS: watchPosition + filtro de movimiento mínimo (8 metros) para bajo consumo

const socket = io();

const map = L.map('map').setView([-34.6037, -58.3816], 15);
L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png').addTo(map);

let markers = {};
let miPosicion = null;
let miMarker = null;
let contactoActivo = null;           // socketId del chat abierto actualmente
let mensajesPorConversacion = {};    // { socketId: [ {from:'yo'|'el', text, time} ] }
let radioCircle = null;
let fadeTimeout = null;              // para fade out del círculo
let watchId = null;                  // para detener watchPosition si es necesario

// ─── Variables para GPS eficiente ───
let ultimaPosicionEnviada = null;    // {lat, lng} de la última posición ENVIADA al server
const MIN_MOVIMIENTO_METROS = 8;     // solo enviamos si nos movimos ≥ 8 metros
let primeraTelemetriaEnviada = false;

const campos = ['nombre', 'vehiculo', 'placa', 'seguro', 'contacto'];
const campoImagenMarker = 'imagenMarker';

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

// Persistencia para imagen del marker
const $imagenMarker = $(`#${campoImagenMarker}`);
const imagenMarkerGuardada = localStorage.getItem(campoImagenMarker) || 'auto1.png';
$imagenMarker.val(imagenMarkerGuardada);

// Inicializar selector de autos
function inicializarSelectorAutos() {
    const autoSeleccionado = imagenMarkerGuardada;
    $('.auto-option').each(function() {
        const $img = $(this);
        const autoValue = $img.data('auto');
        if (autoValue === autoSeleccionado) {
            $img.addClass('selected');
        }
        
        $img.on('click', function() {
            $('.auto-option').removeClass('selected');
            $img.addClass('selected');
            $imagenMarker.val(autoValue);
            localStorage.setItem(campoImagenMarker, autoValue);
            // Actualizar marker si ya existe
            if (miMarker && miPosicion) {
                actualizarMarker();
            }
            // Actualizar imagen en hi_status
            if (miPosicion) {
                const nombre = $('#nombre').val().trim() || 'Anónimo';
                const vehiculo = $('#vehiculo').val().trim() || '';
                const placa = $('#placa').val().trim() || '';
                const velocidad = parseFloat($('#mi_velocidad').val()) || 0;
                const tiempo = new Date().toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
                actualizarPopupHiStatus(nombre, vehiculo, placa, velocidad, miPosicion.lat, miPosicion.lng, tiempo);
            }
        });
    });
}

inicializarSelectorAutos();

// Mostrar auto seleccionado en hi_status al cargar
setTimeout(() => {
    if (miPosicion) {
        const nombre = $('#nombre').val().trim() || 'Anónimo';
        const vehiculo = $('#vehiculo').val().trim() || '';
        const placa = $('#placa').val().trim() || '';
        const velocidad = 0;
        const tiempo = new Date().toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
        actualizarPopupHiStatus(nombre, vehiculo, placa, velocidad, miPosicion.lat, miPosicion.lng, tiempo);
    }
}, 500);

// ────────────────────────────────────────────────
// Al conectar socket
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

// ────────────────────────────────────────────────
// Funciones auxiliares de distancia
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
// Crear popup futurista con información completa
// ────────────────────────────────────────────────
function crearPopupFuturista(nombre, vehiculo, placa, velocidad, lat, lng, tiempo, incluirBotonHablar = false, socketId = null) {
    const velocidadFormateada = velocidad ? velocidad.toFixed(1) : '0.0';
    const latFormateada = lat ? lat.toFixed(6) : '---';
    const lngFormateada = lng ? lng.toFixed(6) : '---';
    
    return `
        <div style="
            font-family: 'Oxanium', monospace;
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
            border: 1px solid #00bfff;
            border-radius: 4px;
            padding: 12px;
            min-width: 200px;
            box-shadow: 0 0 20px rgba(0, 191, 255, 0.3);
            color: #e2e8f0;
        ">
            <div style="
                display: flex;
                align-items: center;
                margin-bottom: 10px;
                padding-bottom: 8px;
                border-bottom: 1px solid rgba(0, 191, 255, 0.3);
            ">
                <span style="font-size: 18px; margin-right: 8px;">🚗</span>
                <strong style="color: #00bfff; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">
                    ${nombre || 'Anónimo'}
                </strong>
            </div>
            
            <div style="font-size: 11px; line-height: 1.6;">
                <div style="margin-bottom: 6px;">
                    <span style="color: #64748b; text-transform: uppercase;">Vehículo:</span>
                    <span style="color: #e2e8f0; margin-left: 8px;">${vehiculo || '---'}</span>
                </div>
                
                <div style="margin-bottom: 6px;">
                    <span style="color: #64748b; text-transform: uppercase;">Placa:</span>
                    <span style="color: #00bfff; margin-left: 8px; font-weight: 600;">${placa || '---'}</span>
                </div>
                
                <div style="margin-bottom: 6px;">
                    <span style="color: #64748b; text-transform: uppercase;">Velocidad:</span>
                    <span style="color: #10b981; margin-left: 8px; font-weight: 600;">
                        ${velocidadFormateada} <span style="color: #64748b; font-size: 10px;">km/h</span>
                    </span>
                </div>
                
                <div style="margin-bottom: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1);">
                    <div style="color: #64748b; font-size: 10px; margin-bottom: 4px;">COORDENADAS</div>
                    <div style="color: #94a3b8; font-size: 10px; font-family: 'Courier New', monospace;">
                        LAT: ${latFormateada}<br>
                        LNG: ${lngFormateada}
                    </div>
                </div>
                
                <div style="margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1);">
                    <span style="color: #64748b; font-size: 9px; text-transform: uppercase;">
                        ⏱️ ${tiempo || new Date().toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'})}
                    </span>
                </div>
            </div>
        </div>
        ${incluirBotonHablar && socketId ? `
            <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">
                <button onclick="hablarCon('${socketId}', '${nombre || 'Usuario'}')" 
                        style="
                            width: 100%;
                            padding: 8px;
                            background: rgba(0, 191, 255, 0.2);
                            border: 1px solid #00bfff;
                            border-radius: 4px;
                            color: #00bfff;
                            cursor: pointer;
                            font-family: 'Oxanium', monospace;
                            font-size: 11px;
                            text-transform: uppercase;
                            transition: all 0.2s ease;
                        "
                        onmouseover="this.style.background='rgba(0, 191, 255, 0.3)'; this.style.boxShadow='0 0 10px rgba(0, 191, 255, 0.5)';"
                        onmouseout="this.style.background='rgba(0, 191, 255, 0.2)'; this.style.boxShadow='none';">
                    🎤 Hablar
                </button>
            </div>
        ` : ''}
    `;
}

// ────────────────────────────────────────────────
// Crear o actualizar marker con imagen seleccionada
// ────────────────────────────────────────────────
function actualizarMarker() {
    if (!miPosicion) return;

    const imagenSeleccionada = $('#imagenMarker').val() || 'auto1.png';
    const iconUrl = `img/${imagenSeleccionada}`;

    // Crear icono pequeño (solo la imagen, sin pin azul)
    const icono = L.icon({
        iconUrl: iconUrl,
        iconSize: [28, 28],        // Marker pequeño
        iconAnchor: [12, 12],      // Centro del icono
        popupAnchor: [0, -12]      // Posición del popup arriba del icono
    });

    if (miMarker) {
        // Si el marker ya existe, actualizar su icono y posición
        miMarker.setIcon(icono);
        miMarker.setLatLng([miPosicion.lat, miPosicion.lng]);
    } else {
        // Crear nuevo marker (sin el pin azul por defecto)
        miMarker = L.marker([miPosicion.lat, miPosicion.lng], {
            icon: icono,
            keyboard: false,
            title: 'Mi posición'
        }).addTo(map);
    }
}

// ────────────────────────────────────────────────
// Actualizar imagen del auto en panel hi_status
// ────────────────────────────────────────────────
function actualizarPopupHiStatus(nombre, vehiculo, placa, velocidad, lat, lng, tiempo) {
    const $hiStatus = $('.hi_status');
    
    // Buscar o crear contenedor de la imagen del auto
    let $autoContainer = $hiStatus.find('.auto-hi-status');
    if ($autoContainer.length === 0) {
        $autoContainer = $('<div class="auto-hi-status" style="margin-top: 12px; text-align: center;"></div>');
        $hiStatus.append($autoContainer);
    }
    
    // Obtener la imagen del auto seleccionado
    const imagenSeleccionada = $('#imagenMarker').val() || 'auto1.png';
    const iconUrl = `img/${imagenSeleccionada}`;
    
    // Mostrar la imagen del auto
    $autoContainer.html(`
        <label style="font-size: 11px; margin-bottom: 6px; display: block; text-transform: uppercase; opacity: 0.8;">Mi Vehículo:</label>
        <img src="${iconUrl}" 
             alt="Auto seleccionado" 
             style="
                 width: 80px; 
                 height: auto; 
                 max-width: 100%; 
                 filter: drop-shadow(0 0 8px rgba(0, 191, 255, 0.5));
                 border: 2px solid rgba(0, 191, 255, 0.3);
                 border-radius: 4px;
                 padding: 4px;
                 background: rgba(0, 191, 255, 0.1);
             ">
    `);
}

// ────────────────────────────────────────────────
// Procesar nueva posición GPS
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

    const nombreUsuario = data.nombre;
    if (!nombreUsuario) {
        console.warn("⚠️ No se envía telemetría: falta nombre");
        // return; // descomentar si querés bloquear envíos sin nombre
    }

    // Actualizar panel hi_status
    $('#mi_ultima_pos').val(miPosicion.lat.toFixed(6) + ', ' + miPosicion.lng.toFixed(6));
    $('#mi_velocidad').val(velocidad.toFixed(1) + ' km/h');
    $('#mi_ultima_update').val(new Date().toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', second:'2-digit'}));

    // Marcador propio
    const nombre = data.nombre || 'Anónimo';
    const vehiculo = data.vehiculo || '';
    const placa = data.placa || '';
    const tiempo = new Date().toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    
    // Crear contenido del popup futurista (sin botón "Hablar" para el propio)
    const popupContent = crearPopupFuturista(nombre, vehiculo, placa, velocidad, miPosicion.lat, miPosicion.lng, tiempo, false);
    
    if (!miMarker) {
        actualizarMarker();
        miMarker.bindPopup(popupContent, {
            className: 'popup-futurista',
            maxWidth: 250
        });
    } else {
        // Actualizar posición del marker
        miMarker.setLatLng([miPosicion.lat, miPosicion.lng]);
        // Actualizar popup con datos actuales
        miMarker.setPopupContent(popupContent);
    }
    
    // Actualizar popup en hi_status
    actualizarPopupHiStatus(nombre, vehiculo, placa, velocidad, miPosicion.lat, miPosicion.lng, tiempo);

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

        actualizarCirculoRadio();
        
        setTimeout(() => {
            $('#loadingOverlay').remove();
            console.log("Cortina de carga desaparecida – primera telemetría enviada");
        }, 1000);
    }

    
}

// ────────────────────────────────────────────────
// Iniciar seguimiento GPS eficiente
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
// Actualizar círculo de radio
// ────────────────────────────────────────────────
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

$('#radioFiltro').on('change', actualizarCirculoRadio);

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
// Enviar mensaje privado
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

// ────────────────────────────────────────────────
// Voz → texto para chat privado
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
    
    // Solo reproducir audio si NO es nuestro propio mensaje (eco)
    if (!esMio) {
        const texto = "Audio entrante: " + text;
        hablar(texto);
    }
});

function hablar(texto){
    const msg = new SpeechSynthesisUtterance(texto);
    msg.lang = "es-AR";
    msg.rate = 1;
    msg.pitch = 1;
    speechSynthesis.speak(msg);
}

// ────────────────────────────────────────────────
// Agregar mensaje a memoria y DOM
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
// Renderizar "Mensajes Recibidos"
// ────────────────────────────────────────────────
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

let socketToName = {};

function getNameFromSocketId(socketId) {
    return socketToName[socketId] || 'Anónimo';
}

// ────────────────────────────────────────────────
// Telemetría global + actualización de marcadores
// ────────────────────────────────────────────────
socket.on('telemetria_global', autos => {
    console.log(`[TELE GLOBAL] Recibidos ${Object.keys(autos).length} vehículos`);

    // Obtener socket ID propio para no procesarlo aquí
    const miSocketId = socket.id;

    // Eliminar markers de usuarios que ya no están conectados
    Object.keys(markers).forEach(socketId => {
        if (socketId !== miSocketId && !autos[socketId]) {
            console.log(`[MARKER] Eliminando marker de usuario desconectado: ${socketId}`);
            map.removeLayer(markers[socketId]);
            delete markers[socketId];
        }
    });

    // Actualizar mapa de nombres
    socketToName = {};
    Object.entries(autos).forEach(([socketId, data]) => {
        socketToName[socketId] = data.nombre || 'Anónimo';
    });

    Object.entries(autos).forEach(([socketId, data]) => {
        // Saltar el marker propio (se maneja en enviarPosicion)
        if (socketId === miSocketId) return;
        if (!data.lat || !data.lng) return;

        // Usar auto1.png por defecto si no hay imagen seleccionada
        const imagenAuto = 'auto1.png'; // Por ahora todos usan auto1, podría venir del servidor
        const iconUrl = `img/${imagenAuto}`;

        // Crear icono personalizado para otros usuarios
        const icono = L.icon({
            iconUrl: iconUrl,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            popupAnchor: [0, -12]
        });

        if (!markers[socketId]) {
            markers[socketId] = L.marker([data.lat, data.lng], {
                icon: icono
            }).addTo(map);
        } else {
            markers[socketId].setIcon(icono);
        }

        markers[socketId].setLatLng([data.lat, data.lng]);

        // Crear popup futurista para otros usuarios
        const tiempo = data.ultimaActualizacion 
            ? new Date(data.ultimaActualizacion).toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', second:'2-digit'})
            : new Date().toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'});
        
        // Crear popup futurista con botón "Hablar" para otros usuarios
        const popupContent = crearPopupFuturista(
            data.nombre || 'Anónimo',
            data.vehiculo || '',
            data.placa || '',
            data.velocidad || 0,
            data.lat,
            data.lng,
            tiempo,
            true,  // incluir botón "Hablar"
            socketId
        );
        
        markers[socketId].bindPopup(popupContent, {
            className: 'popup-futurista',
            maxWidth: 250
        });
    });

    renderizarContactos(autos);
});


function hablarCon(id, nombre){
    var userData= {}
    userData.nombre = nombre
    abrirChatConUsuario(id, userData);
    setTimeout(() => {
        hablarPrivado(); // id real del botón 🎤
    }, 300);
}

// ────────────────────────────────────────────────
// Abrir chat privado
// ────────────────────────────────────────────────
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

// ────────────────────────────────────────────────
// Chat general (V2V)
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
// Reconocimiento y síntesis de voz
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

// Opcional: para detener GPS manualmente (podes agregar un botón si querés)
// function detenerGPS() {
//     if (watchId !== null) {
//         navigator.geolocation.clearWatch(watchId);
//         watchId = null;
//         console.log("[GPS] Seguimiento detenido");
//     }
// }