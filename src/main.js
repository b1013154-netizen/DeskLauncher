'use strict';
const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, dialog, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./config');
const actions = require('./actions');
const icons = require('./icons');
const win32 = require('./win32');

if (process.env.DL_USERDATA) app.setPath('userData', process.env.DL_USERDATA);
if (!app.requestSingleInstanceLock()) app.quit();

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'config.json');
const ASSET = name => path.join(__dirname, '..', 'build', name);

let config; // 画面に反映中の設定（保存前の変更を含む）
let saved; // ファイルに保存済みの設定
let dirty = false; // 設定画面に未保存の変更があるか
let launcher = null;
let settings = null;
let tray = null;
let raised = false; // ホットキーで一時的に最前面へ出している状態
let hotkeyStatus = { ok: true, message: '' };

// ---------- ランチャー本体 ----------
function createLauncher() {
  const b = config.behavior;
  launcher = new BrowserWindow({
    width: 300,
    height: 300,
    x: b.x ?? undefined,
    y: b.y ?? undefined,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    // クリックしても前面のアプリからフォーカスを奪わない（キー送信・貼り付けを前のアプリに届けるため）
    focusable: false,
    show: false,
    title: 'DeskLauncher',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  launcher.loadFile(path.join(__dirname, 'renderer', 'launcher.html'));
  launcher.once('ready-to-show', () => {
    ensureOnScreen();
    if (config.behavior.showOnStartup || process.env.DL_SHOTS) launcher.showInactive();
    applyZOrder();
  });
  let moveTimer;
  launcher.on('moved', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const [x, y] = launcher.getPosition();
      // 位置は未保存の変更とは別に、その場で保存する
      for (const c of [config, saved]) { c.behavior.x = x; c.behavior.y = y; }
      persist();
    }, 400);
  });
  launcher.on('closed', () => { launcher = null; });
}

// モニター構成が変わって画面外に出てしまった場合は右上に戻す
function ensureOnScreen() {
  const bounds = launcher.getBounds();
  const visible = screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return bounds.x + 40 > a.x && bounds.x < a.x + a.width - 40 && bounds.y + 20 > a.y && bounds.y < a.y + a.height - 20;
  });
  if (config.behavior.x == null || !visible) {
    const a = screen.getPrimaryDisplay().workArea;
    launcher.setPosition(a.x + a.width - bounds.width - 24, a.y + 24);
  }
}

function currentZOrder() {
  return raised ? 'top' : config.behavior.zOrder;
}

// Electron の setAlwaysOnTop だけでは、フォーカスを取らないウィンドウで最前面が
// 解除されないことがあるため、Windows API でも明示的に設定する
function applyZOrder() {
  if (!launcher) return;
  const z = currentZOrder();
  launcher.setAlwaysOnTop(z === 'top', 'floating');
  win32.setTopmost(launcher, z === 'top');
  if (z === 'bottom') win32.sendToBottom(launcher);
  else if (raised) launcher.moveTop();
  updateBottomKeeper(z === 'bottom');
}

// 「デスクトップに貼り付け」の間は、ほかのウィンドウの操作で前に出てきても一番後ろへ戻す
let bottomTimer = null;
function updateBottomKeeper(on) {
  if (on && !bottomTimer) bottomTimer = setInterval(() => { if (launcher && currentZOrder() === 'bottom') win32.sendToBottom(launcher); }, 2000);
  if (!on && bottomTimer) { clearInterval(bottomTimer); bottomTimer = null; }
}

// 一時的に前に出したランチャーを、マウスが離れたら元の表示の優先度に戻す
let lowerTimer = null;
function scheduleLower() {
  clearTimeout(lowerTimer);
  if (raised) lowerTimer = setTimeout(lowerLauncher, 1500);
}

function showLauncher() {
  if (!launcher) return;
  launcher.showInactive();
  applyZOrder();
}

// ホットキー: 隠れていれば一番前に出し、前に出ていれば元の位置（隠す／背面）に戻す
function toggleLauncher() {
  if (!launcher) return;
  const z = config.behavior.zOrder;
  if (!launcher.isVisible()) {
    raised = z !== 'top';
    showLauncher();
  } else if (z === 'top') {
    launcher.hide();
  } else if (raised) {
    lowerLauncher();
  } else {
    raised = true;
    applyZOrder();
  }
}

