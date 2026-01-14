// main.js completo con correcciones para markers, contactos y chats
// ===================================================
// V2V - SISTEMA DE COMUNICACIÓN VEHICULAR CON VOZ
// Archivo: main.js
// ===================================================

// ===================================================
// BLOQUE 1 - INICIALIZACIÓN
// ===================================================
// LEAFLET
// 01) CLÁSICO (OpenStreetMap Standard)
//https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png

// 02) SMOOTH (Stadia Alidade Smooth)
//https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png

// 03) HUMANITARIAN (OSM French HOT)
//https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png

// 04) OPENFREEMAP (Alternativo OSM)
//https://tile.openfreemap.org/standard/{z}/{x}/{y}.png

// 05) DARK (Stadia Alidade Smooth Dark)
//https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png

// 06) TONER (High-Contrast B/N - Stamen)
//https://stamen-tiles.a.ssl.fastly.net/toner/{z}/{x}/{y}.png

// 07) TERRAIN (Stamen - relieve & terreno)
//https://stamen-tiles.a.ssl.fastly.net/terrain/{z}/{x}/{y}.jpg

// 08) WATERCOLOUR (Artístico suave - Stamen)
//https://stamen-tiles.a.ssl.fastly.net/watercolor/{z}/{x}/{y}.jpg

// 09) CARTO LIGHT (CartoDB – claro limpio)
//https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png

// 10) CARTO DARK (CartoDB – oscuro moderno)
//https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png
// ===================================================
// V2V - SISTEMA PRINCIPAL FRONTEND
// Archivo: main.js
// ===================================================

// ===================================================
// BLOQUE 1 - INICIALIZACIÓN
// ===================================================

const socket = io();
const map = L.map('map').setView([-34.6037, -58.3816], 13);
L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png').addTo(map);

let markers = {};
let miPosicion = null;
let miMarker = null; // Marcador propio
let contactoActivo = null;
let conversaciones = {}; // { remitente: [mensajes] }

const campos = ['nombre','vehiculo','placa','seguro','contacto'];

// LocalStorage datos vehículo
campos.forEach(id=>{
    const el = document.getElementById(id);
    const val = localStorage.getItem(id);
    if(val) el.value = val;
    el.addEventListener('input',()=>localStorage.setItem(id, el.value));
});

// Cola de promesas
function encolar(fn){
    window.cola = window.cola || Promise.resolve();
    window.cola = window.cola.then(()=>fn()).catch(e=>console.error(e));
    return window.cola;
}

// Enviar telemetría + crear/actualizar marcador propio
function enviarPosicion(pos){
    miPosicion = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
    };

    const data = {};
    campos.forEach(c=>data[c]=document.getElementById(c).value);
    data.lat = miPosicion.lat;
    data.lng = miPosicion.lng;
    data.velocidad = pos.coords.speed || 0;

    const nombre = (data.nombre || '').trim();
    if (!nombre) {
        console.warn("⚠️ No hay nombre ingresado → el servidor ignorará esta telemetría");
    } else {
        console.log("Enviando telemetría como:", nombre);
    }

    // Marcador propio
    if (!miMarker) {
        miMarker = L.marker([miPosicion.lat, miPosicion.lng], {
            icon: L.divIcon({
                className: 'mi-marcador',
                html: '<div class="pulsar">YO</div>',
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            })
        }).addTo(map);
        
        miMarker.bindPopup(`
            <b>YO: ${data.nombre || 'SIN NOMBRE'}</b><br>
            Vehículo: ${data.vehiculo || ''}<br>
            Velocidad: ${data.velocidad || 0} km/h
        `);
    } else {
        miMarker.slideTo([miPosicion.lat, miPosicion.lng], {
            duration: 1000,
            keepAtCenter: false
        });
    }

    // Centrar mapa la primera vez
    if (!map.getCenter().equals([miPosicion.lat, miPosicion.lng], 0.001)) {
        map.setView([miPosicion.lat, miPosicion.lng], 15);
    }

    encolar(()=>new Promise(resolve=>{
        socket.emit('telemetria', data);
        console.log("Telemetría enviada:", data.nombre, data.lat.toFixed(5), data.lng.toFixed(5));
        resolve();
    }));
}

// Geolocalización periódica
if(navigator.geolocation){
    setInterval(()=>navigator.geolocation.getCurrentPosition(enviarPosicion, err=>console.error("Geo error:", err)), 5000);
} else {
    console.error("Geolocalización no soportada por el navegador");
}

