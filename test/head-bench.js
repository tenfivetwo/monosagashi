// 判定役の試験（開発用）。描いた品物を、似た物が散らかった部屋に置き、
// 「品物がある部屋の点」と「品物がない部屋の点」がどれだけ分かれるかを、今のやり方と判定役ありで比べる。
// 描いた絵なので実物より単純。混ぜる割合の見当をつけるためのもの。
import { loadEngine, embedRegion, fitSize } from '../js/engine.js';
import { embedView } from '../js/scan.js';
import { buildProfile, scoreMap, findCandidates, verifyCrop, finalScore, HEAD } from '../js/matcher.js';

const logEl = document.getElementById('log');
const lines = [];
function log(s) { lines.push(s); logEl.textContent = lines.join('\n'); }

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const PALETTE = ['#c62828', '#fdd835', '#1565c0', '#2e7d32', '#6a1b9a', '#ef6c00', '#00838f', '#f5f5f5', '#212121', '#ad1457', '#8d6e63'];

// 品物：色と形の組み合わせ（200×200 の中に描く）
function makeItem(seed) {
  const r = rng(seed);
  const parts = [];
  const n = 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    parts.push({
      kind: ['rect', 'circle', 'ring', 'stripes', 'tri', 'text'][Math.floor(r() * 6)],
      color: PALETTE[Math.floor(r() * PALETTE.length)],
      color2: PALETTE[Math.floor(r() * PALETTE.length)],
      x: -60 + r() * 120, y: -60 + r() * 120, s: 40 + r() * 70, a: r() * 3,
      text: String.fromCharCode(65 + Math.floor(r() * 26)) + Math.floor(r() * 10),
    });
  }
  const base = PALETTE[Math.floor(r() * PALETTE.length)];
  return function draw(g, ox, oy, angle, size) {
    g.save();
    g.translate(ox, oy);
    g.rotate(angle);
    g.scale(size / 200, size / 200);
    g.fillStyle = base;
    g.fillRect(-90, -90, 180, 180);
    for (const p of parts) {
      g.save();
      g.translate(p.x * 0.7, p.y * 0.7);
      g.rotate(p.a);
      g.fillStyle = p.color;
      g.strokeStyle = p.color;
      if (p.kind === 'rect') g.fillRect(-p.s / 2, -p.s / 3, p.s, p.s / 1.5);
      else if (p.kind === 'circle') { g.beginPath(); g.arc(0, 0, p.s / 2, 0, Math.PI * 2); g.fill(); }
      else if (p.kind === 'ring') { g.lineWidth = p.s / 6; g.beginPath(); g.arc(0, 0, p.s / 2.5, 0, Math.PI * 2); g.stroke(); }
      else if (p.kind === 'stripes') { for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? p.color : p.color2; g.fillRect(-p.s / 2, -p.s / 2 + k * p.s / 4, p.s, p.s / 4); } }
      else if (p.kind === 'tri') { g.beginPath(); g.moveTo(0, -p.s / 2); g.lineTo(p.s / 2, p.s / 2); g.lineTo(-p.s / 2, p.s / 2); g.fill(); }
      else { g.font = 'bold ' + Math.round(p.s / 1.6) + 'px sans-serif'; g.fillText(p.text, -p.s / 2, p.s / 4); }
      g.restore();
    }
    g.restore();
  };
}

