// Cola simple para enviar telemetría y otras peticiones
let cola = Promise.resolve();

function encolar(fn) {
    cola = cola.then(() => fn()).catch(e => console.error(e));
    return cola;
}
