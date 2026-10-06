'use strict';
// 設定モジュールの簡易テスト（node scripts/test-config.js）
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const store = require('../src/config');

const cfg = store.defaultConfig();
assert.strictEqual(cfg.pages[0].buttons.length, 9, '既定は 9 マス');

// 列・行を減らすと、はみ出したボタンが次のページに移る
cfg.appearance.cols = 2;
cfg.appearance.rows = 2;
const small = store.normalize(cfg);
assert.strictEqual(small.pages[0].buttons.length, 4);
const count = pages => pages.reduce((n, p) => n + p.buttons.filter(Boolean).length, 0);
assert.strictEqual(count(small.pages), count(cfg.pages), 'ボタンが失われない');
assert.ok(small.pages.length >= 2);

// 範囲外の値は丸める
const bad = store.normalize({ appearance: { cols: 99, rows: -1, opacity: 5 }, behavior: { zOrder: 'xxx' } });
assert.strictEqual(bad.appearance.cols, 10);
assert.strictEqual(bad.appearance.rows, 1);
assert.strictEqual(bad.appearance.opacity, 1);
assert.strictEqual(bad.behavior.zOrder, 'top');

// エクスポート → インポートで内容が保たれ、位置だけリセットされる
cfg.behavior.x = 100;
const text = JSON.stringify(store.toExport(store.normalize(cfg), '1.0.0'));
const back = store.fromExport(text);
assert.strictEqual(back.behavior.x, null);
assert.strictEqual(count(back.pages), count(cfg.pages));
assert.throws(() => store.fromExport('{"a":1}'), /エクスポートファイルではありません/);
assert.throws(() => store.fromExport('not json'), /JSON/);
assert.throws(() => store.fromExport(JSON.stringify({ format: store.EXPORT_FORMAT, formatVersion: 99, config: {} })), /新しいバージョン/);

// フォルダ内のボタンも ID で見つかる
const folder = cfg.pages[0].buttons.find(b => b && b.type === 'folder');
const inner = folder.pages[0].buttons[0];
assert.strictEqual(store.findButton(cfg.pages, inner.id), inner);

// パスの列挙（移行チェック用）
assert.ok(store.collectPaths(cfg.pages).some(p => /notepad/.test(p.path)));

// 壊れた設定ファイルは退避して既定値で起動
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
const file = path.join(dir, 'config.json');
fs.writeFileSync(file, '{broken');
const loaded = store.load(file);
assert.strictEqual(loaded.pages[0].buttons.length, 9);
assert.ok(fs.readdirSync(dir).some(f => f.startsWith('config.json.broken-')));
store.save(file, loaded);
assert.deepStrictEqual(store.load(file), loaded);

console.log('config tests: OK');
