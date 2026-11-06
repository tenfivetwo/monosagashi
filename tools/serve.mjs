// 確認用の小さな Web サーバ（127.0.0.1 だけ）。
//   node tools/serve.mjs [ポート番号] [--no-coi] [--images=試験画像のフォルダ]
//   --no-coi : GitHub Pages のように COOP/COEP の見出しを付けない（sw.js の働きを確かめる用）
//   --images : /test-images/ の下で試験画像を読めるようにする（test/bench.html 用）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a)) || 8750);
const noCoi = args.includes('--no-coi');
const imagesArg = args.find((a) => a.startsWith('--images='));
const imagesDir = imagesArg ? normalize(imagesArg.slice('--images='.length)) : null;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
};

function inside(base, file) {
  return file === base || file.startsWith(base.endsWith(sep) ? base : base + sep);
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file;
  if (imagesDir && path.startsWith('/test-images/')) {
    file = normalize(join(imagesDir, path.slice('/test-images/'.length)));
    if (!inside(imagesDir, file)) { res.writeHead(403).end(); return; }
  } else {
    file = normalize(join(root, path === '/' ? 'index.html' : path));
    if (!inside(root, file)) { res.writeHead(403).end(); return; }
  }
  try {
    const body = await readFile(file);
    const head = { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    if (!noCoi) {
      head['Cross-Origin-Opener-Policy'] = 'same-origin';
      head['Cross-Origin-Embedder-Policy'] = 'require-corp';
    }
    res.writeHead(200, head);
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port + '/'));
