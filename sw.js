const CACHE = 'kn-en-interpreter-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './offline.html'
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e=>{
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  // Network first for APIs (translation), cache first for app shell
  if (url.pathname.startsWith('/translate') || url.host.includes('libretranslate') || url.host.includes('mymemory')){
    e.respondWith(fetch(e.request).catch(()=>caches.match('offline.html')));
  } else {
    e.respondWith(
      caches.match(e.request).then(res=> res || fetch(e.request).catch(()=>caches.match('offline.html')))
    );
  }
});