// Distancia Haversine
function calcularDistanciaKm(lat1, lon1, lat2, lon2){
    const R = 6371;
    const dLat = (lat2-lat1) * Math.PI/180;
    const dLon = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Renderizar contactos cercanos → incluye SIEMPRE "YO"
function renderizarContactos(autos) {
    const contenedor = document.getElementById('listaContactos');
    if (!contenedor) {
        console.error("No se encontró #listaContactos en el DOM");
        return;
    }

    if (!miPosicion) {
        console.warn("renderizarContactos llamado pero miPosicion aún no está seteada");
        contenedor.innerHTML = '<div class="info">Esperando tu ubicación...</div>';
        return;
    }

    const radioKm = parseFloat(document.getElementById('radioFiltro')?.value) || 50;
    const miNombre = (document.getElementById('nombre')?.value || '').trim() || 'YO';

    console.log(`[CONTACTOS] Renderizando - miNombre: "${miNombre}", radio: ${radioKm} km, autos recibidos: ${Object.keys(autos).length}`);

    contenedor.innerHTML = '';

    let yoYaAparece = false;
    let encontrados = 0;

    for (let username in autos) {
        const a = autos[username];
        if (!a.lat || !a.lng) continue;

        const dist = calcularDistanciaKm(miPosicion.lat, miPosicion.lng, a.lat, a.lng);
        console.log(` → ${username} (${a.nombre || '?'}) a ${dist.toFixed(1)} km`);

        if (dist <= radioKm) {
            encontrados++;
            const esYo = username === miNombre;

            const div = document.createElement('div');
            div.className = 'contacto' + (esYo ? ' yo' : '');
            div.innerHTML = `
                <b>👤</b><br>
                <b>${a.nombre || username || 'ANÓNIMO'}</b><br>
                ${a.vehiculo || ''}<br>
                <span>${dist.toFixed(1)} km${esYo ? ' (yo)' : ''}</span>
            `;

            if (!esYo) {
                div.onclick = () => seleccionarContacto(username, a);
                div.style.cursor = 'pointer';
            } else {
                yoYaAparece = true;
                div.style.opacity = '0.7';
                div.style.border = '2px dashed #00ff88';
            }

            contenedor.appendChild(div);
        }
    }

    if (encontrados === 0) {
        contenedor.innerHTML = '<div class="info">No hay contactos dentro del radio seleccionado</div>';
    }

    // Forzar YO si no apareció (por si el servidor no devolvió tu propio dato todavía)
    if (!yoYaAparece && miNombre !== 'YO') {
        const div = document.createElement('div');
        div.className = 'contacto yo';
        div.innerHTML = `
            <b>👤</b><br>
            <b>${miNombre}</b><br>
            ${document.getElementById('vehiculo')?.value || ''}<br>
            <span>0.0 km (yo)</span>
        `;
        div.style.opacity = '0.7';
        div.style.border = '2px dashed #00ff88';
        contenedor.appendChild(div);
    }

    console.log(`[CONTACTOS] Render finalizado - encontrados dentro del radio: ${encontrados}`);
}

// Seleccionar contacto (solo para otros)
function seleccionarContacto(username, datos){
    contactoActivo = username;
    const elem = document.getElementById('contactoSeleccionado');
    if (elem) {
        elem.innerHTML = `<b>👤 </b><b>${datos.nombre || username}</b> - ${datos.vehiculo || ''}`;
    }
    const msgs = document.getElementById('msgsPrivado');
    if (msgs) msgs.innerHTML = '';
    
    if (conversaciones[username]) {
        conversaciones[username].forEach(msg => {
            agregarMensajePrivado(msg.from === 'yo' ? 'YO: ' + msg.text : 'EL: ' + msg.text);
        });
    }
}

// Enviar privado texto
function enviarPrivado(){
    const txt = document.getElementById('txtPrivado');
    if(!txt?.value.trim() || !contactoActivo) return;
    socket.emit('private message', { to: contactoActivo, text: txt.value });
    agregarMensajePrivado("YO: " + txt.value);
    agregarAMensajesRecibidos(contactoActivo, { from: 'yo', text: txt.value });
    txt.value = '';
}

// Enviar privado voz
function hablarPrivado(){
    if(!contactoActivo) return alert("Seleccioná un contacto primero");
    vozATexto(texto=>{
        if(!texto) return;
        socket.emit('private message', { to: contactoActivo, text: texto });
        agregarMensajePrivado("YO: " + texto);
        agregarAMensajesRecibidos(contactoActivo, { from: 'yo', text: texto });
    });
}

// Recibir mensaje privado
socket.on('private message', msg=>{
    const remitente = msg.from;
    agregarAMensajesRecibidos(remitente, { from: 'el', text: msg.text });

    if(remitente === contactoActivo){
        agregarMensajePrivado("EL: " + msg.text);
        textoAVoz(msg.text);
    } else {
        console.log(`[PRIV] Nuevo mensaje de ${remitente}: ${msg.text}`);
    }
});

// Agregar a sección recibidos
function agregarAMensajesRecibidos(remitente, msg){
    if (!conversaciones[remitente]) conversaciones[remitente] = [];
    conversaciones[remitente].push(msg);
    renderizarConversacionesRecibidas();
}

// Renderizar conversaciones desplegables
function renderizarConversacionesRecibidas(){
    const contenedor = document.getElementById('conversacionesRecibidas');
    if (!contenedor) return;
    contenedor.innerHTML = '';
    for (let remitente in conversaciones) {
        const details = document.createElement('details');
        details.innerHTML = `<summary>${remitente} (${conversaciones[remitente].length})</summary>`;
        const divMsgs = document.createElement('div');
        divMsgs.className = 'chat-mensajes';
        conversaciones[remitente].forEach(m => {
            const div = document.createElement('div');
            div.className = 'msg';
            div.textContent = (m.from === 'yo' ? 'YO: ' : 'EL: ') + m.text;
            divMsgs.appendChild(div);
        });
        details.appendChild(divMsgs);
        contenedor.appendChild(details);
    }
}

function agregarMensajePrivado(texto){
    const div = document.createElement('div');
    div.className = 'msg';
    div.textContent = texto;
    const cont = document.getElementById('msgsPrivado');
    if (cont) {
        cont.appendChild(div);
        cont.scrollTop = cont.scrollHeight;
    }
}

// Actualizar markers y contactos
socket.on('telemetria_global', autos=>{
    console.log("telemetria_global recibida con", Object.keys(autos).length, "vehículos");

    for(let username in autos){
        const a = autos[username];
        if(!a.lat || !a.lng) continue;

        if(!markers[username]){
            markers[username] = L.marker([a.lat, a.lng]).addTo(map);
        }

        let popupContent = `
            <b>${a.nombre || username || 'SIN NOMBRE'}</b><br>
            Vehículo: ${a.vehiculo || ''}<br>
            Placa: ${a.placa || ''}<br>
            Seguro: ${a.seguro || ''}<br>
            Contacto: ${a.contacto || ''}<br>
            Velocidad: ${a.velocidad || 0} km/h<br>
            <button onclick="seleccionarContacto('${username}', ${JSON.stringify(a).replace(/"/g,'&quot;')})">
                COMUNICAR
            </button>
        `;

        markers[username].slideTo([a.lat, a.lng], { duration: 1000, keepAtCenter: false });
        markers[username].bindPopup(popupContent);
    }

    renderizarContactos(autos);
});

// Voz → texto
function vozATexto(callback){
    if(!('webkitSpeechRecognition' in window)) return alert("Reconocimiento de voz no soportado");
    const rec = new webkitSpeechRecognition();
    rec.lang = 'es-AR';
    rec.onresult = e=>{
        const texto = e.results[0][0].transcript;
        if(callback) callback(texto);
    };
    rec.start();
}

// Texto → voz
function textoAVoz(texto){
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'es-AR';
    speechSynthesis.speak(u);
}

// Chat general
function enviarV2V(){
    const txt = document.getElementById('txtV2V');
    if(!txt?.value.trim()) return;
    socket.emit('general message', txt.value);
    txt.value = '';
}

socket.on('general message', msg=>{
    const div = document.createElement('div');
    div.className = 'msg';
    div.textContent = msg;
    const cont = document.getElementById('msgsV2V');
    if (cont) {
        cont.appendChild(div);
        cont.scrollTop = cont.scrollHeight;
    }
});

// Drawer móvil
function toggleComms(){
    document.getElementById('commsPanel')?.classList.toggle('open');
}

// Para debug: ver cuando se conecta y se setea username
socket.on('connect', () => {
    console.log("Socket conectado:", socket.id);
});

socket.on('username set', (nombre) => {
    console.log("Username confirmado por el servidor:", nombre);
});