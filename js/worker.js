// 画像AI（DINOv2）をスマホ内で動かす係。画面が固まらないよう別スレッドで動かす。
// 映像はこのスレッドの中で計算するだけで、外へは送らない。
/* global ort, importScripts */
importScripts('../vendor/ort/ort.wasm.min.js');

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const MODEL_URL = '../model/dinov2-small-quantized.onnx';
const MODEL_CACHE = 'monosagashi-model-v1';

let session = null;

async function fetchModel(onProgress) {
  let cache = null;
  try { cache = await caches.open(MODEL_CACHE); } catch { /* 使えない環境では毎回読む */ }
  if (cache) {
    const hit = await cache.match(MODEL_URL);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  }
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error('モデルを読めませんでした（' + res.status + '）');
  const total = Number(res.headers.get('Content-Length')) || 24446700;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.length; }
  if (cache) {
    try { await cache.put(MODEL_URL, new Response(bytes.slice())); } catch { /* 容量不足でも動かす */ }
  }
  return bytes;
}

async function init() {
  const isolated = self.crossOriginIsolated === true;
  const cores = self.navigator.hardwareConcurrency || 2;
  ort.env.wasm.wasmPaths = new URL('../vendor/ort/', self.location.href).href;
  ort.env.wasm.numThreads = isolated ? Math.min(4, Math.max(1, cores - 1)) : 1;
  const bytes = await fetchModel((p) => self.postMessage({ type: 'progress', value: p }));
  self.postMessage({ type: 'progress', value: 1, note: 'prepare' });
  session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  return { threads: ort.env.wasm.numThreads, isolated };
}

// RGBA の並びを、モデルの入力（[1,3,高さ,幅]、色は標準化）へ
function toInput(rgba, w, h) {
  const n = w * h;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    data[i] = (rgba[j] / 255 - MEAN[0]) / STD[0];
    data[i + n] = (rgba[j + 1] / 255 - MEAN[1]) / STD[1];
    data[i + 2 * n] = (rgba[j + 2] / 255 - MEAN[2]) / STD[2];
  }
  return new ort.Tensor('float32', data, [1, 3, h, w]);
}

function normalizeRows(arr, rows, dim) {
  for (let r = 0; r < rows; r++) {
    let s = 0;
    const o = r * dim;
    for (let d = 0; d < dim; d++) s += arr[o + d] * arr[o + d];
    s = Math.sqrt(s) || 1;
    for (let d = 0; d < dim; d++) arr[o + d] /= s;
  }
  return arr;
}

async function embed(rgba, w, h) {
  const t0 = performance.now();
  const input = toInput(rgba, w, h);
  const out = await session.run({ [session.inputNames[0]]: input });
  const tensor = out[session.outputNames[0]];
  const [, tokens, dim] = tensor.dims;
  const raw = tensor.data;
  const gw = Math.floor(w / 14);
  const gh = Math.floor(h / 14);
  const skip = tokens - gw * gh; // 先頭は全体を表す1個（CLS）
  const cls = normalizeRows(raw.slice(0, dim), 1, dim);
  const patches = normalizeRows(raw.slice(skip * dim), gw * gh, dim);
  return { cls, patches, gw, gh, dim, ms: performance.now() - t0 };
}

self.onmessage = async (ev) => {
  const { id, type } = ev.data;
  try {
    if (type === 'init') {
      self.postMessage({ id, ok: true, result: await init() });
    } else if (type === 'embed') {
      const { rgba, w, h } = ev.data;
      const result = await embed(rgba, w, h);
      self.postMessage({ id, ok: true, result }, [result.cls.buffer, result.patches.buffer]);
    }
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message ? e.message : e) });
  }
};
