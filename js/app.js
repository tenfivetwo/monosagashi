// 画面の動き。判定そのものは scan.js / matcher.js にある。
import { loadEngine } from './engine.js';
import { embedView, embedNegative, buildProfile, scanRegion, WHOLE_LONG } from './scan.js';
import { SENSITIVITY, thresholdFor } from './matcher.js';
import { listItems, getItem, saveItem, deleteItem } from './store.js';

const FULL = { x: 0, y: 0, w: 1, h: 1 };
const CENTER = { x: 0.22, y: 0.22, w: 0.56, h: 0.56 };
const CORNERS = [
  { x: 0, y: 0, w: 0.55, h: 0.55 }, { x: 0.45, y: 0, w: 0.55, h: 0.55 },
  { x: 0, y: 0.45, w: 0.55, h: 0.55 }, { x: 0.45, y: 0.45, w: 0.55, h: 0.55 },
];
const MAX_PHOTOS = 6;
const PHOTO_LONG = 1024;

const $ = (id) => document.getElementById(id);
const screens = ['home', 'register', 'shoot', 'crop', 'search'];
function show(name) { for (const s of screens) $(s).hidden = s !== name; }

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureEngine() {
  const el = $('loading');
  const timer = setTimeout(() => { el.hidden = false; }, 200);
  try {
    return await loadEngine((p, note) => {
      $('loadingBar').style.width = Math.round(p * 100) + '%';
      $('loadingText').textContent = note === 'prepare' ? 'AI を起動しています…' : 'AI を準備しています… ' + Math.round(p * 100) + '%';
    });
  } finally {
    clearTimeout(timer);
    el.hidden = true;
  }
}

// ---------- 一覧 ----------
async function renderHome() {
  show('home');
  const items = await listItems();
  const ul = $('items');
  ul.textContent = '';
  $('empty').hidden = items.length > 0;
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'item';
    const img = document.createElement('img');
    img.alt = '';
    img.src = URL.createObjectURL(item.photos[0].blob);
    img.onload = () => URL.revokeObjectURL(img.src);
    const body = document.createElement('div');
    body.className = 'itemBody';
    const name = document.createElement('div');
    name.className = 'itemName';
    name.textContent = item.name;
    const sub = document.createElement('div');
    sub.className = 'itemSub';
    sub.textContent = '写真 ' + item.photos.length + ' 枚';
    body.append(name, sub);
    const actions = document.createElement('div');
    actions.className = 'itemActions';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'plain danger';
    del.textContent = '×';
    del.setAttribute('aria-label', item.name + ' を削除');
    del.onclick = async () => {
      if (!window.confirm('「' + item.name + '」を削除しますか？')) return;
      await deleteItem(item.id);
      renderHome();
    };
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'primary';
    go.textContent = '探す';
    go.onclick = () => startSearch(item.id);
    actions.append(del, go);
    li.append(img, body, actions);
    ul.append(li);
  }
}

// ---------- 登録 ----------
let draft = null;

function startRegister() {
  draft = { photos: [] };
  $('regName').value = '';
  renderDraft();
  show('register');
}

function renderDraft() {
  const wrap = $('regPhotos');
  wrap.textContent = '';
  draft.photos.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'thumb';
    const img = document.createElement('img');
    img.alt = (i + 1) + '枚目';
    img.src = p.thumb;
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', (i + 1) + '枚目を外す');
    x.onclick = () => { draft.photos.splice(i, 1); renderDraft(); };
    d.append(img, x);
    wrap.append(d);
  });
  const n = draft.photos.length;
  $('regSave').disabled = n === 0;
  $('regCamera').disabled = n >= MAX_PHOTOS;
  $('regPick').disabled = n >= MAX_PHOTOS;
  $('regHint').textContent = n === 0
    ? '違う向きから3〜5枚撮っておくと、どの向きで転がっていても見つけやすくなります。'
    : n < 3 ? 'あと ' + (3 - n) + ' 枚、別の向きから撮ると見つけやすくなります（1枚でも保存はできます）。' : n + ' 枚撮りました。';
}

