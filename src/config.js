'use strict';
// 設定の既定値・読み書き・検証をまとめたモジュール（Electron に依存しない）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_VERSION = 1;
const EXPORT_FORMAT = 'desk-launcher-settings';

const newId = () => crypto.randomBytes(6).toString('hex');

function defaultAppearance() {
  return {
    theme: 'midnight',
    cols: 3,
    rows: 3,
    iconSize: 56,
    gap: 10,
    padding: 14,
    panelRadius: 18,
    buttonRadius: 14,
    bgType: 'gradient', // color | gradient | image
    bgColor: '#1b1d2a',
    bgColor2: '#33264f',
    bgImage: null,
    bgImageFit: 'cover',
    opacity: 0.94,
    borderColor: '#ffffff',
    borderAlpha: 0.14,
    borderWidth: 1,
    buttonColor: '#ffffff',
    buttonAlpha: 0.07,
    accent: '#8b7cf6',
    showLabels: true,
    labelColor: '#e9e9f2',
    fontSize: 11,
    showHeader: true
  };
}

function defaultBehavior() {
  return {
    zOrder: 'top', // top | normal | bottom
    hotkey: 'Control+Alt+Space',
    hotkeyEnabled: true,
    autoStart: false,
    locked: false,
    hideAfterAction: false,
    showOnStartup: true,
    x: null,
    y: null
  };
}

function button(label, emoji, steps) {
  return { id: newId(), type: 'action', label, icon: { mode: 'auto', data: null, emoji }, color: null, steps };
}

function defaultPages(slots) {
  const buttons = [
    button('YouTube', '▶️', [{ type: 'url', url: 'https://www.youtube.com/', browser: 'default' }]),
    button('Google', '🔎', [{ type: 'url', url: 'https://www.google.com/', browser: 'default' }]),
    button('Gmail', '✉️', [{ type: 'url', url: 'https://mail.google.com/', browser: 'default' }]),
    button('エクスプローラー', '📁', [{ type: 'open', path: 'C:\\Windows\\explorer.exe', args: '' }]),
    button('メモ帳', '📝', [{ type: 'open', path: 'C:\\Windows\\System32\\notepad.exe', args: '' }]),
    button('コピー', '📋', [{ type: 'keys', ctrl: true, shift: false, alt: false, win: false, key: 'C', repeat: 1 }]),
    button('署名を貼り付け', '✍️', [{ type: 'text', text: 'よろしくお願いいたします。', restoreClipboard: true }]),
    {
      id: newId(), type: 'folder', label: 'お気に入り', icon: { mode: 'emoji', data: null, emoji: '⭐' }, color: null, steps: [],
      pages: [{ id: newId(), name: 'お気に入り', buttons: fill([
        button('GitHub', '🐙', [{ type: 'url', url: 'https://github.com/', browser: 'default' }])
      ], slots) }]
    }
  ];
  return [{ id: newId(), name: 'ホーム', buttons: fill(buttons, slots) }];
}

function fill(list, slots) {
  const out = list.slice(0, Math.max(slots, list.length));
  while (out.length < slots) out.push(null);
  return out;
}

function defaultConfig() {
  const a = defaultAppearance();
  return {
    version: CONFIG_VERSION,
    appearance: a,
    behavior: defaultBehavior(),
    pages: defaultPages(a.cols * a.rows)
  };
}

const clampInt = (v, min, max, def) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

// 読み込んだ設定を既定値で補完し、範囲外の値を丸める
function normalize(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const a = Object.assign(defaultAppearance(), cfg.appearance || {});
  a.cols = clampInt(a.cols, 1, 10, 3);
  a.rows = clampInt(a.rows, 1, 10, 3);
  a.iconSize = clampInt(a.iconSize, 24, 160, 56);
  a.gap = clampInt(a.gap, 0, 40, 10);
  a.padding = clampInt(a.padding, 0, 60, 14);
  a.fontSize = clampInt(a.fontSize, 8, 20, 11);
  a.opacity = Math.min(1, Math.max(0.2, Number(a.opacity) || 1));
  const b = Object.assign(defaultBehavior(), cfg.behavior || {});
  if (!['top', 'normal', 'bottom'].includes(b.zOrder)) b.zOrder = 'top';
  const slots = a.cols * a.rows;
  let pages = Array.isArray(cfg.pages) && cfg.pages.length ? cfg.pages : defaultPages(slots);
  pages = normalizePages(pages, slots);
  return { version: CONFIG_VERSION, appearance: a, behavior: b, pages };
}

