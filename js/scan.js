// 登録と探索の手順。画面（app.js）と試験（test/bench.js）の両方から使う。
import { embedRegion, fitSize } from './engine.js';
import { buildProfile, scoreMap, findCandidates, verifyCrop, finalScore, negativeFrom } from './matcher.js';

export const WHOLE_LONG = 378; // 写真全体を調べるときの長辺
export const CROP_LONG = 224; // 枠の中を確かめるときの長辺

function sizeOf(src) {
  return {
    w: src.videoWidth || src.naturalWidth || src.width,
    h: src.videoHeight || src.naturalHeight || src.height,
  };
}

function clampRect(r, W, H) {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  const x2 = Math.min(W, r.x + r.w);
  const y2 = Math.min(H, r.y + r.h);
  return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
}

// 登録写真1枚を特徴にする。box は 0〜1 の枠
export async function embedView(source, box) {
  const { w: W, h: H } = sizeOf(source);
  const size = fitSize(W, H, WHOLE_LONG);
  const whole = await embedRegion(source, { x: 0, y: 0, w: W, h: H }, size.w, size.h);
  const rect = clampRect({ x: box.x * W, y: box.y * H, w: box.w * W, h: box.h * H }, W, H);
  const cropSize = fitSize(rect.w, rect.h, CROP_LONG);
  const crop = await embedRegion(source, rect, cropSize.w, cropSize.h);
  return { whole, crop, box };
}

export { buildProfile };

// 「違う」と言われた枠を、周りも含めて広めに読み取る（別の部分に反応し直さないように）
export async function embedNegative(source, box) {
  const { w: W, h: H } = sizeOf(source);
  const side = Math.max(box.w * W, box.h * H) * 1.6;
  const cx = (box.x + box.w / 2) * W;
  const cy = (box.y + box.h / 2) * H;
  const rect = clampRect({ x: cx - side / 2, y: cy - side / 2, w: side, h: side }, W, H);
  const size = fitSize(rect.w, rect.h, CROP_LONG);
  const crop = await embedRegion(source, rect, size.w, size.h);
  return negativeFrom(crop.patches, crop.gw * crop.gh, crop.dim);
}

// source の region（0〜1）の範囲を調べて候補を返す。枠は source 全体に対する 0〜1
export async function scanRegion(source, region, profile, opts = {}) {
  const { w: W, h: H } = sizeOf(source);
  const longSide = opts.longSide || WHOLE_LONG;
  const maxCandidates = opts.maxCandidates || 2;
  const rect = { x: region.x * W, y: region.y * H, w: region.w * W, h: region.h * H };
  const size = fitSize(rect.w, rect.h, longSide);
  const frame = await embedRegion(source, rect, size.w, size.h);
  const map = scoreMap(frame, profile);
  const found = findCandidates(map, frame.gw, frame.gh, maxCandidates);
  const results = [];
  let ms = frame.ms;
  for (const c of found) {
    // かたまりの周りを少し含めて切り抜く
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const pw = rect.w * c.w * 1.35;
    const ph = rect.h * c.h * 1.35;
    const side = Math.max(pw, ph, Math.min(rect.w, rect.h) * 0.14);
    const px = rect.x + rect.w * cx;
    const py = rect.y + rect.h * cy;
    const cropRect = clampRect({ x: px - side / 2, y: py - side / 2, w: side, h: side }, W, H);
    const cropSize = fitSize(cropRect.w, cropRect.h, CROP_LONG);
    const crop = await embedRegion(source, cropRect, cropSize.w, cropSize.h);
    ms += crop.ms;
    const v = verifyCrop(crop, profile);
    results.push({
      box: { x: cropRect.x / W, y: cropRect.y / H, w: cropRect.w / W, h: cropRect.h / H },
      center: { x: px / W, y: py / H },
      peak: c.peak,
      z: c.z,
      ...v,
      score: finalScore(v),
    });
  }
  results.sort((a, b) => b.score - a.score);
  return { results, map, gw: frame.gw, gh: frame.gh, ms, region };
}