// カメラ
let stream = null;
let torchOn = false;

async function openCamera(video) {
  stopCamera();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('この環境ではカメラを使えません（https で開く必要があります）');
  }
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
  return stream;
}

function stopCamera() {
  if (stream) for (const t of stream.getTracks()) t.stop();
  stream = null;
  torchOn = false;
  $('shootVideo').srcObject = null;
  $('searchVideo').srcObject = null;
}

function cameraMessage(e) {
  if (e && e.name === 'NotAllowedError') return 'カメラの使用が許可されていません。ブラウザの設定で許可してください。';
  if (e && e.name === 'NotFoundError') return 'カメラが見つかりません。';
  return (e && e.message) || 'カメラを開けませんでした。';
}

async function openShoot() {
  show('shoot');
  try {
    await openCamera($('shootVideo'));
  } catch (e) {
    stopCamera();
    show('register');
    toast(cameraMessage(e) + ' 「写真を選ぶ」も使えます。');
  }
}

function shrinkToCanvas(source, srcW, srcH) {
  const s = Math.min(1, PHOTO_LONG / Math.max(srcW, srcH));
  const c = document.createElement('canvas');
  c.width = Math.round(srcW * s);
  c.height = Math.round(srcH * s);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c;
}

// 枠の調整
let cropState = null;

function openCrop(photoCanvas) {
  cropState = {
    photo: photoCanvas,
    box: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
    drag: null,
  };
  show('crop');
  const c = $('cropCanvas');
  const maxW = Math.min(window.innerWidth - 32, 640);
  const maxH = window.innerHeight - 240;
  const s = Math.min(maxW / photoCanvas.width, maxH / photoCanvas.height);
  c.width = Math.round(photoCanvas.width * s);
  c.height = Math.round(photoCanvas.height * s);
  drawCrop();
}

function drawCrop() {
  const c = $('cropCanvas');
  const g = c.getContext('2d');
  const { photo, box } = cropState;
  g.drawImage(photo, 0, 0, c.width, c.height);
  const x = box.x * c.width;
  const y = box.y * c.height;
  const w = box.w * c.width;
  const h = box.h * c.height;
  g.fillStyle = 'rgba(0,0,0,.5)';
  g.fillRect(0, 0, c.width, y);
  g.fillRect(0, y + h, c.width, c.height - y - h);
  g.fillRect(0, y, x, h);
  g.fillRect(x + w, y, c.width - x - w, h);
  g.strokeStyle = '#f2b134';
  g.lineWidth = 3;
  g.strokeRect(x, y, w, h);
  g.fillStyle = '#f2b134';
  for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    g.beginPath();
    g.arc(px, py, 9, 0, Math.PI * 2);
    g.fill();
  }
}

function cropPointer(ev) {
  const c = $('cropCanvas');
  const r = c.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height, r };
}