// 登録写真：明るい机の上、正面
function studio(item, angle, seed) {
  const r = rng(seed);
  const c = document.createElement('canvas');
  c.width = 800; c.height = 600;
  const g = c.getContext('2d');
  g.fillStyle = '#d6d2ca';
  g.fillRect(0, 0, 800, 600);
  for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.05})`; g.fillRect(r() * 800, r() * 600, 30, 30); }
  item(g, 400, 300, angle, 320);
  const s = 320 * 1.3;
  return { canvas: c, box: { x: (400 - s / 2) / 800, y: (300 - s / 2) / 600, w: s / 800, h: s / 600 } };
}

// 部屋：家ごとの床と照明、散らかった物と、似た作りの別の品物
function room(house, scene, item, distractors) {
  const hr = rng(house * 7919);
  const floorHue = Math.floor(hr() * 360);
  const tint = `rgba(${Math.floor(hr() * 255)},${Math.floor(hr() * 200)},${Math.floor(hr() * 120)},0.15)`;
  const dark = 0.25 + hr() * 0.3;
  const r = rng(house * 104729 + scene * 31);
  const c = document.createElement('canvas');
  c.width = 1000; c.height = 750;
  const g = c.getContext('2d');
  g.fillStyle = `hsl(${floorHue},25%,40%)`;
  g.fillRect(0, 0, 1000, 750);
  for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.15})`; g.fillRect(0, r() * 750, 1000, 3 + r() * 10); }
  for (let i = 0; i < 18; i++) {
    g.fillStyle = PALETTE[Math.floor(r() * PALETTE.length)];
    g.save(); g.translate(r() * 1000, r() * 750); g.rotate(r() * 3);
    g.fillRect(-40, -25, 50 + r() * 90, 30 + r() * 60); g.restore();
  }
  for (const d of distractors) d(g, 80 + r() * 840, 80 + r() * 590, r() * 6.28, 110 + r() * 60);
  let truth = null;
  if (item) {
    const x = 150 + r() * 700;
    const y = 150 + r() * 450;
    const size = 110 + r() * 60;
    item(g, x, y, r() * 6.28, size);
    truth = { x, y, size };
  }
  g.fillStyle = `rgba(0,0,0,${dark})`;
  g.fillRect(0, 0, 1000, 750);
  g.fillStyle = tint;
  g.fillRect(0, 0, 1000, 750);
  return { canvas: c, truth };
}

// 読み取り結果を覚えておく（混ぜる割合を変えて何度も調べるため）
const cache = new Map();
async function embedCached(key, source, rect, w, h) {
  const k = key + '|' + [rect.x, rect.y, rect.w, rect.h].map((v) => Math.round(v)).join(',') + '|' + w + 'x' + h;
  if (!cache.has(k)) cache.set(k, await embedRegion(source, rect, w, h));
  return cache.get(k);
}

// scan.js の scanRegion と同じ手順（全体のみ・候補2つ）
async function scanCached(key, source, profile) {
  const W = source.width;
  const H = source.height;
  const size = fitSize(W, H, 378);
  const frame = await embedCached(key, source, { x: 0, y: 0, w: W, h: H }, size.w, size.h);
  const map = scoreMap(frame, profile);
  const found = findCandidates(map, frame.gw, frame.gh, 2);
  let best = null;
  for (const c of found) {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const side = Math.max(W * c.w * 1.35, H * c.h * 1.35, Math.min(W, H) * 0.14);
    const x = Math.max(0, W * cx - side / 2);
    const y = Math.max(0, H * cy - side / 2);
    const rect = { x, y, w: Math.min(W - x, side), h: Math.min(H - y, side) };
    const cs = fitSize(rect.w, rect.h, 224);
    const crop = await embedCached(key, source, rect, cs.w, cs.h);
    const score = finalScore(verifyCrop(crop, profile));
    if (!best || score > best.score) best = { score, center: { x: W * cx, y: H * cy } };
  }
  return best;
}

// 品物がある部屋の点が、品物がない部屋の点より上になる割合（1 なら完全に分かれる）
function auc(pos, neg) {
  let win = 0;
  for (const p of pos) for (const n of neg) win += p > n ? 1 : p === n ? 0.5 : 0;
  return win / (pos.length * neg.length);
}

const CONFIGS = [
  { name: '今のやり方', mapMix: 0, scoreWeight: 0 },
  { name: '地図だけ0.5', mapMix: 0.5, scoreWeight: 0 },
  { name: '点だけ0.3', mapMix: 0, scoreWeight: 0.3 },
  { name: '地図0.3＋点0.3', mapMix: 0.3, scoreWeight: 0.3 },
  { name: '地図0.5＋点0.3', mapMix: 0.5, scoreWeight: 0.3 },
  { name: '地図0.5＋点0.6', mapMix: 0.5, scoreWeight: 0.6 },
];
const ITEM_COUNT = 6;
const ROOMS_WITH = 8;
const ROOMS_WITHOUT = 8;

