const CACHE = "radiomap-20260821d";

self.addEventListener("install", event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll([
            "/",
            "/index.html",
            "/manifest.json",
            "/icon-192.png",
            "/icon-512.png"
        ]).catch(() => {}))
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CACHE).map(k => caches.delete(k))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.pathname.indexOf("/socket.io") === 0 || url.pathname.indexOf("/api/") === 0) return;

    if (req.mode === "navigate") {
        event.respondWith(
            fetch(req).catch(() => caches.match("/index.html"))
        );
        return;
    }

    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(req).then(hit => {
            const vivo = fetch(req).then(res => {
                if (res && res.ok) {
                    const copia = res.clone();
                    caches.open(CACHE).then(cache => cache.put(req, copia));
                }
                return res;
            }).catch(() => hit);
            return hit || vivo;
        })
    );
});