function setupCropEvents() {
  const c = $('cropCanvas');
  c.addEventListener('pointerdown', (ev) => {
    if (!cropState) return;
    const p = cropPointer(ev);
    const { box } = cropState;
    const tx = 32 / p.r.width;
    const ty = 32 / p.r.height;
    const corners = [
      ['nw', box.x, box.y], ['ne', box.x + box.w, box.y],
      ['sw', box.x, box.y + box.h], ['se', box.x + box.w, box.y + box.h],
    ];
    let mode = null;
    for (const [m, cx, cy] of corners) {
      if (Math.abs(p.x - cx) < tx && Math.abs(p.y - cy) < ty) { mode = m; break; }
    }
    if (!mode && p.x > box.x && p.x < box.x + box.w && p.y > box.y && p.y < box.y + box.h) mode = 'move';
    if (!mode) {
      // 枠の外を押したら、そこから新しい枠を引く
      cropState.box = { x: p.x, y: p.y, w: 0.001, h: 0.001 };
      mode = 'se';
    }
    cropState.drag = { mode, sx: p.x, sy: p.y, start: { ...cropState.box } };
    c.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  c.addEventListener('pointermove', (ev) => {
    if (!cropState || !cropState.drag) return;
    const p = cropPointer(ev);
    const { mode, sx, sy, start } = cropState.drag;
    const dx = p.x - sx;
    const dy = p.y - sy;
    let x0 = start.x;
    let y0 = start.y;
    let x1 = start.x + start.w;
    let y1 = start.y + start.h;
    if (mode === 'move') {
      const nx = Math.min(1 - start.w, Math.max(0, start.x + dx));
      const ny = Math.min(1 - start.h, Math.max(0, start.y + dy));
      cropState.box = { x: nx, y: ny, w: start.w, h: start.h };
    } else {
      if (mode.includes('w')) x0 += dx;
      if (mode.includes('e')) x1 += dx;
      if (mode.includes('n')) y0 += dy;
      if (mode.includes('s')) y1 += dy;
      x0 = Math.max(0, Math.min(1, x0));
      x1 = Math.max(0, Math.min(1, x1));
      y0 = Math.max(0, Math.min(1, y0));
      y1 = Math.max(0, Math.min(1, y1));
      cropState.box = {
        x: Math.min(x0, x1), y: Math.min(y0, y1),
        w: Math.max(0.02, Math.abs(x1 - x0)), h: Math.max(0.02, Math.abs(y1 - y0)),
      };
    }
    drawCrop();
  });
  const end = () => { if (cropState) cropState.drag = null; };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
}

function canvasToBlob(c, q) {
  return new Promise((res) => c.toBlob(res, 'image/jpeg', q));
}

async function acceptCrop() {
  const { photo, box } = cropState;
  if (box.w * photo.width < 28 || box.h * photo.height < 28) {
    toast('枠が小さすぎます。もう少し広げてください。');
    return;
  }
  const t = document.createElement('canvas');
  t.width = 168;
  t.height = 168;
  const side = Math.max(box.w * photo.width, box.h * photo.height);
  const sx = box.x * photo.width + (box.w * photo.width - side) / 2;
  const sy = box.y * photo.height + (box.h * photo.height - side) / 2;
  const tg = t.getContext('2d');
  tg.fillStyle = '#000';
  tg.fillRect(0, 0, 168, 168);
  tg.drawImage(photo, sx, sy, side, side, 0, 0, 168, 168);
  draft.photos.push({ canvas: photo, box: { ...box }, thumb: t.toDataURL('image/jpeg', 0.8) });
  cropState = null;
  renderDraft();
  show('register');
}

async function saveDraft() {
  const btn = $('regSave');
  btn.disabled = true;
  try {
    await ensureEngine();
    const name = $('regName').value.trim() || '品物 ' + new Date().toLocaleDateString('ja-JP');
    btn.textContent = '読み取り中…';
    const views = [];
    const photos = [];
    for (let i = 0; i < draft.photos.length; i++) {
      btn.textContent = '読み取り中… ' + (i + 1) + '/' + draft.photos.length;
      const p = draft.photos[i];
      views.push(await embedView(p.canvas, p.box));
      photos.push({ blob: await canvasToBlob(p.canvas, 0.85), box: p.box, w: p.canvas.width, h: p.canvas.height });
    }
    await saveItem({
      id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
      name, createdAt: Date.now(), photos, views, negatives: [],
    });
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* 任意 */ }
    draft = null;
    renderHome();
  } catch (e) {
    toast('保存できませんでした：' + e.message);
  } finally {
    btn.textContent = '保存する';
    btn.disabled = !draft || draft.photos.length === 0;
  }
}

// ---------- 探す ----------
let session = null;
let audio = null;

function beep(freq, ms) {
  try {
    if (!audio) return;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.18;
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + ms / 1000);
  } catch { /* 音が出なくても続ける */ }
}