function lowerLauncher() {
  clearTimeout(lowerTimer);
  raised = false;
  applyZOrder();
}

// タスクトレイや二重起動から表示したときは、一度だけ前に出す
function bringToFront() {
  raised = config.behavior.zOrder !== 'top';
  showLauncher();
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  const b = config.behavior;
  hotkeyStatus = { ok: true, message: '' };
  if (!b.hotkeyEnabled || !b.hotkey) return;
  try {
    const ok = globalShortcut.register(b.hotkey, toggleLauncher);
    if (!ok) hotkeyStatus = { ok: false, message: 'このキーは他のアプリが使用中のため登録できませんでした。別の組み合わせを選んでください。' };
  } catch (e) {
    hotkeyStatus = { ok: false, message: `キーの組み合わせが不正です: ${e.message}` };
  }
}

function applyAutoStart() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  if (!app.isPackaged) return;
  // ポータブル版は一時フォルダに展開されて動くため、元の exe の場所を登録する
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  app.setLoginItemSettings({ openAtLogin: !!config.behavior.autoStart, path: exe });
}

// ---------- 設定画面 ----------
// buttonId を渡すとそのボタンを、tab を渡すとそのタブ（例: 'help'）を開いた状態で表示する
function openSettings(buttonId, tab) {
  if (settings) {
    if (settings.isMinimized()) settings.restore();
    settings.show();
    settings.focus();
    if (buttonId) settings.webContents.send('select-button', buttonId);
    if (tab) settings.webContents.send('show-tab', tab);
    return;
  }
  const isWin = process.platform === 'win32';
  settings = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 620,
    show: false,
    title: 'DeskLauncher 設定',
    backgroundColor: '#f6f6fa',
    icon: ASSET('icon.png'),
    titleBarStyle: isWin ? 'hidden' : 'default',
    titleBarOverlay: isWin ? { color: '#fcfcfd', symbolColor: '#55566a', height: 44 } : false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  settings.loadFile(path.join(__dirname, 'renderer', 'settings.html'), { query: Object.assign({}, buttonId && { select: buttonId }, tab && { tab }) });
  settings.once('ready-to-show', () => settings.show());
  // 未保存の変更があるまま閉じようとしたら、保存するか確認する
  settings.on('close', e => {
    if (!dirty) return;
    const r = dialog.showMessageBoxSync(settings, {
      type: 'question',
      title: 'DeskLauncher',
      message: '保存していない変更があります。',
      detail: '変更を保存してから閉じますか？',
      buttons: ['保存して閉じる', '保存せずに閉じる', 'キャンセル'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    });
    if (r === 0) applyConfig(config);
    else if (r === 1) revertConfig();
    else e.preventDefault();
  });
  settings.on('closed', () => { settings = null; });
}

// ---------- 設定の保存と反映 ----------
function persist() {
  try { store.save(CONFIG_FILE(), saved); return true; } catch (e) { console.error('save failed', e); return false; }
}

const clone = o => JSON.parse(JSON.stringify(o));

// 設定を画面に反映する。save が true ならファイルにも保存する（false は保存前のプレビュー）
function applyConfig(next, { save = true } = {}) {
  const prev = config;
  config = store.normalize(next);
  if (prev && prev.behavior.zOrder !== config.behavior.zOrder) lowerLauncher();
  if (!prev || prev.behavior.hotkey !== config.behavior.hotkey || prev.behavior.hotkeyEnabled !== config.behavior.hotkeyEnabled) registerHotkey();
  let ok = true;
  if (save) {
    saved = clone(config);
    ok = persist();
    dirty = !ok;
    applyAutoStart();
  } else {
    dirty = true;
  }
  applyZOrder();
  updateTrayMenu();
  broadcast('config-changed', config);
  return { config, hotkeyStatus, saved: save && ok, dirty };
}

// 未保存の変更を捨てて、保存済みの設定に戻す
function revertConfig() {
  return applyConfig(clone(saved));
}

function broadcast(channel, payload) {
  for (const w of [launcher, settings]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

function toast(message, kind = 'info') {
  if (launcher && !launcher.isDestroyed()) launcher.webContents.send('toast', { message, kind });
}

// ---------- タスクトレイ ----------
function createTray() {
  const img = nativeImage.createFromPath(ASSET('tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 }));
  tray.setToolTip('DeskLauncher');
  tray.on('click', () => (launcher && launcher.isVisible() ? launcher.hide() : showLauncher()));
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'ランチャーを表示', click: bringToFront },
    { label: 'ランチャーを隠す', click: () => launcher && launcher.hide() },
    { type: 'separator' },
    { label: '設定を開く…', click: () => openSettings() },
    { label: '使い方（説明書）…', click: () => openSettings(null, 'help') },
    { label: '位置をロック', type: 'checkbox', checked: !!config.behavior.locked, click: i => setLocked(i.checked) },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() }
  ]));
}

