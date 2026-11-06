// 判定の試験（開発用）。品物を部屋の写真へ貼り、見つけられるか・間違えないかを数える。
// 実物を別の角度から撮ったわけではないので、結果は実機より甘く出る。
import { loadEngine } from '../js/engine.js';
import { embedView, buildProfile, scanRegion } from '../js/scan.js';
import { thresholdFor } from '../js/matcher.js';

const logEl = document.getElementById('log');
const lines = [];
function log(s) { lines.push(s); logEl.textContent = lines.join('\n'); }

const ROOMS = [139, 632, 802, 1503, 1993, 4495, 3934, 5060, 2431, 6818];
// 品物の写真と枠（0〜1）。easy=柄がある、hard=柄が少ない
const ITEMS = [
  { name: 'マグ（柄）', id: 2592, box: { x: 0.33, y: 0.10, w: 0.34, h: 0.52 }, kind: 'easy' },
  { name: 'スマホ（柄）', id: 1296, box: { x: 0.69, y: 0.22, w: 0.18, h: 0.34 }, kind: 'easy' },
  { name: '市松の旗', id: 3156, box: { x: 0.76, y: 0.39, w: 0.24, h: 0.34 }, kind: 'easy' },
  { name: 'ネクタイ（縞）', id: 4395, box: { x: 0.42, y: 0.56, w: 0.23, h: 0.42 }, kind: 'easy' },
  { name: 'ぬいぐるみ', id: 776, box: { x: 0.0, y: 0.42, w: 0.55, h: 0.58 }, kind: 'mid' },
  { name: '靴', id: 3553, box: { x: 0.25, y: 0.39, w: 0.40, h: 0.28 }, kind: 'mid' },
  { name: '青りんご（無地）', id: 2149, box: { x: 0.52, y: 0.16, w: 0.40, h: 0.57 }, kind: 'hard' },
];
const SIZES = [0.30, 0.18, 0.10]; // 貼る大きさ（部屋の写真の幅に対する品物の幅）

function loadImage(id) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('画像を読めない: ' + id));
    im.src = '/test-images/coco/' + String(id).padStart(12, '0') + '.jpg';
  });
}

function rng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// 品物を楕円に切り抜いて、回転・明るさ・傾きを変えて部屋へ貼る
function compose(room, itemImg, box, size, rand) {
  const W = room.naturalWidth;
  const H = room.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.drawImage(room, 0, 0);

  const iw = itemImg.naturalWidth * box.w;
  const ih = itemImg.naturalHeight * box.h;
  const piece = document.createElement('canvas');
  piece.width = Math.round(iw); piece.height = Math.round(ih);
  const p = piece.getContext('2d');
  p.drawImage(itemImg, itemImg.naturalWidth * box.x, itemImg.naturalHeight * box.y, iw, ih, 0, 0, iw, ih);
  p.globalCompositeOperation = 'destination-in';
  const grad = p.createRadialGradient(0, 0, 0.8, 0, 0, 1);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  p.save();
  p.translate(iw / 2, ih / 2);
  p.scale(iw / 2, ih / 2);
  p.fillStyle = grad;
  p.fillRect(-1, -1, 2, 2);
  p.restore();

  const drawW = W * size;
  const scale = drawW / Math.max(iw, ih);
  const margin = drawW * 0.6;
  const cx = margin + rand() * Math.max(1, W - 2 * margin);
  const cy = margin + rand() * Math.max(1, H - 2 * margin);
  const angle = (rand() - 0.5) * 0.9; // ±約25度
  const shear = (rand() - 0.5) * 0.3; // 見る角度の変化の代わり
  const light = 0.7 + rand() * 0.5; // 明るさ 0.7〜1.2 倍

  g.save();
  g.translate(cx, cy);
  g.rotate(angle);
  g.transform(1, 0, shear, 1, 0, 0);
  g.scale(scale, scale);
  g.filter = 'brightness(' + light.toFixed(2) + ') blur(0.5px)';
  g.drawImage(piece, -iw / 2, -ih / 2);
  g.restore();

  const hw = (iw * scale) / 2 / W;
  const hh = (ih * scale) / 2 / H;
  const R = Math.max(hw * W, hh * H) * 1.15; // 回転しても入る範囲
  return { canvas: c, truth: { x: (cx - R) / W, y: (cy - R) / H, x2: (cx + R) / W, y2: (cy + R) / H } };
}

const FULL = { x: 0, y: 0, w: 1, h: 1 };

