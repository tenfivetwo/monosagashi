// 「登録した品物に似た部分はどこか」を計算する部分。画面や AI の呼び出しには触らない。

const MAX_FG_PER_VIEW = 220;
const MAX_BG = 400;

// rows 行 dim 列の特徴から、等間隔に max 行だけ抜き出す
function thin(rows, count, dim, max) {
  if (count <= max) return rows.slice(0, count * dim);
  const out = new Float32Array(max * dim);
  for (let i = 0; i < max; i++) {
    const from = Math.floor((i * count) / max) * dim;
    out.set(rows.subarray(from, from + dim), i * dim);
  }
  return out;
}

function concat(list) {
  const n = list.reduce((s, a) => s + a.length, 0);
  const out = new Float32Array(n);
  let at = 0;
  for (const a of list) { out.set(a, at); at += a.length; }
  return out;
}

// whole（写真全体の特徴）を、枠の中と外に分ける
function splitByBox(whole, box) {
  const { gw, gh, dim, patches } = whole;
  const inside = [];
  const outside = [];
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const cx = (x + 0.5) / gw;
      const cy = (y + 0.5) / gh;
      const row = patches.subarray((y * gw + x) * dim, (y * gw + x + 1) * dim);
      // 枠のすぐ外は品物が混ざりやすいので背景に入れない
      const mx = 0.5 / gw;
      const my = 0.5 / gh;
      if (cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h) inside.push(row);
      else if (cx < box.x - mx || cx > box.x + box.w + mx || cy < box.y - my || cy > box.y + box.h + my) outside.push(row);
    }
  }
  return { inside, outside };
}

function maxDot(row, mat, count, dim) {
  let best = -1;
  for (let i = 0; i < count; i++) {
    let s = 0;
    const o = i * dim;
    for (let d = 0; d < dim; d++) s += row[d] * mat[o + d];
    if (s > best) best = s;
  }
  return best;
}

// 登録写真の特徴から、探すときに使う手本を作る
// views: [{ crop: 枠内を拡大した特徴, whole: 写真全体の特徴, box: 枠（0〜1） }]
export function buildProfile(views, extraNegatives = []) {
  const dim = views[0].crop.dim;
  const bgLists = [];
  for (const v of views) {
    const { outside } = splitByBox(v.whole, v.box);
    bgLists.push(...outside);
  }
  const bgAll = concat(bgLists);
  const bgCount = bgAll.length / dim;
  const bg = thin(bgAll, bgCount, dim, MAX_BG);
  const bgN = bg.length / dim;

  const outViews = [];
  const cls = new Float32Array(views.length * dim);
  views.forEach((v, vi) => {
    cls.set(v.crop.cls, vi * dim);
    const { inside } = splitByBox(v.whole, v.box);
    const rows = [];
    const cropCount = v.crop.gw * v.crop.gh;
    for (let i = 0; i < cropCount; i++) rows.push(v.crop.patches.subarray(i * dim, (i + 1) * dim));
    rows.push(...inside);
    // 背景とそっくりなマス（枠に入り込んだ背景）は手本から外す
    const kept = bgN > 0 ? rows.filter((r) => maxDot(r, bg, bgN, dim) < 0.72) : rows;
    const useRows = kept.length >= 8 ? kept : rows;
    const fg = thin(concat(useRows), useRows.length, dim, MAX_FG_PER_VIEW);
    outViews.push({ fg, count: fg.length / dim });
  });

  // 新しく教わった分を優先して、最大 640 マス（切り抜き 10 回分）だけ覚える
  const negAll = concat(extraNegatives.slice(-10));
  const negatives = thin(negAll, negAll.length / dim, dim, 640);

  return {
    dim,
    cls,
    clsCount: views.length,
    views: outViews,
    fgAll: concat(outViews.map((v) => v.fg)),
    fgCount: outViews.reduce((s, v) => s + v.count, 0),
    bg,
    bgCount: bgN,
    negatives,
    negCount: negatives.length / dim,
  };
}

// 映像の各マスについて「品物らしさ」を出す
export function scoreMap(frame, profile) {
  const { gw, gh, patches, dim } = frame;
  const n = gw * gh;
  const map = new Float32Array(n);
  const { fgAll, fgCount, bg, bgCount } = profile;
  for (let i = 0; i < n; i++) {
    const row = patches.subarray(i * dim, (i + 1) * dim);
    let a = -1;
    let b = -1;
    let c = -1; // 上位3つ
    for (let j = 0; j < fgCount; j++) {
      let s = 0;
      const o = j * dim;
      for (let d = 0; d < dim; d++) s += row[d] * fgAll[o + d];
      if (s > a) { c = b; b = a; a = s; } else if (s > b) { c = b; b = s; } else if (s > c) { c = s; }
    }
    const fg = (a + b + c) / 3;
    const bgBest = bgCount > 0 ? maxDot(row, bg, bgCount, dim) : 0;
    // 背景の方に似ているマスは減点する
    map[i] = fg - 0.5 * Math.max(0, bgBest - fg);
  }
  return map;
}

