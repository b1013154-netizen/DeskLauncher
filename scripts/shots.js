'use strict';
// 開発用: 画面を PNG に保存して終了する（DL_SHOTS=出力先フォルダ で起動）
const fs = require('fs');
const path = require('path');

module.exports = async function ({ app, getLauncher, openSettings, getSettings }) {
  const out = process.env.DL_SHOTS;
  fs.mkdirSync(out, { recursive: true });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shot = async (win, name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${name}.png`), img.toPNG());
  };
  try {
    await wait(2500);
    await shot(getLauncher(), 'launcher');
    await getLauncher().webContents.executeJavaScript(`document.querySelectorAll('.dl-btn')[7].click()`);
    await wait(600);
    await shot(getLauncher(), 'launcher-folder');
    await getLauncher().webContents.executeJavaScript(`document.querySelector('.dl-head button').click()`);
    openSettings();
    await wait(2500);
    const s = getSettings();
    const js = code => s.webContents.executeJavaScript(code);
    await js(`(async () => { const c = (await window.dl.getConfig()).config; window.__dl.selectById(c.pages[0].buttons[0].id); })()`);
    await wait(800);
    await shot(s, 'settings-buttons');
    await js(`(async () => { const c = (await window.dl.getConfig()).config; window.__dl.selectById(c.pages[0].buttons[6].id); })()`);
    await wait(500);
    await shot(s, 'settings-text');
    await js(`(async () => { const c = (await window.dl.getConfig()).config; window.__dl.selectById(c.pages[0].buttons[5].id); })()`);
    await wait(500);
    await shot(s, 'settings-keys');
    await js(`window.__dl.openStepPicker()`);
    await wait(400);
    await shot(s, 'settings-picker');
    await js(`window.__dl.closeModal(); window.__dl.showTab('look')`);
    await wait(500);
    await shot(s, 'settings-look');
    await js(`window.__dl.showTab('behavior')`);
    await wait(400);
    await shot(s, 'settings-behavior');
    await js(`window.__dl.showTab('backup')`);
    await wait(400);
    await shot(s, 'settings-backup');
    await js(`window.__dl.openHelp('manual')`);
    await wait(600);
    await shot(s, 'settings-help');
    await js(`document.querySelectorAll('.doc-toc a')[2].click()`);
    await wait(900);
    await shot(s, 'settings-help-scrolled');
    await js(`window.__dl.openHelp('migration')`);
    await wait(600);
    await shot(s, 'settings-help-migration');
    // 見た目を変えてランチャーに反映されるか確認
    await js(`(async () => { const c = (await window.dl.getConfig()).config; Object.assign(c.appearance, { cols: 4, rows: 2, theme: 'sakura', bgType: 'gradient', bgColor: '#fde6ef', bgColor2: '#f6d1e4', labelColor: '#6b2c48', buttonAlpha: .55, accent: '#e2588f', borderAlpha: .8 }); await window.dl.setConfig(c); })()`);
    await wait(1200);
    await shot(getLauncher(), 'launcher-sakura');
  } catch (e) {
    console.error('shots failed', e);
  }
  app.quit();
};
