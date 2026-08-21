const CACHE = "radiomap-20260821o";
const TILES = "radiomap-tiles-v1";
const TILES_MAX = 420;

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
            keys.filter(k => k !== CACHE && k !== TILES).map(k => caches.delete(k))
        )).then(() => self.clients.claim())
    );
});

function esTile(url) {
    return url.hostname.indexOf("basemaps.cartocdn.com") >= 0 ||
        url.hostname.indexOf("tile.openstreetmap.org") >= 0;
}

function recortarTiles(cache) {
    cache.keys().then(keys => {
        const extra = keys.length - TILES_MAX;
        if (extra <= 0) return;
        keys.slice(0, extra).forEach(req => cache.delete(req));
    }).catch(() => {});
}

self.addEventListener("fetch", event => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.pathname.indexOf("/socket.io") === 0 || url.pathname.indexOf("/api/") === 0) return;

    if (esTile(url)) {
        event.respondWith(
            caches.open(TILES).then(cache =>
                cache.match(req).then(hit => {
                    const vivo = fetch(req).then(res => {
                        if (res && (res.ok || res.type === "opaque")) {
                            cache.put(req, res.clone());
                            recortarTiles(cache);
                        }
                        return res;
                    }).catch(() => hit);
                    return hit || vivo;
                })
            )
        );
        return;
    }

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
