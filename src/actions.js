'use strict';
// ボタンに割り当てた「動作」を順番に実行する
const { shell, clipboard } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const win32 = require('./win32');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 既定のブラウザ以外は Windows の「App Paths」登録名で起動する
const BROWSERS = { chrome: 'chrome', edge: 'msedge', firefox: 'firefox', brave: 'brave', opera: 'opera' };

function normalizeUrl(url) {
  const u = String(url || '').trim();
  if (!u) throw new Error('URL が空です。');
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  return `https://${u}`;
}

function detached(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, Object.assign({ detached: true, stdio: 'ignore' }, opts));
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

// "a b" "c" のように引用符を考慮して引数を分割する
function splitArgs(s) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(s || ''))) out.push(m[1] ?? m[2]);
  return out;
}

async function openUrl(step) {
  const url = normalizeUrl(step.url);
  const browser = step.browser || 'default';
  if (browser === 'default') return shell.openExternal(url);
  const extra = step.privateMode ? privateFlag(browser) : [];
  if (browser === 'custom') {
    if (!step.browserPath) throw new Error('ブラウザの場所が指定されていません。');
    return detached(step.browserPath, [...extra, url]);
  }
  const exe = BROWSERS[browser];
  if (!exe) return shell.openExternal(url);
  if (!win32.isWin) return shell.openExternal(url);
  // start "" msedge --inprivate "https://..."
  const quoted = `"${url.replace(/"/g, '%22')}"`;
  return detached('cmd.exe', ['/d', '/c', `start "" ${exe} ${extra.join(' ')} ${quoted}`],
    { windowsVerbatimArguments: true, windowsHide: true });
}

function privateFlag(browser) {
  if (browser === 'edge') return ['--inprivate'];
  if (browser === 'firefox') return ['-private-window'];
  return ['--incognito'];
}

async function openPath(step) {
  const p = String(step.path || '').trim();
  if (!p) throw new Error('開く場所が指定されていません。');
  if (!fs.existsSync(p)) throw new Error(`見つかりません: ${p}`);
  const args = splitArgs(step.args);
  if (args.length && /\.(exe|bat|cmd|com)$/i.test(p)) {
    return detached(p, args, { cwd: path.dirname(p) });
  }
  const err = await shell.openPath(p);
  if (err) throw new Error(err);
}

async function runCommand(step) {
  const cmd = String(step.command || '').trim();
  if (!cmd) throw new Error('コマンドが空です。');
  const cwd = step.cwd && fs.existsSync(step.cwd) ? step.cwd : undefined;
  if (!win32.isWin) return detached('/bin/sh', ['-c', cmd], { cwd });
  if (step.showWindow) {
    // 結果を確認できるよう、コマンドプロンプトを開いたまま実行する
    return detached('cmd.exe', ['/d', '/c', `start "DeskLauncher" cmd.exe /k ${cmd}`],
      { cwd, windowsVerbatimArguments: true });
  }
  return detached('cmd.exe', ['/d', '/s', '/c', `"${cmd}"`], { cwd, windowsHide: true, windowsVerbatimArguments: true });
}

async function sendKeys(step) {
  const n = Math.min(50, Math.max(1, Number(step.repeat) || 1));
  for (let i = 0; i < n; i++) await win32.sendCombo(step);
}

async function pasteText(step) {
  const before = clipboard.readText();
  clipboard.writeText(String(step.text ?? ''));
  await sleep(40);
  await win32.sendCombo({ ctrl: true, key: 'V' });
  if (step.restoreClipboard !== false) {
    // 貼り付け先のアプリが読み終わるのを待ってから元に戻す
    await sleep(400);
    clipboard.writeText(before);
  }
}

const HANDLERS = {
  url: openUrl,
  open: openPath,
  command: runCommand,
  keys: sendKeys,
  text: pasteText,
  wait: step => sleep(Math.min(60000, Math.max(0, Number(step.ms) || 0)))
};

// ステップを順に実行。途中で失敗したら、その位置と理由を返す
async function runSteps(steps) {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.enabled === false) continue;
    const fn = HANDLERS[step.type];
    if (!fn) throw new Error(`不明な動作です: ${step.type}`);
    try {
      await fn(step);
    } catch (e) {
      const err = new Error(`${i + 1} 番目の動作で失敗しました: ${e.message}`);
      err.stepIndex = i;
      throw err;
    }
    // 続く動作がある場合は、開いたウィンドウが前面に来るまで少し待つ
    if (i < steps.length - 1 && ['url', 'open', 'command'].includes(step.type)) await sleep(300);
  }
}

module.exports = { runSteps, normalizeUrl, splitArgs };
