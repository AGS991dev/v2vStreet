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
let contactoActivo = null;

const campos = ['nombre','vehiculo','placa','seguro','contacto'];

// ===================================================
// FUNCIÓN 01 - LocalStorage datos vehículo
// ===================================================
campos.forEach(id=>{
    const el = document.getElementById(id);
    const val = localStorage.getItem(id);
    if(val) el.value = val;
    el.addEventListener('input',()=>localStorage.setItem(id, el.value));
});

// ===================================================
// FUNCIÓN 02 - Cola de promesas
// ===================================================
function encolar(fn){
    window.cola = window.cola || Promise.resolve();
    window.cola = window.cola.then(()=>fn()).catch(e=>console.error(e));
    return window.cola;
}

// ===================================================
// FUNCIÓN 03 - Enviar telemetría
// ===================================================
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

    encolar(()=>new Promise(resolve=>{
        socket.emit('telemetria', data);
        resolve();
    }));
}

// ===================================================
// FUNCIÓN 04 - Geolocalización periódica
// ===================================================
if(navigator.geolocation){
    setInterval(()=>navigator.geolocation.getCurrentPosition(enviarPosicion),2000);
}

// ===================================================
// FUNCIÓN 05 - Cálculo de distancia (Haversine)
// ===================================================
function calcularDistanciaKm(lat1, lon1, lat2, lon2){
    const R = 6371;
    const dLat = (lat2-lat1) * Math.PI/180;
    const dLon = (lon2-lon1) * Math.PI/180;
    const a =
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// ===================================================
// FUNCIÓN 06 - Renderizar lista de contactos cercanos
// ===================================================
function renderizarContactos(autos){
    if(!miPosicion) return;

    const radioKm = parseFloat(document.getElementById('radioFiltro').value);
    const contenedor = document.getElementById('listaContactos');
    contenedor.innerHTML = '';

    for(let id in autos){
        const a = autos[id];
        if(!a.lat || !a.lng) continue;

        const dist = calcularDistanciaKm(miPosicion.lat, miPosicion.lng, a.lat, a.lng);

        if(dist <= radioKm){
            const div = document.createElement('div');
            div.className = 'contacto';
            div.innerHTML = `
                <b>👤</b><br>
                <b>${a.nombre || 'SIN NOMBRE'}</b><br>
                ${a.vehiculo || ''}<br>
                <span>${dist.toFixed(1)} km</span>
            `;
            div.onclick = ()=>seleccionarContacto(id, a);
            contenedor.appendChild(div);
        }
    }
}

// ===================================================
// FUNCIÓN 07 - Seleccionar contacto para chat privado
// ===================================================
function seleccionarContacto(id, datos){
    contactoActivo = id;
    document.getElementById('contactoSeleccionado').innerHTML =
        `<b>👤 </b><b>${datos.nombre}</b> - ${datos.vehiculo}`;
    document.getElementById('msgsPrivado').innerHTML = '';
}

// ===================================================
// FUNCIÓN 08 - Enviar mensaje privado texto
// ===================================================
function enviarPrivado(){
    const txt = document.getElementById('txtPrivado');
    if(!txt.value.trim() || !contactoActivo) return;

    socket.emit('mensajePrivado', { id: contactoActivo, mensaje: txt.value });
    agregarMensajePrivado("YO: " + txt.value);
    txt.value = '';
}

// ===================================================
// FUNCIÓN 09 - Enviar mensaje privado por voz
// ===================================================
function hablarPrivado(){
    if(!contactoActivo) return alert("Seleccioná un contacto primero");
    vozATexto(texto=>{
        if(!texto) return;
        socket.emit('mensajePrivado', { id: contactoActivo, mensaje: texto });
        agregarMensajePrivado("YO: " + texto);
    });
}

// ===================================================
// FUNCIÓN 10 - Mostrar mensajes privados recibidos
// ===================================================
socket.on('mensajePrivado', data=>{
    if(data.id === contactoActivo){
        agregarMensajePrivado("EL: " + data.mensaje);
        textoAVoz(data.mensaje);
    }
});

// ===================================================
// FUNCIÓN 11 - Agregar mensaje a ventana privada
// ===================================================
function agregarMensajePrivado(texto){
    const div = document.createElement('div');
    div.className = 'msg';
    div.textContent = texto;
    const cont = document.getElementById('msgsPrivado');
    cont.appendChild(div);
    cont.scrollTop = cont.scrollHeight;
}

// ===================================================
// FUNCIÓN 12 - Actualizar markers y contactos
// ===================================================
socket.on('telemetria_global', autos=>{
    for(let id in autos){
        const a = autos[id];
        if(!markers[id]){
            markers[id] = L.marker([a.lat,a.lng]).addTo(map);
        }

        let popupContent = `
            <b>${a.nombre || 'SIN NOMBRE'}</b><br>
            Vehículo: ${a.vehiculo || ''}<br>
            Placa: ${a.placa || ''}<br>
            Seguro: ${a.seguro || ''}<br>
            Contacto: ${a.contacto || ''}<br>
            Velocidad: ${a.velocidad || 0} km/h<br>
            <button onclick="seleccionarContacto('${id}', ${JSON.stringify(a).replace(/"/g,'&quot;')})">
                COMUNICAR
            </button>
        `;

        if (!markers[id]._slideTo) {
            // Primera vez: lo posiciona directo
            markers[id].setLatLng([a.lat, a.lng]);
        } else {
            // Movimiento suave
            markers[id].slideTo([a.lat, a.lng], {
                duration: 1000,      // ms
                keepAtCenter: false
            });
        }

        markers[id].bindPopup(popupContent);

    }

    renderizarContactos(autos);
});


// ===================================================
// FUNCIÓN 13 - Voz a texto
// ===================================================
function vozATexto(callback){
    if(!('webkitSpeechRecognition' in window)) return alert("No soportado");
    const rec = new webkitSpeechRecognition();
    rec.lang = 'es-AR';
    rec.onresult = e=>{
        const texto = e.results[0][0].transcript;
        if(callback) callback(texto);
    };
    rec.start();
}

// ===================================================
// FUNCIÓN 14 - Texto a voz
// ===================================================
function textoAVoz(texto){
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'es-AR';
    speechSynthesis.speak(u);
}

// ===================================================
// FUNCIÓN 15 - Chat general
// ===================================================
function enviarV2V(){
    const txt = document.getElementById('txtV2V');
    if(!txt.value.trim()) return;
    socket.emit('mensajeV2V', txt.value);
    txt.value = '';
}

socket.on('mensajeV2V', msg=>{
    const div = document.createElement('div');
    div.className = 'msg';
    div.textContent = msg;
    const cont = document.getElementById('msgsV2V');
    cont.appendChild(div);
    cont.scrollTop = cont.scrollHeight;
});

// ===================================================
// FUNCIÓN 16 - Drawer móvil
// ===================================================
function toggleComms(){
    document.getElementById('commsPanel').classList.toggle('open');
}
