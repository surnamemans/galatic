/* Enhanced service worker: caches core assets, supports OneFile offline fallback,
   and respects uv routing when relevant. This replaces or extends existing uv/sw.js.
*/
importScripts('uv.bundle.js');
importScripts('uv.config.js');
importScripts(__uv$config.sw || 'uv.sw.js');

const CACHE_NAME = 'nautilusos-core-v1';
const CORE_ASSETS = [
    '/', // index.html (depends on hosting)
    '/index.html',
    '/style.css',
    '/js/app-bootstrap.js', // add your bootstrap entry if exists
    '/NautilusOS-OneFile/index.html'
];

const uv = new UVServiceWorker();
let config = {
    blocklist: new Set(),
}

async function precache() {
    try {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(CORE_ASSETS.map(p => new Request(p, { cache: 'reload' })));
    } catch (e) {
        console.warn('Precache failed', e);
    }
}

// handle requests: allow uv routing, otherwise serve from network-first for API/online assets,
// and cache-first for static assets; fallback to OneFile for navigation pages
async function handleRequest(event) {
    const req = event.request;
    const url = new URL(req.url);

    // Prefer uv routing for proxied requests
    if (uv.route(event)) {
        if (config.blocklist.size !== 0) {
            let decodedUrl = new URL(__uv$config.decodeUrl(new URL(event.request.url).pathname.slice(__uv$config.prefix.length)));
            if (config.blocklist.has(decodedUrl.hostname)) {
                return new Response("", { status: 404 });
            }
        }
        return await uv.fetch(event);
    }

    // Navigation requests -> network-first with fallback to cached OneFile
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
        try {
            const networkResp = await fetch(req);
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, networkResp.clone());
            return networkResp;
        } catch (err) {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match('/NautilusOS-OneFile/index.html') || await cache.match('/index.html');
            return cached || Response.error();
        }
    }

    // Static assets: CSS/JS/Images -> cache-first
    if (/\.(css|js|png|jpg|jpeg|svg|gif|webp|woff2?)$/.test(url.pathname.toLowerCase())) {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
            const resp = await fetch(req);
            cache.put(req, resp.clone());
            return resp;
        } catch (e) {
            return fetch(req); // final attempt
        }
    }

    // default: network then cache fallback
    try {
        return await fetch(req);
    } catch (e) {
        const cache = await caches.open(CACHE_NAME);
        return await cache.match(req) || Response.error();
    }
}

self.addEventListener('install', (event) => {
    event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', () => {
    // cleanup old caches optionally
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => {
            if (k !== CACHE_NAME) return caches.delete(k);
        }));
        const bc = new BroadcastChannel("UvServiceWorker");
        bc.postMessage("Active");
        self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    event.respondWith(handleRequest(event));
});

self.addEventListener("message", (event) => {
    if (event.data && event.data.type === 'UPDATE_BLOCKLIST') {
        config.blocklist = new Set(event.data.blocklist || []);
    } else if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.delete(CACHE_NAME);
    } else {
        config = event.data || config;
    }
});