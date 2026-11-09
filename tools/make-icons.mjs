// icon.svg から PNG のアイコンを作る道具。
// 使い方：node tools/make-icons.mjs  → 表示された URL をブラウザで開くと、icons/ に PNG を書き出す。
// 絵（icon.svg・favicon.svg）を変えたら、これで PNG も作り直す。
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'icons');
const port = Number(process.argv[2]) || 8752;

// 作るもの：name, 大きさ, 背景をぬりつぶすか, 絵の縮め方（maskable は安全な円の中に収める）, 元の絵（省くと icon.svg）
const TARGETS = [
  { name: 'favicon-32.png', size: 32, fill: false, scale: 1, src: 'favicon.svg' },
  { name: 'favicon-16.png', size: 16, fill: false, scale: 1, src: 'favicon.svg' },
  { name: 'apple-touch-icon.png', size: 180, fill: true, scale: 1 },
  { name: 'icon-192.png', size: 192, fill: false, scale: 1 },
  { name: 'icon-512.png', size: 512, fill: false, scale: 1 },
  { name: 'icon-maskable-512.png', size: 512, fill: true, scale: 0.8 },
];

const page = `<!doctype html><meta charset="utf-8"><title>アイコン書き出し</title>
<body style="background:#888;font-family:sans-serif"><p id="msg">書き出し中…</p><div id="out"></div>
<script>
const TARGETS = ${JSON.stringify(TARGETS)};
(async () => {
  const imgs = {};
  for (const name of ['icon.svg', 'favicon.svg']) {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(await (await fetch('/' + name)).text());
    await img.decode();
    imgs[name] = img;
  }
  for (const t of TARGETS) {
    const img = imgs[t.src || 'icon.svg'];
    const c = document.createElement('canvas');
    c.width = c.height = t.size;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    if (t.fill) { g.fillStyle = '#1f2a37'; g.fillRect(0, 0, t.size, t.size); }
    const s = t.size * t.scale, o = (t.size - s) / 2;
    g.drawImage(img, o, o, s, s);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const res = await fetch('/save?name=' + encodeURIComponent(t.name), { method: 'POST', body: blob });
    if (!res.ok) throw new Error(t.name + ': ' + res.status);
    c.title = t.name; c.style.margin = '8px'; c.style.verticalAlign = 'top';
    document.getElementById('out').append(c);
  }
  document.getElementById('msg').textContent = '書き出しました：' + TARGETS.map(t => t.name).join('、');
})().catch(e => { document.getElementById('msg').textContent = '失敗：' + e.message; });
</script>`;

const names = new Set(TARGETS.map(t => t.name));
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
    } else if (req.method === 'GET' && (url.pathname === '/icon.svg' || url.pathname === '/favicon.svg')) {
      res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(await readFile(path.join(root, url.pathname.slice(1))));
    } else if (req.method === 'POST' && url.pathname === '/save' && names.has(url.searchParams.get('name'))) {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, url.searchParams.get('name')), Buffer.concat(chunks));
      console.log('書き出し:', url.searchParams.get('name'));
      res.writeHead(204).end();
    } else {
      res.writeHead(404).end();
    }
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/ を開くと icons/ に PNG を書き出します`));
