// worker.js への窓口。画像（の一部）を渡すと特徴が返る。

const PATCH = 14;
let worker = null;
let seq = 0;
const waiting = new Map();
let progressFn = null;
let readyPromise = null;

function call(msg, transfer) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer || []);
  });
}

export function loadEngine(onProgress) {
  progressFn = onProgress || progressFn;
  if (readyPromise) return readyPromise;
  worker = new Worker(new URL('./worker.js', import.meta.url));
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'progress') { if (progressFn) progressFn(m.value, m.note); return; }
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.ok) w.resolve(m.result); else w.reject(new Error(m.error));
  };
  worker.onerror = (e) => {
    for (const w of waiting.values()) w.reject(new Error(e.message || '計算係でエラー'));
    waiting.clear();
  };
  readyPromise = call({ type: 'init' });
  return readyPromise;
}

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// 14 の倍数に丸めた、モデルへ入れる大きさ
export function fitSize(srcW, srcH, longSide) {
  const scale = longSide / Math.max(srcW, srcH);
  const w = Math.max(PATCH * 4, Math.round((srcW * scale) / PATCH) * PATCH);
  const h = Math.max(PATCH * 4, Math.round((srcH * scale) / PATCH) * PATCH);
  return { w, h };
}

// source の rect（元画像のピクセル）を w×h にして特徴を取る
export async function embedRegion(source, rect, w, h) {
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const rgba = new Uint8ClampedArray(data); // 複製を渡す
  return call({ type: 'embed', rgba, w, h }, [rgba.buffer]);
}