async function main() {
  await loadEngine((p) => { logEl.textContent = 'AI を準備しています… ' + Math.round(p * 100) + '%'; });
  log('AI 準備完了。品物 ' + ITEM_COUNT + ' 個 × 部屋 ' + (ROOMS_WITH + ROOMS_WITHOUT) + ' 部屋');
  const results = {}; // [条件][設定] → { pos: [], neg: [], hit: 件数 }
  const trainMs = [];
  for (let k = 0; k < ITEM_COUNT; k++) {
    const item = makeItem(1000 + k);
    const distractors = [makeItem(2000 + k), makeItem(3000 + k), makeItem(4000 + k)];
    const house = 10 + k;
    const views = [];
    for (const [a, sd] of [[0, 1], [0.7, 2]]) {
      const st = studio(item, a, k * 10 + sd);
      views.push(await embedView(st.canvas, st.box));
    }
    // 「これだ！」で覚えた姿（同じ家の別の場面）
    const learned = [];
    for (const sc of [1, 2]) {
      const rm = room(house, sc, item, distractors);
      const s = rm.truth.size * 1.35;
      const box = { x: (rm.truth.x - s / 2) / 1000, y: (rm.truth.y - s / 2) / 750, w: s / 1000, h: s / 750 };
      learned.push(await embedView(rm.canvas, box));
    }
    const conditions = {
      '登録写真だけ': buildProfile(views, [], { head: true }),
      '覚えた姿2枚あり': buildProfile([...views, ...learned], [], { head: true }),
    };
    for (const p of Object.values(conditions)) if (p.head) trainMs.push(p.head.ms);

    const testRooms = [];
    for (let i = 0; i < ROOMS_WITH; i++) testRooms.push({ key: `k${k}w${i}`, ...room(house, 100 + i, item, distractors) });
    for (let i = 0; i < ROOMS_WITHOUT; i++) testRooms.push({ key: `k${k}n${i}`, ...room(house, 200 + i, null, distractors) });

    for (const [cname, profile] of Object.entries(conditions)) {
      for (const cf of CONFIGS) {
        HEAD.mapMix = cf.mapMix;
        HEAD.scoreWeight = cf.scoreWeight;
        const bucket = ((results[cname] ||= {})[cf.name] ||= { pos: [], neg: [], hit: 0, posN: 0 });
        for (const tr of testRooms) {
          const best = await scanCached(tr.key, tr.canvas, profile);
          const score = best ? best.score : -1;
          if (tr.truth) {
            const ok = best && Math.hypot(best.center.x - tr.truth.x, best.center.y - tr.truth.y) < tr.truth.size;
            bucket.posN++;
            if (ok) bucket.hit++;
            bucket.pos.push(ok ? score : -1); // 違う場所を指したら見逃しと同じ
          } else {
            bucket.neg.push(score);
          }
        }
      }
    }
    log(`品物 ${k + 1}/${ITEM_COUNT} 済み（読み取り ${cache.size} 回）`);
  }
  HEAD.mapMix = 0.5;
  HEAD.scoreWeight = 0;
  log('');
  log('学習の時間（1回）：平均 ' + Math.round(trainMs.reduce((a, b) => a + b, 0) / trainMs.length) + ' ms');
  const summary = {};
  for (const [cname, byCfg] of Object.entries(results)) {
    log('');
    log('■ ' + cname);
    log('設定\t分かれ具合(AUC)\t正しい場所を指した\t品物ありの点の中央\t品物なしの点の最大');
    for (const [name, b] of Object.entries(byCfg)) {
      const med = [...b.pos].sort((x, y) => x - y)[Math.floor(b.pos.length / 2)];
      const a = auc(b.pos, b.neg);
      log(`${name}\t${a.toFixed(3)}\t${b.hit}/${b.posN}\t${med.toFixed(2)}\t${Math.max(...b.neg).toFixed(2)}`);
      (summary[cname] ||= {})[name] = { auc: +a.toFixed(3), hit: b.hit + '/' + b.posN, med: +med.toFixed(2), negMax: +Math.max(...b.neg).toFixed(2) };
    }
  }
  window.__headBench = summary;
}

main().catch((e) => log('失敗：' + e.message));