async function startSearch(id) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) { audio = audio || new Ctx(); audio.resume(); }
  } catch { audio = null; }
  const item = await getItem(id);
  if (!item) { toast('品物が見つかりません。'); return; }
  show('search');
  $('searchName').textContent = item.name + ' を探す';
  $('status').textContent = '準備中…';
  $('found').hidden = true;
  $('stillCanvas').hidden = true;
  $('searchVideo').hidden = false;
  $('torch').hidden = true;
  $('meterBar').style.width = '0';
  clearOverlay();

  session = {
    item,
    running: true,
    paused: false,
    sens: session ? session.sens : 'mid',
    long: WHOLE_LONG,
    count: 0,
    history: [],
    scores: [],
    profile: null,
    wake: null,
    current: null,
    video: true,
  };
  const my = session;
  markSens();
  try {
    await ensureEngine();
    my.profile = buildProfile(item.views, item.negatives || []);
  } catch (e) {
    $('status').textContent = 'AI を準備できませんでした：' + e.message;
    return;
  }
  if (!my.running) return;
  try {
    await openCamera($('searchVideo'));
    setupTorch();
    try { if (navigator.wakeLock) my.wake = await navigator.wakeLock.request('screen'); } catch { /* 任意 */ }
    if (!my.running) { stopCamera(); return; }
    $('status').textContent = 'ゆっくり動かしてください';
    loop(my);
  } catch (e) {
    my.video = false;
    $('status').textContent = cameraMessage(e) + ' 「写真で試す」も使えます。';
  }
}

function endSearch() {
  if (session) {
    session.running = false;
    if (session.wake) session.wake.release().catch(() => {});
  }
  stopCamera();
  clearOverlay();
  renderHome();
}

function markSens() {
  for (const b of document.querySelectorAll('.seg button')) {
    b.classList.toggle('on', session && b.dataset.sens === session.sens);
  }
}

function setupTorch() {
  const btn = $('torch');
  btn.hidden = true;
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  if (caps.torch) btn.hidden = false;
}

async function toggleTorch() {
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  try {
    torchOn = !torchOn;
    await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    $('torch').textContent = torchOn ? 'ライト消' : 'ライト';
  } catch { toast('ライトを切り替えられませんでした。'); }
}

const snap = document.createElement('canvas');

function takeSnapshot(video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const s = Math.min(1, 1280 / Math.max(vw, vh));
  snap.width = Math.round(vw * s);
  snap.height = Math.round(vh * s);
  snap.getContext('2d').drawImage(video, 0, 0, snap.width, snap.height);
  return snap;
}

async function loop(my) {
  const video = $('searchVideo');
  let tick = 0;
  while (my.running) {
    if (my.paused || video.readyState < 2 || !video.videoWidth) { await sleep(120); continue; }
    const frame = takeSnapshot(video);
    const region = tick++ % 2 === 0 ? FULL : CENTER;
    let scan;
    try {
      scan = await scanRegion(frame, region, my.profile, {
        longSide: my.long,
        maxCandidates: region === FULL && my.long === WHOLE_LONG ? 2 : 1,
      });
    } catch (e) {
      $('status').textContent = '判定でエラーが起きました：' + e.message;
      return;
    }
    if (!my.running) return;
    my.count++;
    adaptSpeed(my, scan.ms);
    drawScan(scan, video.videoWidth, video.videoHeight, 'cover');
    judge(my, scan, frame);
    await sleep(20);
  }
}

// 遅い端末では入力を小さくして、かざす動きに付いていけるようにする
function adaptSpeed(my, ms) {
  if (ms > 2600 && my.long > 252) my.long = my.long > 294 ? 294 : 252;
}

function judge(my, scan, frame) {
  const conf = SENSITIVITY[my.sens];
  const top = scan.results[0];
  const threshold = thresholdFor(my.sens, my.scores);
  const isHit = top && top.score >= threshold;
  if (top) {
    my.scores.push(top.score);
    if (my.scores.length > 30) my.scores.shift();
  }
  my.history.push(isHit ? { center: top.center, score: top.score } : null);
  if (my.history.length > 5) my.history.shift();

  const level = top ? Math.max(0, Math.min(1, (top.score - (threshold - 0.14)) / 0.14)) : 0;
  $('meterBar').style.width = Math.round(level * 100) + '%';

  if (!isHit) {
    const secs = (scan.ms / 1000).toFixed(1);
    $('status').textContent = 'ゆっくり動かしてください（' + my.count + ' 回調べました・1回 ' + secs + ' 秒）';
    return;
  }
  // 少し前にも近い場所で反応していれば「見つかった」とする
  const near = my.history.filter((h) => h && Math.hypot(h.center.x - top.center.x, h.center.y - top.center.y) < 0.35);
  if (near.length >= conf.need) {
    showFound(my, top, frame);
  } else {
    beep(660, 70);
    $('status').textContent = '怪しい物があります。そのまま映してください';
    drawBox(top.box, frame.width, frame.height, 'cover', '#f2b134');
  }
}