// 全体と、中央を拡大した範囲（アプリと同じ2通り）を調べる
async function scanBoth(canvas, profile) {
  const a = await scanRegion(canvas, FULL, profile);
  // 中央の代わりに4隅へずらした拡大も試す（かざして近づいた場面の代用）
  const out = [...a.results];
  let ms = a.ms;
  for (const r of [{ x: 0, y: 0, w: 0.55, h: 0.55 }, { x: 0.45, y: 0, w: 0.55, h: 0.55 }, { x: 0, y: 0.45, w: 0.55, h: 0.55 }, { x: 0.45, y: 0.45, w: 0.55, h: 0.55 }]) {
    const b = await scanRegion(canvas, r, profile, { maxCandidates: 1 });
    out.push(...b.results);
    ms += b.ms;
  }
  return { results: out, ms, fullMs: a.ms };
}

function hit(res, truth) {
  return res.center.x >= truth.x && res.center.x <= truth.x2 && res.center.y >= truth.y && res.center.y <= truth.y2;
}

export async function run() {
  log('AI を読み込み中…');
  const info = await loadEngine();
  log('読み込み完了: ' + JSON.stringify(info));

  const rooms = [];
  for (const id of ROOMS) rooms.push(await loadImage(id));

  const positives = [];
  const negatives = [];
  const times = [];
  // 重みと境目は 12345 の結果で決めた。確認は別の並びで行う
  const seed = Number(new URLSearchParams(location.search).get('seed')) || 98765;
  const rand = rng(seed);

  for (const item of ITEMS) {
    const img = await loadImage(item.id);
    const view = await embedView(img, item.box);
    const profile = buildProfile([view]);
    log(item.name + ': 手本 ' + profile.fgCount + ' マス／背景 ' + profile.bgCount + ' マス');

    for (const size of SIZES) {
      for (let k = 0; k < 4; k++) {
        const room = rooms[Math.floor(rand() * rooms.length)];
        const { canvas, truth } = compose(room, img, item.box, size, rand);
        const scan = await scanBoth(canvas, profile);
        times.push(scan.fullMs);
        const on = scan.results.filter((r) => hit(r, truth));
        const off = scan.results.filter((r) => !hit(r, truth));
        positives.push({
          item: item.name, kind: item.kind, size,
          best: on.length ? Math.max(...on.map((r) => r.score)) : null,
          offBest: off.length ? Math.max(...off.map((r) => r.score)) : null,
          detail: on.sort((a, b) => b.score - a.score).slice(0, 1).map((r) => ({ cls: r.clsSim, cov: r.coverage, prec: r.precision, bg: r.bgShare })),
        });
      }
    }
    for (let i = 0; i < rooms.length; i++) {
      const c = document.createElement('canvas');
      c.width = rooms[i].naturalWidth; c.height = rooms[i].naturalHeight;
      c.getContext('2d').drawImage(rooms[i], 0, 0);
      const scan = await scanBoth(c, profile);
      const top = scan.results.sort((a, b) => b.score - a.score)[0];
      negatives.push({ item: item.name, kind: item.kind, room: ROOMS[i], best: top.score, cls: top.clsSim, cov: top.coverage, prec: top.precision, bg: top.bgShare });
    }
    log('  完了 ' + item.name);
  }

  const summary = summarize(positives, negatives, times);
  log(summary.text);
  window.__bench = { positives, negatives, times, summary, info };
  document.title = 'done';
  return window.__bench;
}

function summarize(pos, neg, times) {
  const out = [];
  const thresholds = {};
  for (const sens of ['low', 'mid', 'high']) {
    let fp = 0;
    const ok = {};
    const all = {};
    const perItem = [];
    for (const name of [...new Set(pos.map((p) => p.item))]) {
      // 品物なしの部屋の点を「普段の高さ」として境目を決める（アプリの動きと同じ）
      const scores = neg.filter((n) => n.item === name).map((n) => n.best);
      const t = thresholdFor(sens, scores);
      thresholds[name + '/' + sens] = t;
      fp += scores.filter((s) => s >= t).length;
      const list = pos.filter((p) => p.item === name);
      let itemOk = 0;
      for (const p of list) {
        all[p.size] = (all[p.size] || 0) + 1;
        if (p.best !== null && p.best >= t) { ok[p.size] = (ok[p.size] || 0) + 1; itemOk++; }
      }
      perItem.push(name + ' ' + itemOk + '/' + list.length);
    }
    let line = '[' + sens + '] 品物なしで反応 ' + fp + '/' + neg.length;
    for (const size of SIZES) line += ' | 幅' + Math.round(size * 100) + '%: ' + (ok[size] || 0) + '/' + all[size];
    out.push(line);
    out.push('    ' + perItem.join('、'));
  }
  const avg = times.reduce((s, v) => s + v, 0) / times.length;
  out.push('--- 1回の判定 平均 ' + Math.round(avg) + 'ms（このPC）');
  return { text: out.join('\n'), thresholds };
}

run().catch((e) => { log('エラー: ' + e.message); document.title = 'error'; });
