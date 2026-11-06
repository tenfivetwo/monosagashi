// 自分のサイトの応答に COOP/COEP を足す（複数スレッドで速く動かすため）。
// 通信がないときは、前回読んだ画面の部品で動くようにもする。
const CACHE = 'monosagashi-app-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function withHeaders(res) {
  if (res.status === 0) return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const big = url.pathname.endsWith('.onnx'); // モデルは worker.js が別に保管する
    try {
      const res = await fetch(e.request);
      if (res.ok && !big) {
        const cache = await caches.open(CACHE);
        await cache.put(e.request, res.clone());
      }
      return withHeaders(res);
    } catch (err) {
      const hit = await caches.match(e.request);
      if (hit) return withHeaders(hit);
      throw err;
    }
  })());
});
