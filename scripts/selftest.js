'use strict';
// Windows 実機（GitHub Actions の windows-latest）での動作確認。
// DL_SELFTEST=結果ファイル で起動すると、表示の優先度と Windows API の呼び出しを確かめて終了する。
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async function ({ app, getLauncher, applyConfig, toggleLauncher, getConfig, actions, win32 }) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });
  const setZ = async z => {
    const c = JSON.parse(JSON.stringify(getConfig()));
    c.behavior.zOrder = z;
    applyConfig(c, { save: false });
    await wait(400);
  };

  try {
    await wait(2500);
    const win = getLauncher();
    check('ランチャーが表示される', win && win.isVisible());

    if (win32.isWin) {
      try { win32.lib(); check('koffi で user32.dll を読み込める', true); } catch (e) { check('koffi で user32.dll を読み込める', false, e.message); }
    }

    for (const [z, expect] of [['top', true], ['normal', false], ['bottom', false], ['top', true], ['normal', false]]) {
      await setZ(z);
      const t = win32.isTopmost(win);
      check(`表示の優先度「${z}」で最前面=${expect}`, t === null || t === expect, `実際: ${t}`);
    }

    // ホットキーで前に出したあと、優先度を変えたら一時的な最前面が解除されること（今回の不具合）
    await setZ('normal');
    toggleLauncher();
    await wait(300);
    check('ホットキーで一時的に最前面になる', win32.isTopmost(win) !== false, `実際: ${win32.isTopmost(win)}`);
    await setZ('bottom');
    check('優先度を変えると一時的な最前面が解除される', win32.isTopmost(win) !== true, `実際: ${win32.isTopmost(win)}`);
    await setZ('top');
    toggleLauncher();
    await wait(300);
    check('「常に一番前」でホットキーを押すと隠れる', !win.isVisible());
    toggleLauncher();
    await wait(300);
    check('もう一度押すと表示される', win.isVisible());

    // コマンド実行の動作
    const out = path.join(os.tmpdir(), `dl-selftest-${Date.now()}.txt`);
    const cmd = win32.isWin ? `echo ok> "${out}"` : `echo ok > '${out}'`;
    await actions.runSteps([{ type: 'command', command: cmd }]);
    await wait(1500);
    check('コマンドを実行できる', fs.existsSync(out));

    // キー送信（Shift 単打は画面に影響しない）
    try { await actions.runSteps([{ type: 'keys', shift: true, key: 'F24', repeat: 1 }]); check('キーを送信できる', true); } catch (e) { check('キーを送信できる', false, e.message); }
  } catch (e) {
    check('予期しないエラー', false, e.stack);
  }

  const file = process.env.DL_SELFTEST;
  fs.writeFileSync(file, JSON.stringify(results, null, 2), 'utf8');
  for (const r of results) console.log(`${r.ok ? 'OK  ' : 'NG  '} ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
  app.exit(results.every(r => r.ok) ? 0 : 1);
};
