// 登録した品物のバックアップ（1つの JSON ファイルに書き出す・読み込む）。
// 入れるのは写真・枠・名前・「これだ！」で覚えた姿・「違う」で教えたこと。
// AI の読み取り結果（views）は大きいので入れず、読み込むときに写真から読み取り直す。

export const BACKUP_APP = 'monosagashi';
export const BACKUP_FORMAT = 1;
const NEG_KEEP = 10; // 判定で使うのは新しい10個だけなので、それだけ入れる

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// items（store.js の形）→ 書き出す中身
export async function toBackup(items) {
  const out = [];
  for (const item of items) {
    const photos = [];
    for (const p of item.photos) {
      photos.push({
        jpeg: await blobToBase64(p.blob),
        box: p.box, w: p.w, h: p.h,
        ...(p.learned ? { learned: true, at: p.at || 0 } : {}),
      });
    }
    const negatives = [];
    for (const n of (item.negatives || []).slice(-NEG_KEEP)) {
      negatives.push(await blobToBase64(new Blob([n])));
    }
    out.push({ id: item.id, name: item.name, createdAt: item.createdAt, photos, negatives });
  }
  return { app: BACKUP_APP, format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), items: out };
}

function isBox(b) {
  return b && ['x', 'y', 'w', 'h'].every((k) => typeof b[k] === 'number' && b[k] >= -0.01 && b[k] <= 1.01) && b.w > 0 && b.h > 0;
}

// 読み込んだ文字列を確かめて、写真の Blob などに戻す（AI の読み取りはまだ）
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('バックアップのファイルではありません'); }
  if (!data || data.app !== BACKUP_APP || !Array.isArray(data.items)) throw new Error('物探しカメラのバックアップではありません');
  if (data.format > BACKUP_FORMAT) throw new Error('新しい版で書き出したファイルです。アプリを新しくしてから読み込んでください');
  return data.items.map((it, i) => {
    if (typeof it.id !== 'string' || typeof it.name !== 'string' || !Array.isArray(it.photos) || it.photos.length === 0) {
      throw new Error((i + 1) + '件目の中身が読めません');
    }
    const photos = it.photos.map((p) => {
      if (typeof p.jpeg !== 'string' || !isBox(p.box)) throw new Error('「' + it.name + '」の写真が読めません');
      return {
        blob: new Blob([base64ToBytes(p.jpeg)], { type: 'image/jpeg' }),
        box: { x: p.box.x, y: p.box.y, w: p.box.w, h: p.box.h },
        w: p.w, h: p.h,
        ...(p.learned ? { learned: true, at: Number(p.at) || 0 } : {}),
      };
    });
    const negatives = (Array.isArray(it.negatives) ? it.negatives : []).map((b64) => {
      const bytes = base64ToBytes(String(b64));
      return new Float32Array(bytes.buffer, 0, Math.floor(bytes.length / 4));
    });
    return { id: it.id, name: it.name.slice(0, 30), createdAt: Number(it.createdAt) || Date.now(), photos, negatives };
  });
}

export function backupFileName() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return 'monosagashi-backup-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '.json';
}