function showFound(my, top, frame) {
  my.paused = true;
  my.current = top;
  try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch { /* 任意 */ }
  beep(880, 120);
  setTimeout(() => beep(1175, 160), 140);
  const c = $('foundCanvas');
  c.width = frame.width;
  c.height = frame.height;
  const g = c.getContext('2d');
  g.drawImage(frame, 0, 0);
  g.strokeStyle = '#38c172';
  g.lineWidth = Math.max(4, frame.width / 160);
  g.strokeRect(top.box.x * frame.width, top.box.y * frame.height, top.box.w * frame.width, top.box.h * frame.height);
  $('foundNote').textContent = '枠の中をよく見てください。違うときは「違う」を押すと、同じ物に反応しにくくなります。';
  $('found').hidden = false;
  $('status').textContent = '見つかったかもしれません';
}

async function answerNo() {
  const my = session;
  if (!my) return;
  $('found').hidden = true;
  if (my.current) {
    // この枠のあたりを「違う物」として覚える（次回の探索にも残す）
    const item = my.item;
    try {
      const negative = await embedNegative($('foundCanvas'), my.current.box);
      item.negatives = [...(item.negatives || []), negative];
      my.profile = buildProfile(item.views, item.negatives);
      await saveItem(item);
    } catch { /* 覚えられなくても探索は続ける */ }
  }
  my.history = [];
  my.current = null;
  my.paused = false;
  clearOverlay();
  $('status').textContent = my.video ? 'ゆっくり動かしてください' : '写真で試せます';
}

// ---------- 写真で試す（カメラがないPCでも確かめられる） ----------
async function tryStill(file) {
  const my = session;
  if (!my || !my.profile) return;
  my.paused = true;
  const bmp = await createImageBitmap(file);
  const still = shrinkToCanvas(bmp, bmp.width, bmp.height);
  bmp.close();
  const view = $('stillCanvas');
  view.width = still.width;
  view.height = still.height;
  view.getContext('2d').drawImage(still, 0, 0);
  view.hidden = false;
  $('searchVideo').hidden = true;
  my.video = false;
  clearOverlay();
  const threshold = SENSITIVITY[my.sens].fixed;
  let best = null;
  const regions = [FULL, ...CORNERS];
  for (let i = 0; i < regions.length; i++) {
    $('status').textContent = '調べています… ' + (i + 1) + '/' + regions.length;
    $('meterBar').style.width = Math.round(((i + 1) / regions.length) * 100) + '%';
    const scan = await scanRegion(still, regions[i], my.profile, { maxCandidates: 2 });
    if (i === 0) drawScan(scan, still.width, still.height, 'contain');
    if (scan.results[0] && (!best || scan.results[0].score > best.score)) best = scan.results[0];
  }
  if (best && best.score >= threshold) {
    drawBox(best.box, still.width, still.height, 'contain', '#38c172');
    showFound(my, best, still);
  } else {
    if (best) drawBox(best.box, still.width, still.height, 'contain', 'rgba(255,255,255,.6)');
    $('status').textContent = 'この写真には見つかりませんでした';
  }
}

// ---------- 重ね描き ----------
function overlayContext() {
  const c = $('overlay');
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c.getContext('2d');
}

function clearOverlay() {
  const c = $('overlay');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
}

