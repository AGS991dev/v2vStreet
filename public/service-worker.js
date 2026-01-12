self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'Hola', body: 'Leyenda de ejemplo' };

  // Mostrar notificación
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png'
    })
  );

  // Ejecutar Text-to-Speech cuando llega la notificación
  // Nota: Esto solo funciona si la app está abierta o el navegador permite usar clientes
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        for (const client of clients) {
          client.postMessage({
            type: 'TTS',
            text: data.body
          });
        }
      })
  );
});

// Recibir mensaje en el cliente para hablar
self.addEventListener('message', event => {
  if (event.data.type === 'TTS') {
    const utter = new SpeechSynthesisUtterance(event.data.text);
    speechSynthesis.speak(utter);
  }
});
