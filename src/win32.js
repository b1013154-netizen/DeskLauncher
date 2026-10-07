'use strict';
// Windows API の呼び出し（キー送信・最背面固定）。Windows 以外では何もしない
const isWin = process.platform === 'win32';

let api = null;
function lib() {
  if (api || !isWin) return api;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  api = {
    keybd_event: user32.func('void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)'),
    SetWindowPos: user32.func('bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)'),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int nIndex)')
  };
  return api;
}

const KEYEVENTF_EXTENDEDKEY = 0x1;
const KEYEVENTF_KEYUP = 0x2;

const VK = {
  Ctrl: 0x11, Shift: 0x10, Alt: 0x12, Win: 0x5b,
  Enter: 0x0d, Tab: 0x09, Escape: 0x1b, Space: 0x20, Backspace: 0x08, Delete: 0x2e, Insert: 0x2d,
  Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22,
  Left: 0x25, Up: 0x26, Right: 0x27, Down: 0x28, PrintScreen: 0x2c,
  VolumeMute: 0xad, VolumeDown: 0xae, VolumeUp: 0xaf,
  MediaNext: 0xb0, MediaPrev: 0xb1, MediaStop: 0xb2, MediaPlayPause: 0xb3,
  ';': 0xba, '=': 0xbb, ',': 0xbc, '-': 0xbd, '.': 0xbe, '/': 0xbf, '`': 0xc0,
  '[': 0xdb, '\\': 0xdc, ']': 0xdd, "'": 0xde
};
for (let i = 0; i < 26; i++) VK[String.fromCharCode(65 + i)] = 0x41 + i;
for (let i = 0; i <= 9; i++) VK[String(i)] = 0x30 + i;
for (let i = 1; i <= 24; i++) VK[`F${i}`] = 0x6f + i;

const EXTENDED = new Set([0x2e, 0x2d, 0x24, 0x23, 0x21, 0x22, 0x25, 0x26, 0x27, 0x28, 0x5b]);

function vkOf(key) {
  if (!key) return null;
  return VK[key] ?? VK[String(key).toUpperCase()] ?? null;
}

function press(vk, up) {
  let flags = up ? KEYEVENTF_KEYUP : 0;
  if (EXTENDED.has(vk)) flags |= KEYEVENTF_EXTENDEDKEY;
  lib().keybd_event(vk, 0, flags, 0);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 修飾キー付きの 1 打鍵を送る（例: { ctrl: true, key: 'C' }）
async function sendCombo(combo) {
  const vk = vkOf(combo.key);
  if (vk == null) throw new Error(`未対応のキーです: ${combo.key}`);
  if (!isWin) return;
  const mods = [];
  if (combo.ctrl) mods.push(VK.Ctrl);
  if (combo.shift) mods.push(VK.Shift);
  if (combo.alt) mods.push(VK.Alt);
  if (combo.win) mods.push(VK.Win);
  for (const m of mods) press(m, false);
  press(vk, false);
  await sleep(15);
  press(vk, true);
  for (const m of mods.reverse()) press(m, true);
  await sleep(30);
}

const HWND_TOPMOST = -1;
const HWND_NOTOPMOST = -2;
const HWND_BOTTOM = 1;
const SWP_KEEP = 0x0001 /* NOSIZE */ | 0x0002 /* NOMOVE */ | 0x0010 /* NOACTIVATE */;

function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}

function setPos(win, insertAfter) {
  if (!isWin || !win || win.isDestroyed()) return;
  try {
    lib().SetWindowPos(hwndOf(win), insertAfter, 0, 0, 0, 0, SWP_KEEP);
  } catch (e) {
    console.error('SetWindowPos failed', e);
  }
}

// 最前面（TOPMOST）を付けるか外す
function setTopmost(win, on) {
  setPos(win, on ? HWND_TOPMOST : HWND_NOTOPMOST);
}

// ウィンドウを Z オーダーの一番下へ移す（「デスクトップに貼り付け」用）
function sendToBottom(win) {
  setPos(win, HWND_NOTOPMOST);
  setPos(win, HWND_BOTTOM);
}

// 動作確認用: 今 TOPMOST かどうか（Windows 以外は null）
function isTopmost(win) {
  if (!isWin) return null;
  const exStyle = Number(lib().GetWindowLongPtrW(hwndOf(win), -20 /* GWL_EXSTYLE */));
  return (exStyle & 0x8 /* WS_EX_TOPMOST */) !== 0;
}

module.exports = { isWin, sendCombo, setTopmost, sendToBottom, isTopmost, lib, keyNames: Object.keys(VK), vkOf };