function setLocked(v) {
  // ロックはその場で保存する（未保存の変更には影響させない）
  config.behavior.locked = v;
  saved.behavior.locked = v;
  persist();
  updateTrayMenu();
  broadcast('config-changed', config);
}

// ---------- IPC ----------
ipcMain.handle('config:get', () => ({ config, hotkeyStatus, dirty, platform: process.platform, version: app.getVersion() }));
ipcMain.handle('config:preview', (_e, cfg) => applyConfig(cfg, { save: false }));
ipcMain.handle('config:set', (_e, cfg) => applyConfig(cfg));
ipcMain.handle('config:revert', () => revertConfig());
ipcMain.handle('launcher:pointer', (_e, inside) => (inside ? clearTimeout(lowerTimer) : scheduleLower()));

ipcMain.handle('launcher:resize', (_e, { width, height }) => {
  if (!launcher) return;
  const w = Math.max(80, Math.round(width));
  const h = Math.max(60, Math.round(height));
  const [cw, ch] = launcher.getContentSize();
  if (cw !== w || ch !== h) launcher.setContentSize(w, h);
});

ipcMain.handle('launcher:run', async (_e, id) => {
  const btn = store.findButton(config.pages, id);
  if (!btn) return { ok: false, message: 'ボタンが見つかりません' };
  try {
    await actions.runSteps(btn.steps || []);
    if (config.behavior.hideAfterAction) launcher.hide();
    else if (raised) lowerLauncher();
    return { ok: true };
  } catch (e) {
    toast(`${btn.label || 'ボタン'}: ${e.message}`, 'error');
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('launcher:context', (_e, id) => {
  const btn = id ? store.findButton(config.pages, id) : null;
  const tpl = [];
  if (btn) {
    tpl.push({ label: `「${btn.label || '無題'}」を編集…`, click: () => openSettings(btn.id) });
    tpl.push({ type: 'separator' });
  }
  tpl.push(
    { label: '設定を開く…', click: () => openSettings() },
    { label: '使い方（説明書）…', click: () => openSettings(null, 'help') },
    { label: '位置をロック', type: 'checkbox', checked: !!config.behavior.locked, click: i => setLocked(i.checked) },
    { label: '隠す', click: () => launcher.hide() },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() }
  );
  Menu.buildFromTemplate(tpl).popup({ window: launcher });
});

ipcMain.handle('settings:open', (_e, id) => openSettings(id));

ipcMain.handle('steps:test', async (_e, steps) => {
  try {
    await actions.runSteps(steps || []);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('icon:auto', async (_e, btn) => {
  try { return { ok: true, data: await icons.autoIcon(btn) }; } catch (e) { return { ok: false, message: e.message }; }
});

const FILTERS = {
  image: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'ico', 'bmp', 'gif', 'webp'] }],
  exe: [{ name: 'アプリ', extensions: ['exe', 'lnk', 'bat', 'cmd'] }, { name: 'すべてのファイル', extensions: ['*'] }],
  file: [{ name: 'すべてのファイル', extensions: ['*'] }]
};

ipcMain.handle('dialog:pick', async (e, kind) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const props = kind === 'folder' ? ['openDirectory'] : ['openFile'];
  const r = await dialog.showOpenDialog(win, { properties: props, filters: kind === 'folder' ? undefined : FILTERS[kind === 'background' ? 'image' : kind] || FILTERS.file });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  const p = r.filePaths[0];
  try {
    if (kind === 'image') return { ok: true, data: icons.imageFileToDataUrl(p) };
    if (kind === 'background') return { ok: true, data: icons.backgroundToDataUrl(p) };
    return { ok: true, path: p };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('config:export', async e => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const r = await dialog.showSaveDialog(win, {
    title: '設定をエクスポート',
    defaultPath: path.join(app.getPath('documents'), `DeskLauncher設定_${stamp}.json`),
    filters: [{ name: 'DeskLauncher 設定', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, JSON.stringify(store.toExport(config, app.getVersion()), null, 2), 'utf8');
  return { ok: true, path: r.filePath };
});

ipcMain.handle('config:import', async e => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    title: '設定をインポート',
    properties: ['openFile'],
    filters: [{ name: 'DeskLauncher 設定', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  let next;
  try {
    next = store.fromExport(fs.readFileSync(r.filePaths[0], 'utf8'));
  } catch (err) {
    return { ok: false, message: err.message };
  }
  const backup = backupCurrent();
  applyConfig(next);
  if (launcher) ensureOnScreen();
  // 移行先の PC に存在しないアプリ・ファイルを知らせる
  const missing = store.collectPaths(config.pages).filter(x => !fs.existsSync(x.path));
  return { ok: true, backup, missing };
});

ipcMain.handle('config:reset', () => {
  const backup = backupCurrent();
  const next = store.defaultConfig();
  next.behavior.x = config.behavior.x;
  next.behavior.y = config.behavior.y;
  applyConfig(next);
  return { ok: true, backup };
});

ipcMain.handle('config:openBackups', () => require('electron').shell.openPath(backupDir()));

function backupDir() {
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// 上書きする前に、今の設定を自動で残しておく
function backupCurrent() {
  const file = path.join(backupDir(), `config-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(store.toExport(config, app.getVersion()), null, 2), 'utf8');
  return file;
}

ipcMain.handle('keys:names', () => win32.keyNames);

// ---------- 説明書 ----------
// インストール版では resources/docs、開発時はリポジトリ直下の docs に置かれる
const DOCS = [
  { id: 'manual', title: '使い方説明書', file: '使い方説明書.md' },
  { id: 'migration', title: '移行手順書', file: '移行手順書.md' }
];
const docsDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'docs') : path.join(__dirname, '..', 'docs'));
const docPath = id => {
  const d = DOCS.find(x => x.id === id);
  return d ? path.join(docsDir(), d.file) : null;
};

ipcMain.handle('docs:list', () => DOCS.map(({ id, title }) => ({ id, title })));
ipcMain.handle('docs:read', (_e, id) => {
  const p = docPath(id);
  try {
    return { ok: true, text: fs.readFileSync(p, 'utf8') };
  } catch (e) {
    return { ok: false, message: `説明書を読み込めませんでした: ${p}` };
  }
});
// 印刷や保存をしたいときのために、既定のアプリ（メモ帳など）で開く
ipcMain.handle('docs:openExternal', async (_e, id) => {
  const p = docPath(id);
  const err = p ? await require('electron').shell.openPath(p) : '説明書が見つかりません';
  return { ok: !err, message: err };
});
ipcMain.handle('app:quit', () => app.quit());

// ---------- 起動 ----------
app.on('second-instance', bringToFront);

app.whenReady().then(() => {
  config = store.load(CONFIG_FILE());
  saved = clone(config);
  persist();
  createLauncher();
  createTray();
  registerHotkey();
  applyAutoStart();
  if (process.argv.includes('--settings')) openSettings();
  if (process.env.DL_SELFTEST) require('../scripts/selftest')({ app, getLauncher: () => launcher, applyConfig, toggleLauncher, getConfig: () => config, actions, win32 });
  if (process.env.DL_SHOTS) require('../scripts/shots')({ app, getLauncher: () => launcher, openSettings, getSettings: () => settings });
});

// ランチャーはトレイに常駐するので、設定画面を閉じても終了しない
app.on('window-all-closed', () => {});
app.on('will-quit', () => globalShortcut.unregisterAll());
