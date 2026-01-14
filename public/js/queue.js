let cola = Promise.resolve();
let tareaId = 0;

function encolar(fn, nombreTarea = "") {
    const id = ++tareaId;
    const nombre = nombreTarea ? `(${nombreTarea})` : "";

    console.log(`[T${id}${nombre}] → Agregada a la cola`);

    cola = cola
        .then(() => {
            console.log(`[T${id}${nombre}] → Comenzando ejecución`);
            return fn();
        })
        .then(result => {
            console.log(`[T${id}${nombre}] → Finalizada OK`);
            return result;
        })
        .catch(error => {
            console.error(`[T${id}${nombre}] → Falló:`, error);
            throw error;
        });

    return cola;
}