function mapper(srcW, srcH, fit) {
  const c = $('overlay');
  const s = fit === 'cover' ? Math.max(c.clientWidth / srcW, c.clientHeight / srcH) : Math.min(c.clientWidth / srcW, c.clientHeight / srcH);
  const dw = srcW * s;
  const dh = srcH * s;
  const ox = (c.clientWidth - dw) / 2;
  const oy = (c.clientHeight - dh) / 2;
  return { x: (n) => ox + n * dw, y: (n) => oy + n * dh, sw: dw, sh: dh };
}

// 似ている所を薄い点で見せる（調べている感じを出す）
function drawScan(scan, srcW, srcH, fit) {
  const g = overlayContext();
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  const m = mapper(srcW, srcH, fit);
  const { map, gw, gh, region } = scan;
  let mean = 0;
  for (const v of map) mean += v;
  mean /= map.length;
  let vari = 0;
  for (const v of map) vari += (v - mean) * (v - mean);
  const sd = Math.sqrt(vari / map.length) || 1e-6;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const z = (map[y * gw + x] - mean) / sd;
      if (z < 1.6) continue;
      const a = Math.min(0.6, (z - 1.6) * 0.3);
      const nx = region.x + ((x + 0.5) / gw) * region.w;
      const ny = region.y + ((y + 0.5) / gh) * region.h;
      g.fillStyle = 'rgba(242,177,52,' + a.toFixed(2) + ')';
      g.beginPath();
      g.arc(m.x(nx), m.y(ny), 5, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function drawBox(box, srcW, srcH, fit, color) {
  const g = overlayContext();
  const m = mapper(srcW, srcH, fit);
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.strokeRect(m.x(box.x), m.y(box.y), box.w * m.sw, box.h * m.sh);
}

// ---------- ボタンの結び付け ----------
function pickerToCanvas(file) {
  return createImageBitmap(file).then((bmp) => {
    const c = shrinkToCanvas(bmp, bmp.width, bmp.height);
    bmp.close();
    return c;
  });
}

function bind() {
  $('addBtn').onclick = startRegister;
  $('regBack').onclick = () => {
    if (draft && draft.photos.length && !window.confirm('撮った写真を捨てて戻りますか？')) return;
    draft = null;
    renderHome();
  };
  $('regCamera').onclick = openShoot;
  $('regPick').onclick = () => $('regFile').click();
  $('regFile').onchange = async (ev) => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    try { openCrop(await pickerToCanvas(f)); } catch { toast('その写真は読めませんでした。'); }
  };
  $('regSave').onclick = saveDraft;
  $('shootBack').onclick = () => { stopCamera(); show('register'); };
  $('shutter').onclick = () => {
    const v = $('shootVideo');
    if (!v.videoWidth) return;
    const c = shrinkToCanvas(v, v.videoWidth, v.videoHeight);
    stopCamera();
    openCrop(c);
  };
  $('cropBack').onclick = () => { cropState = null; show('register'); };
  $('cropOk').onclick = acceptCrop;
  setupCropEvents();

  $('searchBack').onclick = endSearch;
  $('torch').onclick = toggleTorch;
  for (const b of document.querySelectorAll('.seg button')) {
    b.onclick = () => { if (session) { session.sens = b.dataset.sens; session.history = []; markSens(); } };
  }
  $('stillPick').onclick = () => $('stillFile').click();
  $('stillFile').onchange = (ev) => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (f) tryStill(f).catch((e) => toast('試せませんでした：' + e.message));
  };
  $('foundYes').onclick = () => {
    const name = session ? session.item.name : '';
    endSearch();
    toast('「' + name + '」が見つかりました！');
  };
  $('foundNo').onclick = answerNo;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && session && session.running && session.wake && navigator.wakeLock) {
      try { session.wake = await navigator.wakeLock.request('screen'); } catch { /* 任意 */ }
    }
  });
}

bind();
renderHome().catch((e) => toast('起動できませんでした：' + e.message));

// 開発用（ブラウザの開発ツールから写真で試すときに使う）。本番の動きには影響しない
window.__monosagashi = { tryStill, pickerToCanvas, openCrop, acceptCrop, saveDraft, startRegister, startSearch };