function normalizeButton(btn, slots) {
  if (!btn || typeof btn !== 'object') return null;
  const out = Object.assign({ id: newId(), type: 'action', label: '', color: null, steps: [] }, btn);
  out.icon = Object.assign({ mode: 'auto', data: null, emoji: '' }, btn.icon || {});
  if (!Array.isArray(out.steps)) out.steps = [];
  if (out.type === 'folder') {
    out.pages = normalizePages(Array.isArray(btn.pages) && btn.pages.length ? btn.pages
      : [{ name: out.label || 'フォルダ', buttons: [] }], slots);
  } else {
    delete out.pages;
  }
  return out;
}

// 各ページのボタン数をマス数に合わせる。はみ出したボタンは次の新しいページへ送る
function normalizePages(pages, slots) {
  const result = [];
  for (const p of pages) {
    const page = { id: p.id || newId(), name: p.name || `ページ ${result.length + 1}`, buttons: [] };
    const list = (Array.isArray(p.buttons) ? p.buttons : []).map(b => normalizeButton(b, slots));
    const head = list.slice(0, slots);
    let rest = list.slice(slots).filter(Boolean);
    page.buttons = fill(head, slots).slice(0, slots);
    result.push(page);
    let n = 2;
    while (rest.length) {
      result.push({ id: newId(), name: `${page.name} (${n++})`, buttons: fill(rest.slice(0, slots), slots).slice(0, slots) });
      rest = rest.slice(slots);
    }
  }
  return result;
}

// ボタンを ID で探す（フォルダ内も再帰的に探索）
function findButton(pages, id) {
  for (const p of pages) {
    for (const b of p.buttons) {
      if (!b) continue;
      if (b.id === id) return b;
      if (b.type === 'folder') {
        const hit = findButton(b.pages, id);
        if (hit) return hit;
      }
    }
  }
  return null;
}

function load(file) {
  try {
    return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // 壊れた設定は退避してから既定値で起動する
      try { fs.copyFileSync(file, `${file}.broken-${Date.now()}`); } catch (_) { /* ignore */ }
    }
    return defaultConfig();
  }
}

function save(file, cfg) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function toExport(cfg, appVersion) {
  return { format: EXPORT_FORMAT, formatVersion: CONFIG_VERSION, appVersion, exportedAt: new Date().toISOString(), config: cfg };
}

// エクスポートファイルを検証して設定に戻す。不正なら例外
function fromExport(text) {
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error('JSON として読み込めませんでした。'); }
  if (!data || data.format !== EXPORT_FORMAT || !data.config) {
    throw new Error('DeskLauncher のエクスポートファイルではありません。');
  }
  if (data.formatVersion > CONFIG_VERSION) {
    throw new Error('新しいバージョンで作られたファイルです。アプリを更新してから読み込んでください。');
  }
  const cfg = normalize(data.config);
  // 別 PC ではモニター構成が違うため、位置は引き継がない
  cfg.behavior.x = null;
  cfg.behavior.y = null;
  return cfg;
}

// 設定内のファイルパスを列挙する（移行後の存在チェック用）
function collectPaths(pages, out = []) {
  for (const p of pages) {
    for (const b of p.buttons) {
      if (!b) continue;
      if (b.type === 'folder') collectPaths(b.pages, out);
      for (const s of b.steps || []) {
        if (s.type === 'open' && s.path) out.push({ button: b.label, path: s.path });
        if (s.type === 'url' && s.browser === 'custom' && s.browserPath) out.push({ button: b.label, path: s.browserPath });
      }
    }
  }
  return out;
}

module.exports = {
  CONFIG_VERSION, EXPORT_FORMAT, newId, defaultConfig, defaultAppearance, normalize, normalizePages,
  findButton, load, save, toExport, fromExport, collectPaths
};