// 3×3 でならす（1マスだけの偶然の一致を消す）
function smooth(map, gw, gh) {
  const out = new Float32Array(map.length);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let s = 0;
      let w = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const k = dx === 0 && dy === 0 ? 2 : 1;
          s += map[ny * gw + nx] * k;
          w += k;
        }
      }
      out[y * gw + x] = s / w;
    }
  }
  return out;
}

// 似ているマスのかたまりを候補の枠にする（枠は 0〜1）
export function findCandidates(map, gw, gh, maxCount = 2) {
  const sm = smooth(map, gw, gh);
  let mean = 0;
  for (const v of sm) mean += v;
  mean /= sm.length;
  let vari = 0;
  for (const v of sm) vari += (v - mean) * (v - mean);
  const sd = Math.sqrt(vari / sm.length) || 1e-6;

  const used = new Uint8Array(sm.length);
  const out = [];
  for (let c = 0; c < maxCount; c++) {
    let peak = -1;
    let peakV = -Infinity;
    for (let i = 0; i < sm.length; i++) {
      if (!used[i] && sm[i] > peakV) { peakV = sm[i]; peak = i; }
    }
    if (peak < 0) break;
    const limit = mean + (peakV - mean) * 0.6;
    const stack = [peak];
    used[peak] = 1;
    let x0 = gw;
    let x1 = 0;
    let y0 = gh;
    let y1 = 0;
    while (stack.length) {
      const i = stack.pop();
      const x = i % gw;
      const y = Math.floor(i / gw);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const k = ny * gw + nx;
        if (!used[k] && sm[k] >= limit) { used[k] = 1; stack.push(k); }
      }
    }
    out.push({
      x: x0 / gw,
      y: y0 / gh,
      w: (x1 - x0 + 1) / gw,
      h: (y1 - y0 + 1) / gh,
      peak: peakV,
      z: (peakV - mean) / sd,
    });
  }
  return out;
}

// 候補の枠を切り抜いて、改めて確かめた結果を出す
export function verifyCrop(crop, profile) {
  const { patches, gw, gh, dim, cls } = crop;
  const n = gw * gh;

  // 全体の印象の近さ
  let clsSim = -1;
  for (let i = 0; i < profile.clsCount; i++) {
    let s = 0;
    for (let d = 0; d < dim; d++) s += cls[d] * profile.cls[i * dim + d];
    if (s > clsSim) clsSim = s;
  }

  // 手本のどれくらいの部分が、切り抜きの中に見つかるか（写真ごとの一番良い値）
  let coverage = 0;
  for (const v of profile.views) {
    let sum = 0;
    for (let j = 0; j < v.count; j++) {
      const row = v.fg.subarray(j * dim, (j + 1) * dim);
      sum += maxDot(row, patches, n, dim);
    }
    coverage = Math.max(coverage, sum / v.count);
  }

  // 切り抜きのマスが、手本と背景のどちらに近いか
  const fgBest = new Float32Array(n);
  let bgWin = 0;
  let negWin = 0;
  for (let i = 0; i < n; i++) {
    const row = patches.subarray(i * dim, (i + 1) * dim);
    fgBest[i] = maxDot(row, profile.fgAll, profile.fgCount, dim);
    const bgS = profile.bgCount > 0 ? maxDot(row, profile.bg, profile.bgCount, dim) : -1;
    if (bgS > fgBest[i]) bgWin++;
    // 「違う」と教えてもらった物に、手本と同じくらい似ているマスを数える
    if (profile.negCount > 0 && maxDot(row, profile.negatives, profile.negCount, dim) >= fgBest[i] - 0.03) negWin++;
  }
  const sorted = Array.from(fgBest).sort((a, b) => b - a);
  const top = sorted.slice(0, Math.max(1, Math.floor(n / 4)));
  const precision = top.reduce((s, v) => s + v, 0) / top.length;

  return { clsSim, coverage, precision, bgShare: bgWin / n, negShare: negWin / n };
}

// 「違う」と言われた切り抜きの特徴を、覚えておける大きさに減らす
export function negativeFrom(cropPatches, count, dim) {
  return thin(cropPatches, count, dim, 64);
}

// 確かめた結果を1つの点にまとめる。重みは test/bench.js の結果から決めた
export function finalScore(v) {
  // 「違う」と教えられた物に似ているほど下げる
  return 0.3 * v.clsSim + 0.7 * v.coverage - 0.6 * v.negShare;
}

// 感度ごとの境目。部屋を調べ続けて点の普段の高さが分かったら、低い部屋では境目も下げる
// （上げはしない。品物が映り続けて普段の点が上がっても、見逃さないようにするため）
export const SENSITIVITY = {
  low: { fixed: 0.45, floor: 0.34, margin: 0.16, need: 3 },
  mid: { fixed: 0.40, floor: 0.30, margin: 0.12, need: 2 },
  high: { fixed: 0.36, floor: 0.28, margin: 0.08, need: 2 },
};

export function thresholdFor(sens, recentScores) {
  const c = SENSITIVITY[sens];
  if (recentScores.length < 5) return c.fixed;
  const sorted = [...recentScores].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return Math.min(c.fixed, Math.max(c.floor, median + c.margin));
}
