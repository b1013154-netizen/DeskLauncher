'use strict';
// ボタンのアイコンを自動で取得する（URL はサイトのアイコン、アプリ・ファイルはその関連アイコン）
const { app, net, nativeImage } = require('electron');
const fs = require('fs');

async function fetchImage(url) {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'DeskLauncher' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) throw new Error('画像ではありません');
  return img;
}

async function faviconFor(rawUrl) {
  const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Web ページ以外の URL です');
  const candidates = [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(u.hostname)}.ico`,
    `${u.origin}/favicon.ico`
  ];
  let last;
  for (const c of candidates) {
    try {
      const img = await fetchImage(c);
      // 16px しか取れない汎用アイコンは次の候補を試す
      if (img.getSize().width < 32 && c !== candidates[candidates.length - 1]) { last = img; continue; }
      return img.toDataURL();
    } catch (e) { /* 次の候補へ */ }
  }
  if (last) return last.toDataURL();
  throw new Error('サイトのアイコンを取得できませんでした');
}

async function fileIcon(p) {
  if (!fs.existsSync(p)) throw new Error(`見つかりません: ${p}`);
  const img = await app.getFileIcon(p, { size: 'large' });
  if (img.isEmpty()) throw new Error('アイコンがありません');
  return img.toDataURL();
}

// ボタンの最初の動作からアイコンを決める
async function autoIcon(btn) {
  const step = (btn.steps || []).find(s => s.enabled !== false && (s.type === 'url' || s.type === 'open'));
  if (!step) return null;
  if (step.type === 'url') return faviconFor(step.url);
  return fileIcon(step.path);
}

// 画像ファイルを読み込み、設定に埋め込めるサイズ（最大 256px）に縮める
function imageFileToDataUrl(p) {
  let img = nativeImage.createFromPath(p);
  if (img.isEmpty()) throw new Error('画像を読み込めませんでした（PNG / JPG / ICO を選んでください）');
  const { width, height } = img.getSize();
  const max = Math.max(width, height);
  if (max > 256) img = img.resize({ width: Math.round(width * 256 / max), height: Math.round(height * 256 / max), quality: 'best' });
  return img.toDataURL();
}

// 背景画像用（最大 1600px の JPEG に縮めて設定ファイルの肥大化を防ぐ）
function backgroundToDataUrl(p) {
  let img = nativeImage.createFromPath(p);
  if (img.isEmpty()) throw new Error('画像を読み込めませんでした');
  const { width, height } = img.getSize();
  const max = Math.max(width, height);
  if (max > 1600) img = img.resize({ width: Math.round(width * 1600 / max), height: Math.round(height * 1600 / max), quality: 'good' });
  return `data:image/jpeg;base64,${img.toJPEG(85).toString('base64')}`;
}

module.exports = { autoIcon, imageFileToDataUrl, backgroundToDataUrl, faviconFor, fileIcon };
