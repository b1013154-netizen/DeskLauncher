'use strict';
// 設定画面
(async function () {
  const { STEP_TYPES, renderPanel, iconNode, fallbackEmoji } = window.DLCommon;
  const $ = sel => document.querySelector(sel);

  // ---------- 小さな DOM ヘルパー ----------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'value') el.value = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  const field = (label, ...control) => h('div', null, h('label', { class: 'field-label' }, label), ...control);
  const row = (label, ...control) => h('div', { class: 'row' }, h('label', { class: 'k' }, label), ...control);
  function seg(options, value, onPick) {
    return h('div', { class: 'seg' }, options.map(([v, label]) =>
      h('button', { class: v === value ? 'on' : '', onclick: () => onPick(v) }, label)));
  }
  function toggle(checked, onChange, label) {
    return h('label', { class: 'switch' },
      h('input', { type: 'checkbox', checked, onchange: e => onChange(e.target.checked) }),
      h('span', { class: 'track' }), label ? h('span', null, label) : null);
  }
  function slider(value, min, max, step, unit, onInput) {
    const v = h('span', { class: 'val' }, `${value}${unit}`);
    return h('div', { class: 'inline' },
      h('input', { type: 'range', min, max, step, value, oninput: e => { v.textContent = `${e.target.value}${unit}`; onInput(Number(e.target.value)); } }), v);
  }

  let snackTimer;
  function snack(msg, err) {
    const el = $('#snack');
    el.textContent = msg;
    el.className = `snack on${err ? ' err' : ''}`;
    clearTimeout(snackTimer);
    snackTimer = setTimeout(() => { el.className = 'snack'; }, err ? 5000 : 2600);
  }

  // ---------- 状態 ----------
  const init = await window.dl.getConfig();
  let cfg = init.config;
  let hotkeyStatus = init.hotkeyStatus;
  $('#version').textContent = `バージョン ${init.version}`;
  const nav = { folders: [], pageIndex: 0, selId: new URLSearchParams(location.search).get('select') };
  let pendingEcho = 0;

  // ---------- 保存 ----------
  let saveTimer;
  function save(immediate) {
    clearTimeout(saveTimer);
    const run = async () => {
      pendingEcho++;
      const res = await window.dl.setConfig(cfg);
      hotkeyStatus = res.hotkeyStatus;
      const s = $('#saved');
      s.textContent = '保存しました';
      s.classList.add('flash');
      setTimeout(() => { s.textContent = '変更は自動で保存されます'; s.classList.remove('flash'); }, 1400);
      return res;
    };
    if (immediate) return run();
    saveTimer = setTimeout(run, 250);
  }

  // 列数・行数を変えると、はみ出したボタンが新しいページに移るので正規化後の設定を受け取る
  async function saveAndReload() {
    const res = await save(true);
    cfg = res.config;
    renderAll();
  }

  window.dl.onConfig(c => {
    if (pendingEcho > 0) { pendingEcho--; return; }
    cfg = c;
    renderAll();
  });
  window.dl.onSelectButton(id => { showTab('buttons'); selectById(id); });
  window.dl.onShowTab(name => showTab(name));

  // ---------- タブ ----------
  function showTab(name) {
    document.querySelectorAll('.nav').forEach(n => n.classList.toggle('on', n.dataset.tab === name));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === `tab-${name}`));
  }
  document.querySelectorAll('.nav').forEach(n => n.addEventListener('click', () => showTab(n.dataset.tab)));

  function renderAll() {
    renderButtonsTab();
    renderLookTab();
    renderBehaviorTab();
    renderBackupTab();
    renderHelpTab();
  }

  // =====================================================================
  // ボタン
  // =====================================================================
  const newId = () => Math.random().toString(16).slice(2, 14);
  const slots = () => cfg.appearance.cols * cfg.appearance.rows;
  const emptyButtons = () => Array.from({ length: slots() }, () => null);

  function findFolder(pages, id) {
    for (const p of pages) for (const b of p.buttons) {
      if (!b || b.type !== 'folder') continue;
      if (b.id === id) return b;
      const hit = findFolder(b.pages, id);
      if (hit) return hit;
    }
    return null;
  }
  // ボタンの場所（ページ・番号・親フォルダ）を探す
  function locate(id, pages = cfg.pages, trail = []) {
    for (let pi = 0; pi < pages.length; pi++) {
      const list = pages[pi].buttons;
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b) continue;
        if (b.id === id) return { pages, pageIndex: pi, index: i, trail };
        if (b.type === 'folder') {
          const hit = locate(id, b.pages, [...trail, b.id]);
          if (hit) return hit;
        }
      }
    }
    return null;
  }
  function curPages() {
    while (nav.folders.length) {
      const f = findFolder(cfg.pages, nav.folders[nav.folders.length - 1]);
      if (f) return f.pages;
      nav.folders.pop();
    }
    return cfg.pages;
  }
  function curPage() {
    const pages = curPages();
    nav.pageIndex = Math.max(0, Math.min(nav.pageIndex, pages.length - 1));
    return pages[nav.pageIndex];
  }
  const selected = () => (nav.selId ? findAny(nav.selId) : null);
  function findAny(id) {
    const loc = locate(id);
    return loc ? loc.pages[loc.pageIndex].buttons[loc.index] : null;
  }
  function selectById(id) {
    const loc = locate(id);
    if (!loc) return;
    nav.folders = loc.trail;
    nav.pageIndex = loc.pageIndex;
    nav.selId = id;
    renderButtonsTab();
  }

  function renderButtonsTab() {
    const tab = $('#tab-buttons');
    const scroll = $('#main').scrollTop;
    tab.textContent = '';
    tab.append(
      h('h1', null, 'ボタン'),
      h('p', { class: 'lead' }, 'マスをクリックして編集します。ドラッグで並べ替え、空いたマスの「＋」で追加できます。')
    );
    const layout = h('div', { class: 'btn-layout' });
    layout.append(h('div', null, crumbs(), pagesBar(), editGrid()), editor());
    tab.append(layout);
    $('#main').scrollTop = scroll;
  }

  function crumbs() {
    if (!nav.folders.length) return null;
    const parts = [h('a', { onclick: () => { nav.folders = []; nav.pageIndex = 0; nav.selId = null; renderButtonsTab(); } }, 'ホーム')];
    nav.folders.forEach((fid, i) => {
      const f = findFolder(cfg.pages, fid);
      parts.push(h('span', null, '›'));
      if (i === nav.folders.length - 1) parts.push(h('b', { style: { color: 'var(--ink)' } }, `📁 ${f ? f.label : ''}`));
      else parts.push(h('a', { onclick: () => { nav.folders = nav.folders.slice(0, i + 1); nav.pageIndex = 0; nav.selId = null; renderButtonsTab(); } }, f ? f.label : ''));
    });
    return h('div', { class: 'crumbs' }, parts);
  }

  function pagesBar() {
    const pages = curPages();
    const bar = h('div', { class: 'pages-bar' });
    pages.forEach((p, i) => bar.append(h('button', {
      class: `chip${i === nav.pageIndex ? ' on' : ''}`,
      onclick: () => { nav.pageIndex = i; nav.selId = null; renderButtonsTab(); },
      ondblclick: () => renamePage(i)
    }, p.name)));
    bar.append(h('button', {
      class: 'chip add',
      onclick: () => {
        pages.push({ id: newId(), name: `ページ ${pages.length + 1}`, buttons: emptyButtons() });
        nav.pageIndex = pages.length - 1;
        nav.selId = null;
        save();
        renderButtonsTab();
      }
    }, '＋ ページを追加'));
    bar.append(h('div', { class: 'page-tools' },
      h('button', { class: 'icon-btn', title: 'ページ名を変更', onclick: () => renamePage(nav.pageIndex) }, '✎'),
      h('button', { class: 'icon-btn', title: '左へ移動', onclick: () => movePage(-1) }, '←'),
      h('button', { class: 'icon-btn', title: '右へ移動', onclick: () => movePage(1) }, '→'),
      h('button', { class: 'icon-btn danger', title: 'ページを削除', onclick: deletePage }, '🗑')
    ));
    return bar;
  }

  function renamePage(i) {
    const pages = curPages();
    prompt('ページ名を変更', 'ランチャー上部に表示される名前です。', pages[i].name, v => {
      pages[i].name = v || pages[i].name;
      save();
      renderButtonsTab();
    });
  }
  function movePage(d) {
    const pages = curPages();
    const j = nav.pageIndex + d;
    if (j < 0 || j >= pages.length) return;
    [pages[nav.pageIndex], pages[j]] = [pages[j], pages[nav.pageIndex]];
    nav.pageIndex = j;
    save();
    renderButtonsTab();
  }
  function deletePage() {
    const pages = curPages();
    if (pages.length <= 1) { snack('最後の 1 ページは削除できません', true); return; }
    const p = pages[nav.pageIndex];
    const count = p.buttons.filter(Boolean).length;
    confirmBox(`「${p.name}」を削除しますか？`, count ? `このページの ${count} 個のボタンも削除されます。` : '空のページです。', '削除する', () => {
      pages.splice(nav.pageIndex, 1);
      nav.pageIndex = Math.max(0, nav.pageIndex - 1);
      nav.selId = null;
      save();
      renderButtonsTab();
    });
  }

  let dragFrom = null;
  function editGrid() {
    const page = curPage();
    const a = cfg.appearance;
    const panel = h('div');
    const title = nav.folders.length ? `${findFolder(cfg.pages, nav.folders.at(-1))?.label ?? ''} · ${page.name}` : page.name;
    renderPanel(panel, a, {
      title,
      canBack: nav.folders.length > 0,
      page,
      pageCount: curPages().length,
      pageIndex: nav.pageIndex,
      onBack: () => { nav.folders.pop(); nav.pageIndex = 0; nav.selId = null; renderButtonsTab(); },
      onDot: i => { nav.pageIndex = i; nav.selId = null; renderButtonsTab(); },
      onButton: btn => { nav.selId = btn.id; renderButtonsTab(); }
    });
    // マスごとにドラッグ＆ドロップ・ダブルクリックを設定
    const cells = panel.querySelectorAll('.dl-grid > *');
    cells.forEach((cell, i) => {
      const btn = page.buttons[i];
      if (btn) {
        cell.draggable = true;
        if (btn.id === nav.selId) cell.classList.add('sel');
        if (btn.type === 'folder') {
          cell.title = 'ダブルクリックでフォルダの中を編集';
          cell.addEventListener('dblclick', () => openFolder(btn));
        }
        cell.addEventListener('dragstart', e => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; });
      } else {
        cell.title = 'ボタンを追加';
        cell.addEventListener('click', () => addButton(i));
      }
      cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('drag-over'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', e => {
        e.preventDefault();
        cell.classList.remove('drag-over');
        if (dragFrom == null || dragFrom === i) return;
        const list = page.buttons;
        [list[dragFrom], list[i]] = [list[i], list[dragFrom]];
        dragFrom = null;
        save();
        renderButtonsTab();
      });
    });
    return h('div', null,
      h('div', { class: 'edit-grid-wrap' }, panel),
      h('div', { class: 'grid-hint' }, `1 画面 ${a.cols} × ${a.rows} = ${slots()} 個 ・ フォルダはダブルクリックで中を編集 ・ ページ名はダブルクリックで変更`)
    );
  }

  function openFolder(btn) {
    nav.folders.push(btn.id);
    nav.pageIndex = 0;
    nav.selId = null;
    renderButtonsTab();
  }

  function addButton(i) {
    const page = curPage();
    page.buttons[i] = { id: newId(), type: 'action', label: '新しいボタン', icon: { mode: 'auto', data: null, emoji: '' }, color: null, steps: [] };
    nav.selId = page.buttons[i].id;
    save();
    renderButtonsTab();
    openStepPicker(); // まず「何をするボタンか」を選んでもらう
  }

  // ---------- 右側の編集パネル ----------
  function editor() {
    const btn = selected();
    if (!btn) {
      return h('div', { class: 'editor' }, h('div', { class: 'card' }, h('div', { class: 'ed-empty' },
        h('div', { class: 'big' }, '👈'),
        h('div', null, '編集するボタンを選ぶか、空いたマスの「＋」をクリックしてください。'))));
    }
    const prev = h('div', { class: 'ed-preview' }, iconNode(btn, 44));
    const head = h('div', { class: 'ed-head' }, prev,
      h('div', { class: 'grow' },
        h('input', { type: 'text', value: btn.label, placeholder: 'ボタンの名前', oninput: e => { btn.label = e.target.value; save(); refreshGrid(); } }),
        h('div', { style: { marginTop: '4px' } }, seg([['action', '動作ボタン'], ['folder', 'フォルダ']], btn.type, v => setType(btn, v)))));
    const body = h('div', { class: 'ed-body' }, iconSection(btn), colorSection(btn));
    if (btn.type === 'folder') {
      body.append(h('div', { class: 'note', style: { marginTop: '16px' } },
        `中に ${btn.pages.reduce((n, p) => n + p.buttons.filter(Boolean).length, 0)} 個のボタンがあります（${btn.pages.length} ページ）。`),
      h('button', { class: 'btn primary', style: { marginTop: '10px' }, onclick: () => openFolder(btn) }, '📂 フォルダの中を編集'));
    } else {
      body.append(stepsSection(btn));
    }
    const foot = h('div', { class: 'ed-foot' },
      btn.type === 'action' ? h('button', { class: 'btn primary', onclick: () => testRun(btn) }, '▶ テスト実行') : null,
      h('button', { class: 'btn', onclick: () => duplicate(btn) }, '複製'),
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn danger', onclick: () => removeButton(btn) }, '削除'));
    return h('div', { class: 'editor' }, h('div', { class: 'card' }, head, body, foot));
  }

  // グリッドとプレビューだけ描き直す（入力中のフォーカスを保つため）
  function refreshGrid() {
    const wrap = document.querySelector('#tab-buttons .btn-layout > div:first-child');
    if (!wrap) return;
    const fresh = h('div', null, crumbs(), pagesBar(), editGrid());
    wrap.replaceWith(fresh);
    const btn = selected();
    const prev = document.querySelector('.ed-preview');
    if (btn && prev) { prev.textContent = ''; prev.append(iconNode(btn, 44)); }
  }

  function setType(btn, type) {
    if (btn.type === type) return;
    if (type === 'folder') {
      btn.type = 'folder';
      btn.pages = [{ id: newId(), name: btn.label || 'フォルダ', buttons: emptyButtons() }];
      if (btn.icon.mode === 'auto') btn.icon = { mode: 'emoji', data: null, emoji: '📁' };
    } else {
      const inside = (btn.pages || []).reduce((n, p) => n + p.buttons.filter(Boolean).length, 0);
      const apply = () => { btn.type = 'action'; delete btn.pages; save(); renderButtonsTab(); };
      if (inside) { confirmBox('フォルダを動作ボタンに変えますか？', `中の ${inside} 個のボタンは削除されます。`, '変更する', apply); return; }
      apply();
      return;
    }
    save();
    renderButtonsTab();
  }

  const EMOJIS = ['▶️', '🌐', '📁', '📝', '📋', '✉️', '📅', '🎵', '🎮', '🛒', '💼', '📊', '🔎', '⚙️', '💡', '⭐', '❤️', '🏠', '📷', '🎬', '🔒', '🧮', '☕', '🚀'];

  function iconSection(btn) {
    const ic = btn.icon;
    const box = h('div');
    box.append(h('label', { class: 'field-label' }, 'アイコン'));
    box.append(seg([['auto', '自動'], ['custom', '画像を選ぶ'], ['emoji', '絵文字'], ['none', '頭文字']], ic.mode, v => {
      ic.mode = v;
      if (v === 'auto') { ic.data = null; fetchAutoIcon(btn); }
      if (v === 'custom') { ic.data = null; pickImage(btn); }
      save();
      renderButtonsTab();
    }));
    const detail = h('div', { class: 'icon-pick', style: { marginTop: '10px' } });
    if (ic.mode === 'auto') {
      detail.append(
        h('span', { style: { color: 'var(--ink-3)', fontSize: '12.5px', flex: 1 } },
          btn.type === 'folder' ? 'フォルダは自動取得できません。絵文字か画像を選んでください。'
            : '最初の「URL を開く」「アプリを開く」からアイコンを取ってきます。'),
        btn.type === 'action' ? h('button', { class: 'btn small', onclick: () => fetchAutoIcon(btn, true) }, '↻ 再取得') : null);
    } else if (ic.mode === 'custom') {
      detail.append(h('button', { class: 'btn small', onclick: () => pickImage(btn) }, '🖼 画像ファイルを選ぶ'),
        h('span', { style: { color: 'var(--ink-3)', fontSize: '12px' } }, 'PNG・JPG・ICO（設定に埋め込まれるので移行時もそのまま使えます）'));
    } else if (ic.mode === 'emoji') {
      detail.append(h('input', { type: 'text', class: 'emoji-input', value: ic.emoji || '', maxlength: 4,
        oninput: e => { ic.emoji = e.target.value; save(); refreshGrid(); } }),
      h('span', { style: { color: 'var(--ink-3)', fontSize: '12px' } }, '直接入力（Win + . で絵文字パネル）または下から選択'));
      box.append(detail, h('div', { class: 'emoji-list' }, EMOJIS.map(em => h('button', { onclick: () => { ic.emoji = em; save(); renderButtonsTab(); } }, em))));
      return box;
    } else {
      detail.append(h('span', { style: { color: 'var(--ink-3)', fontSize: '12.5px' } }, '名前の 1 文字目をアクセント色の四角で表示します。'));
    }
    box.append(detail);
    return box;
  }

  async function fetchAutoIcon(btn, manual) {
    if (btn.type !== 'action') return;
    const res = await window.dl.autoIcon(btn);
    const cur = findAny(btn.id);
    if (!cur || cur.icon.mode !== 'auto') return;
    if (res.ok && res.data) {
      cur.icon.data = res.data;
      if (manual) snack('アイコンを取得しました');
    } else {
      cur.icon.data = null;
      if (manual) snack(res.message || 'アイコンを取得できませんでした。絵文字か画像を選んでください。', true);
    }
    save();
    refreshGrid();
  }

  async function pickImage(btn) {
    const res = await window.dl.pick('image');
    if (!res.ok) { if (res.message) snack(res.message, true); return; }
    const cur = findAny(btn.id);
    cur.icon = { mode: 'custom', data: res.data, emoji: cur.icon.emoji };
    save();
    renderButtonsTab();
  }

  function colorSection(btn) {
    return h('div', null,
      h('label', { class: 'field-label' }, 'ボタンの色'),
      h('div', { class: 'inline' },
        toggle(!btn.color, v => { btn.color = v ? null : '#6d5cf0'; save(); renderButtonsTab(); }, '見た目の設定に合わせる'),
        btn.color ? h('input', { type: 'color', value: btn.color.slice(0, 7), oninput: e => { btn.color = e.target.value; save(); refreshGrid(); } }) : null));
  }

  // ---------- 動作（ステップ） ----------
  function stepsSection(btn) {
    const box = h('div', { style: { marginTop: '18px' } });
    box.append(h('label', { class: 'field-label' }, `動作（上から順に実行します${btn.steps.length > 1 ? ' ・ マクロ' : ''}）`));
    if (!btn.steps.length) box.append(h('div', { class: 'note warn' }, 'まだ動作がありません。下の「動作を追加」から選んでください。'));
    const list = h('div', { class: 'steps' });
    btn.steps.forEach((s, i) => list.append(stepCard(btn, s, i)));
    box.append(list, h('button', { class: 'btn add-step', onclick: openStepPicker }, '＋ 動作を追加'));
    if (btn.steps.some(s => s.type === 'keys' || s.type === 'text')) {
      box.append(h('div', { class: 'note', style: { marginTop: '12px' } },
        'キー送信と貼り付けは、ランチャーを押す直前に使っていたアプリ（例: メモ帳やブラウザ）に届きます。'));
    }
    return box;
  }

  function stepCard(btn, s, i) {
    const t = STEP_TYPES[s.type] || { icon: '❔', name: s.type };
    const changed = (rerender, iconToo) => {
      save();
      if (iconToo && i === firstIconStep(btn) && btn.icon.mode === 'auto') debounceIcon(btn);
      if (rerender) renderButtonsTab();
    };
    const head = h('div', { class: 'step-head' },
      h('span', { class: 'step-num' }, i + 1),
      h('span', null, t.icon),
      h('span', { class: 'step-name' }, t.name),
      h('label', { class: 'switch', title: '一時的に無効にする' },
        h('input', { type: 'checkbox', checked: s.enabled !== false, onchange: e => { s.enabled = e.target.checked; changed(true); } }),
        h('span', { class: 'track' })),
      h('button', { class: 'icon-btn', title: '上へ', disabled: i === 0, onclick: () => moveStep(btn, i, -1) }, '↑'),
      h('button', { class: 'icon-btn', title: '下へ', onclick: () => moveStep(btn, i, 1) }, '↓'),
      h('button', { class: 'icon-btn danger', title: '削除', onclick: () => { btn.steps.splice(i, 1); changed(true); } }, '✕'));
    const body = h('div', { class: 'step-body' }, ...stepForm(s, changed));
    return h('div', { class: `step${s.enabled === false ? ' off' : ''}` }, head, body);
  }

  function firstIconStep(btn) {
    return btn.steps.findIndex(s => s.enabled !== false && (s.type === 'url' || s.type === 'open'));
  }
  let iconTimer;
  function debounceIcon(btn) {
    clearTimeout(iconTimer);
    iconTimer = setTimeout(() => fetchAutoIcon(btn), 900);
  }

  function moveStep(btn, i, d) {
    const j = i + d;
    if (j < 0 || j >= btn.steps.length) return;
    [btn.steps[i], btn.steps[j]] = [btn.steps[j], btn.steps[i]];
    save();
    renderButtonsTab();
  }

  let keyNames = [];
  window.dl.keyNames().then(k => { keyNames = k; });

  function stepForm(s, changed) {
    const text = (key, placeholder, iconToo) => h('input', { type: 'text', value: s[key] || '', placeholder, oninput: e => { s[key] = e.target.value; changed(false, iconToo); } });
    const check = (key, label, def) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: s[key] ?? def, onchange: e => { s[key] = e.target.checked; changed(false); } }), label);
    switch (s.type) {
      case 'url': {
        const browser = h('select', { onchange: e => { s.browser = e.target.value; changed(true); } },
          [['default', '既定のブラウザ'], ['chrome', 'Google Chrome'], ['edge', 'Microsoft Edge'], ['firefox', 'Firefox'], ['brave', 'Brave'], ['custom', 'その他（場所を指定）']]
            .map(([v, l]) => h('option', { value: v, selected: (s.browser || 'default') === v }, l)));
        const out = [field('URL', text('url', 'https://www.youtube.com/', true)), field('ブラウザ', browser)];
        if (s.browser === 'custom') {
          out.push(field('ブラウザの場所', h('div', { class: 'inline' }, text('browserPath', 'C:\\…\\browser.exe'),
            h('button', { class: 'btn small', onclick: async () => { const r = await window.dl.pick('exe'); if (r.ok) { s.browserPath = r.path; changed(true); } } }, '参照…'))));
        }
        if (s.browser && s.browser !== 'default') out.push(check('privateMode', 'シークレット（InPrivate）ウィンドウで開く', false));
        out.push(h('div', { class: 'hint', style: { marginTop: '8px', color: 'var(--ink-3)', fontSize: '12px' } },
          'ブラウザでログインしたままにしておけば、ログイン後の画面がそのまま開きます。'));
        return out;
      }
      case 'open':
        return [
          field('開くもの', h('div', { class: 'inline' }, text('path', 'C:\\Program Files\\…\\app.exe', true),
            h('button', { class: 'btn small', onclick: async () => { const r = await window.dl.pick('file'); if (r.ok) { s.path = r.path; changed(true, true); } } }, 'ファイル…'),
            h('button', { class: 'btn small', onclick: async () => { const r = await window.dl.pick('folder'); if (r.ok) { s.path = r.path; changed(true, true); } } }, 'フォルダ…'))),
          field('起動オプション（任意）', text('args', '例: --profile work'))
        ];
      case 'command':
        return [
          field('コマンド', h('textarea', { value: s.command || '', placeholder: '例: ipconfig /flushdns', style: { minHeight: '60px', fontFamily: 'Consolas, monospace' }, oninput: e => { s.command = e.target.value; changed(false); } })),
          field('実行するフォルダ（任意）', h('div', { class: 'inline' }, text('cwd', 'C:\\Users\\…'),
            h('button', { class: 'btn small', onclick: async () => { const r = await window.dl.pick('folder'); if (r.ok) { s.cwd = r.path; changed(true); } } }, '参照…'))),
          check('showWindow', '結果を確認できるよう、ウィンドウを開いて実行する', false)
        ];
      case 'keys':
        return keysForm(s, changed);
      case 'text':
        return [
          field('貼り付ける文章', h('textarea', { value: s.text || '', placeholder: '例: お世話になっております。', oninput: e => { s.text = e.target.value; changed(false); } })),
          check('restoreClipboard', '貼り付け後、クリップボードを元に戻す', true)
        ];
      case 'wait':
        return [field('待つ時間', h('div', { class: 'inline' },
          h('input', { type: 'number', min: 0, max: 60000, step: 100, value: s.ms ?? 500, oninput: e => { s.ms = Number(e.target.value); changed(false); } }),
          h('span', { style: { color: 'var(--ink-2)' } }, 'ミリ秒（1000 = 1 秒）')))];
      default:
        return [h('div', { class: 'note err' }, 'このバージョンでは扱えない動作です。')];
    }
  }

  const KEY_LABEL = { Ctrl: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Win: 'Win', VolumeUp: '音量＋', VolumeDown: '音量−', VolumeMute: 'ミュート', MediaPlayPause: '再生/一時停止', MediaNext: '次の曲', MediaPrev: '前の曲', MediaStop: '停止', PrintScreen: 'PrtSc' };
  function keysView(s) {
    const caps = [];
    if (s.ctrl) caps.push('Ctrl');
    if (s.shift) caps.push('Shift');
    if (s.alt) caps.push('Alt');
    if (s.win) caps.push('Win');
    if (s.key) caps.push(KEY_LABEL[s.key] || s.key);
    if (!caps.length) return [h('span', { style: { color: 'var(--ink-3)' } }, '未設定')];
    return caps.flatMap((c, i) => (i ? [h('span', { style: { color: 'var(--ink-3)' } }, '+'), h('span', { class: 'keycap' }, c)] : [h('span', { class: 'keycap' }, c)]));
  }

  // ブラウザのキー名を Windows の仮想キー名に変換する
  function codeToKey(e) {
    const c = e.code;
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit\d$/.test(c)) return c.slice(5);
    if (/^Numpad\d$/.test(c)) return c.slice(6);
    if (/^F\d{1,2}$/.test(c)) return c;
    const map = { Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Escape: 'Escape', Space: 'Space', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', PrintScreen: 'PrintScreen', Semicolon: ';', Equal: '=', Comma: ',', Minus: '-', Period: '.', Slash: '/', Backquote: '`', BracketLeft: '[', Backslash: '\\', BracketRight: ']', Quote: "'" };
    return map[c] || null;
  }

  function keysForm(s, changed) {
    const view = h('div', { class: 'keys-view hotkey-box', tabindex: 0 }, keysView(s));
    let rec = false;
    const recBtn = h('button', { class: 'btn small', onclick: () => {
      rec = !rec;
      view.classList.toggle('recording', rec);
      recBtn.textContent = rec ? 'キーを押してください…' : '⏺ キーを押して記録';
      if (rec) view.focus();
    } }, '⏺ キーを押して記録');
    view.addEventListener('keydown', e => {
      if (!rec) return;
      e.preventDefault();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      const key = codeToKey(e);
      if (!key) { snack('このキーは記録できません。下の一覧から選んでください', true); return; }
      Object.assign(s, { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, win: e.metaKey, key });
      rec = false;
      changed(true);
    });
    const mod = (k, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!s[k], onchange: e => { s[k] = e.target.checked; changed(true); } }), label);
    const sel = h('select', { onchange: e => { s.key = e.target.value; changed(true); } },
      h('option', { value: '' }, '（キーを選択）'),
      keyNames.filter(k => !['Ctrl', 'Shift', 'Alt', 'Win'].includes(k)).map(k => h('option', { value: k, selected: s.key === k }, KEY_LABEL[k] || k)));
    return [
      field('送るキー', h('div', { class: 'inline' }, view, recBtn)),
      h('div', null, mod('ctrl', 'Ctrl'), mod('shift', 'Shift'), mod('alt', 'Alt'), mod('win', 'Win')),
      field('キーを一覧から選ぶ（音量・再生などの特殊キーもこちら）', sel),
      field('繰り返す回数', h('input', { type: 'number', min: 1, max: 50, value: s.repeat || 1, oninput: e => { s.repeat = Number(e.target.value) || 1; changed(false); } }))
    ];
  }

  function openStepPicker() {
    const btn = selected();
    if (!btn) return;
    const defaults = {
      url: { url: '', browser: 'default' },
      open: { path: '', args: '' },
      command: { command: '', cwd: '', showWindow: false },
      keys: { ctrl: true, shift: false, alt: false, win: false, key: '', repeat: 1 },
      text: { text: '', restoreClipboard: true },
      wait: { ms: 500 }
    };
    modal(h('div', { class: 'modal' },
      h('h3', null, '動作を追加'),
      h('p', null, '1 つのボタンに複数の動作を登録すると、上から順に実行されます（例: アプリを開く → 待つ → 文字を貼り付け）。'),
      h('div', { class: 'type-grid' }, Object.entries(STEP_TYPES).map(([type, t]) => h('button', {
        class: 'type-tile',
        onclick: () => {
          const cur = selected();
          cur.steps.push(Object.assign({ type, enabled: true }, defaults[type]));
          if (cur.label === '新しいボタン' && cur.steps.length === 1) cur.label = t.name.replace(/を.*$/, '');
          closeModal();
          save();
          renderButtonsTab();
          // 追加した動作の入力欄にフォーカス
          const last = document.querySelector('.step:last-child .step-body input[type=text], .step:last-child .step-body textarea');
          if (last) last.focus();
        }
      }, h('span', { class: 'ti' }, t.icon), h('span', null, h('b', null, t.name), h('small', null, t.desc))))),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: closeModal }, 'キャンセル'))));
  }

  async function testRun(btn) {
    if (!btn.steps.length) { snack('動作が登録されていません', true); return; }
    snack('3 秒後に実行します。送り先のアプリをクリックしておいてください…');
    const needsTarget = btn.steps.some(s => s.type === 'keys' || s.type === 'text');
    await new Promise(r => setTimeout(r, needsTarget ? 3000 : 300));
    const res = await window.dl.testSteps(btn.steps);
    snack(res.ok ? '実行しました ✓' : res.message, !res.ok);
  }

  function cloneButton(b) {
    const c = JSON.parse(JSON.stringify(b));
    const reid = x => {
      x.id = newId();
      if (x.pages) x.pages.forEach(p => { p.id = newId(); p.buttons.forEach(y => y && reid(y)); });
    };
    reid(c);
    return c;
  }

  function duplicate(btn) {
    const loc = locate(btn.id);
    const list = loc.pages[loc.pageIndex].buttons;
    let i = list.indexOf(null, loc.index);
    if (i < 0) i = list.indexOf(null);
    if (i < 0) { snack('このページに空きがありません。ページを追加してください', true); return; }
    const c = cloneButton(btn);
    c.label = `${btn.label} のコピー`;
    list[i] = c;
    nav.selId = c.id;
    save();
    renderButtonsTab();
  }

  function removeButton(btn) {
    confirmBox(`「${btn.label || '無題'}」を削除しますか？`, btn.type === 'folder' ? 'フォルダの中のボタンもすべて削除されます。' : 'この操作は取り消せません。', '削除する', () => {
      const loc = locate(btn.id);
      loc.pages[loc.pageIndex].buttons[loc.index] = null;
      nav.selId = null;
      save();
      renderButtonsTab();
    });
  }

  // =====================================================================
  // 見た目
  // =====================================================================
  const THEMES = {
    midnight: { name: 'ミッドナイト', bgType: 'gradient', bgColor: '#1b1d2a', bgColor2: '#33264f', borderColor: '#ffffff', borderAlpha: 0.14, buttonColor: '#ffffff', buttonAlpha: 0.07, accent: '#8b7cf6', labelColor: '#e9e9f2' },
    glass: { name: 'グラス', bgType: 'color', bgColor: '#f7f8fc', bgColor2: '#ffffff', opacity: 0.82, borderColor: '#ffffff', borderAlpha: 0.9, buttonColor: '#ffffff', buttonAlpha: 0.75, accent: '#3d7bfd', labelColor: '#2b2d3a' },
    sakura: { name: 'さくら', bgType: 'gradient', bgColor: '#fde6ef', bgColor2: '#f6d1e4', borderColor: '#ffffff', borderAlpha: 0.8, buttonColor: '#ffffff', buttonAlpha: 0.55, accent: '#e2588f', labelColor: '#6b2c48' },
    forest: { name: 'フォレスト', bgType: 'gradient', bgColor: '#13322b', bgColor2: '#1f4d3a', borderColor: '#b9f5d0', borderAlpha: 0.2, buttonColor: '#ffffff', buttonAlpha: 0.08, accent: '#4ed39a', labelColor: '#e4f6ec' },
    ocean: { name: 'オーシャン', bgType: 'gradient', bgColor: '#0f2b4c', bgColor2: '#1c5d8c', borderColor: '#9ad8ff', borderAlpha: 0.25, buttonColor: '#ffffff', buttonAlpha: 0.09, accent: '#47c1ff', labelColor: '#e6f4ff' },
    sunset: { name: 'サンセット', bgType: 'gradient', bgColor: '#ff8a5c', bgColor2: '#c2457a', borderColor: '#ffffff', borderAlpha: 0.3, buttonColor: '#ffffff', buttonAlpha: 0.16, accent: '#ffe08a', labelColor: '#ffffff' },
    mono: { name: 'モノクロ', bgType: 'color', bgColor: '#111111', bgColor2: '#222222', borderColor: '#ffffff', borderAlpha: 0.1, buttonColor: '#ffffff', buttonAlpha: 0.06, accent: '#ffffff', labelColor: '#f2f2f2' },
    paper: { name: 'ペーパー', bgType: 'color', bgColor: '#fbf7ef', bgColor2: '#f3ecdc', borderColor: '#5b4a2e', borderAlpha: 0.18, buttonColor: '#5b4a2e', buttonAlpha: 0.06, accent: '#c7772f', labelColor: '#3f3423' }
  };

  let lookPreview;
  function updateLookPreview() {
    if (!lookPreview) return;
    renderPanel(lookPreview, cfg.appearance, { title: cfg.pages[0].name, page: cfg.pages[0], pageCount: cfg.pages.length, pageIndex: 0 });
  }
  function lookChanged(rerender) {
    save();
    updateLookPreview();
    if (rerender) renderLookTab();
  }
  const A = () => cfg.appearance;
  const setA = (k, rerender) => v => { A()[k] = v; A().theme = 'custom'; lookChanged(rerender); };

  function renderLookTab() {
    const tab = $('#tab-look');
    const scroll = $('#main').scrollTop;
    tab.textContent = '';
    const a = A();
    lookPreview = h('div');
    const controls = h('div', null,
      h('div', { class: 'card' }, h('h2', null, 'テーマ'), h('p', { class: 'hint' }, '選んだあとに下の項目で細かく調整できます。'),
        h('div', { class: 'themes' }, Object.entries(THEMES).map(([key, t]) => h('button', {
          class: `theme${a.theme === key ? ' on' : ''}`,
          onclick: () => { Object.assign(cfg.appearance, { opacity: 0.94 }, t, { theme: key }); delete cfg.appearance.name; lookChanged(true); }
        }, h('div', { class: 'sw', style: { background: t.bgType === 'gradient' ? `linear-gradient(140deg, ${t.bgColor}, ${t.bgColor2})` : t.bgColor } },
          h('i', { style: { background: t.accent } }), h('i', { style: { background: DLCommon.hexA(t.buttonColor, Math.max(0.3, t.buttonAlpha)) } }), h('i', { style: { background: t.labelColor } })),
        h('div', { class: 'nm' }, t.name))))),
      h('div', { class: 'card' }, h('h2', null, 'レイアウト'),
        h('p', { class: 'hint' }, '減らした場合、入りきらないボタンは自動で次のページに移ります。'),
        row('列（横の数）', h('input', { type: 'number', min: 1, max: 10, value: a.cols, onchange: e => { a.cols = Number(e.target.value); saveAndReload(); } })),
        row('行（縦の数）', h('input', { type: 'number', min: 1, max: 10, value: a.rows, onchange: e => { a.rows = Number(e.target.value); saveAndReload(); } }),
          h('span', { class: 'count-badge' }, `1 画面 ${a.cols * a.rows} 個`)),
        row('アイコンの大きさ', slider(a.iconSize, 24, 128, 2, 'px', v => { a.iconSize = v; lookChanged(); })),
        row('ボタンの間隔', slider(a.gap, 0, 30, 1, 'px', v => { a.gap = v; lookChanged(); })),
        row('外側の余白', slider(a.padding, 0, 40, 1, 'px', v => { a.padding = v; lookChanged(); })),
        row('上部の見出し', toggle(a.showHeader, v => { a.showHeader = v; lookChanged(); }, 'ページ名と設定ボタンを表示'))),
      h('div', { class: 'card' }, h('h2', null, '背景'),
        row('種類', seg([['color', '単色'], ['gradient', 'グラデーション'], ['image', '画像']], a.bgType, v => { setA('bgType', true)(v); })),
        row(a.bgType === 'gradient' ? '色（始点・終点）' : '色',
          h('input', { type: 'color', value: a.bgColor, oninput: e => setA('bgColor')(e.target.value) }),
          a.bgType === 'gradient' ? h('input', { type: 'color', value: a.bgColor2, oninput: e => setA('bgColor2')(e.target.value) }) : null),
        a.bgType === 'image' ? row('画像',
          h('button', { class: 'btn small', onclick: async () => { const r = await window.dl.pick('background'); if (r.ok) setA('bgImage', true)(r.data); else if (r.message) snack(r.message, true); } }, '🖼 画像を選ぶ'),
          seg([['cover', '全体を覆う'], ['contain', '全体を表示']], a.bgImageFit, v => setA('bgImageFit', true)(v)),
          a.bgImage ? h('button', { class: 'btn small ghost', onclick: () => setA('bgImage', true)(null) }, '削除') : null) : null,
        row('不透明度', slider(Math.round(a.opacity * 100), 20, 100, 1, '%', v => setA('opacity')(v / 100)))),
      h('div', { class: 'card' }, h('h2', null, '枠と角'),
        row('枠の色', h('input', { type: 'color', value: a.borderColor, oninput: e => setA('borderColor')(e.target.value) }),
          slider(Math.round(a.borderAlpha * 100), 0, 100, 1, '%', v => setA('borderAlpha')(v / 100))),
        row('枠の太さ', slider(a.borderWidth, 0, 6, 1, 'px', v => setA('borderWidth')(v))),
        row('全体の角丸', slider(a.panelRadius, 0, 40, 1, 'px', v => setA('panelRadius')(v))),
        row('ボタンの角丸', slider(a.buttonRadius, 0, 40, 1, 'px', v => setA('buttonRadius')(v)))),
      h('div', { class: 'card' }, h('h2', null, 'ボタンと文字'),
        row('ボタンの色', h('input', { type: 'color', value: a.buttonColor, oninput: e => setA('buttonColor')(e.target.value) }),
          slider(Math.round(a.buttonAlpha * 100), 0, 100, 1, '%', v => setA('buttonAlpha')(v / 100))),
        row('アクセント色', h('input', { type: 'color', value: a.accent, oninput: e => setA('accent')(e.target.value) })),
        row('名前を表示', toggle(a.showLabels, v => setA('showLabels')(v))),
        row('文字の色', h('input', { type: 'color', value: a.labelColor, oninput: e => setA('labelColor')(e.target.value) })),
        row('文字の大きさ', slider(a.fontSize, 8, 18, 1, 'px', v => setA('fontSize')(v)))));
    const pane = h('div', { class: 'preview-pane' },
      h('div', { class: 'preview-stage' }, lookPreview),
      h('div', { class: 'preview-cap' }, 'プレビュー（デスクトップのランチャーにもすぐ反映されます）'));
    tab.append(h('h1', null, '見た目'), h('p', { class: 'lead' }, '色・枠・背景・大きさ・並べる数を自由に変えられます。'),
      h('div', { class: 'look-layout' }, controls, pane));
    updateLookPreview();
    $('#main').scrollTop = scroll;
  }

  // =====================================================================
  // 動作
  // =====================================================================
  function acceleratorFrom(e) {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
    const key = codeToKey(e);
    if (!key) return null;
    const mods = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    const map = { Left: 'Left', Right: 'Right', Up: 'Up', Down: 'Down', Escape: 'Escape' };
    const k = map[key] || (key.length === 1 ? key.toUpperCase() : key);
    if (!mods.length && !/^F\d+$/.test(k)) return '';
    return [...mods, k].join('+');
  }
  const prettyAccel = acc => (acc || '').split('+').filter(Boolean).map(k => ({ Control: 'Ctrl', Super: 'Win' })[k] || k);

  function renderBehaviorTab() {
    const tab = $('#tab-behavior');
    tab.textContent = '';
    const b = cfg.behavior;
    const set = (k, rerender) => v => { b[k] = v; save(); if (rerender) renderBehaviorTab(); };
    const zOpt = (v, title, desc, art) => h('button', { class: `z-opt${b.zOrder === v ? ' on' : ''}`, onclick: () => set('zOrder', true)(v) },
      h('div', { class: 'zi' }, art), h('b', null, title), h('small', null, desc));
    const win = (l, t, w, hgt, bg, z) => h('i', { style: { left: `${l}%`, top: `${t}px`, width: `${w}%`, height: `${hgt}px`, background: bg, zIndex: z, boxShadow: '0 2px 6px rgba(0,0,0,.15)' } });
    const L = '#8b7cf6';
    const W = '#cfd3e2';

    const hk = h('div', { class: 'hotkey-box', tabindex: 0 },
      b.hotkey ? prettyAccel(b.hotkey).flatMap((k, i) => (i ? [h('span', { class: 'ph' }, '+'), h('span', { class: 'keycap' }, k)] : [h('span', { class: 'keycap' }, k)]))
        : [h('span', { class: 'ph' }, '未設定')]);
    let recording = false;
    const recBtn = h('button', { class: 'btn small', onclick: () => {
      recording = !recording;
      hk.classList.toggle('recording', recording);
      recBtn.textContent = recording ? '組み合わせを押してください…' : '⏺ 変更する';
      if (recording) hk.focus();
    } }, '⏺ 変更する');
    hk.addEventListener('keydown', async e => {
      if (!recording) return;
      e.preventDefault();
      const acc = acceleratorFrom(e);
      if (acc === null) return;
      if (acc === '') { snack('Ctrl・Alt・Shift・Win のいずれかと一緒に押してください（F1〜F24 は単独でも可）', true); return; }
      recording = false;
      b.hotkey = acc;
      await save(true);
      renderBehaviorTab();
    });

    tab.append(h('h1', null, '動作'), h('p', { class: 'lead' }, '表示のしかた、呼び出しキー、起動時の動きを設定します。'),
      h('div', { class: 'card' }, h('h2', null, '表示の優先度'), h('p', { class: 'hint' }, 'ほかのウィンドウとの重なり方を選びます。どの設定でも、呼び出しホットキーで一番前に出せます。'),
        h('div', { class: 'z-options' },
          zOpt('top', '常に一番前', 'ブラウザなどを開いても、ランチャーは常に手前に表示されます。', [win(5, 18, 60, 40, W, 1), win(55, 6, 38, 46, L, 2)]),
          zOpt('normal', 'ふつう', 'ほかのウィンドウを開くと、その後ろに回ります。', [win(55, 6, 38, 46, L, 1), win(5, 14, 70, 44, W, 2)]),
          zOpt('bottom', 'デスクトップに貼り付け', '常に一番後ろ。デスクトップのアイコンのように使えます。', [win(5, 6, 88, 52, W, 2), win(70, 30, 26, 30, L, 1)]))),
      h('div', { class: 'card' }, h('h2', null, '呼び出しホットキー'),
        h('p', { class: 'hint' }, 'どの画面からでも、このキーでランチャーを一番前に出します。もう一度押すと元の状態（「常に一番前」の場合は非表示）に戻ります。'),
        row('有効にする', toggle(b.hotkeyEnabled, set('hotkeyEnabled', true))),
        row('キーの組み合わせ', hk, recBtn),
        hotkeyStatus && !hotkeyStatus.ok ? h('div', { class: 'note err' }, hotkeyStatus.message) : null),
      h('div', { class: 'card' }, h('h2', null, '起動と操作'),
        row('Windows の起動時', toggle(b.autoStart, set('autoStart'), '自動で起動する')),
        row('起動したとき', toggle(b.showOnStartup, set('showOnStartup'), 'ランチャーを表示する（オフならタスクトレイに常駐）')),
        row('位置', toggle(b.locked, set('locked'), '位置をロックする（ドラッグで動かないように）')),
        row('実行後', toggle(b.hideAfterAction, set('hideAfterAction'), 'ボタンを押したらランチャーを隠す')),
        h('div', { class: 'note', style: { marginTop: '12px' } }, 'ランチャーは見出しや余白をドラッグして移動できます。右クリックで「編集」「隠す」「終了」のメニューが出ます。タスクトレイのアイコンからも操作できます。')));
  }

  // =====================================================================
  // バックアップと移行
  // =====================================================================
  let lastImport = null;
  function renderBackupTab() {
    const tab = $('#tab-backup');
    tab.textContent = '';
    const result = [];
    if (lastImport) {
      if (!lastImport.ok) result.push(h('div', { class: 'note err', style: { marginTop: '12px' } }, lastImport.message));
      else {
        result.push(h('div', { class: 'note ok', style: { marginTop: '12px' } }, '読み込みました。直前の設定は自動でバックアップしてあります。'));
        if (lastImport.missing && lastImport.missing.length) {
          result.push(h('div', { class: 'note warn', style: { marginTop: '8px' } },
            `この PC に見つからないアプリ・ファイルが ${lastImport.missing.length} 件あります。「ボタン」から場所を直してください。`,
            h('ul', { class: 'missing' }, lastImport.missing.slice(0, 12).map(m => h('li', null, `${m.button}: `, h('code', null, m.path))))));
        }
      }
    }
    tab.append(h('h1', null, 'バックアップと移行'), h('p', { class: 'lead' }, '設定（ボタン・アイコン画像・見た目・動作）を 1 つのファイルに保存し、別の PC に引き継げます。'),
      h('div', { class: 'backup-grid' },
        h('div', { class: 'card' }, h('h2', null, '📤 エクスポート'), h('p', { class: 'hint' }, '今の設定をファイル（.json）に保存します。USB メモリやクラウドに入れて新しい PC へ運んでください。'),
          h('button', { class: 'btn primary', onclick: async () => { const r = await window.dl.exportConfig(); if (r.ok) snack(`保存しました: ${r.path}`); } }, '設定をエクスポート…')),
        h('div', { class: 'card' }, h('h2', null, '📥 インポート'), h('p', { class: 'hint' }, 'エクスポートしたファイルを読み込み、今の設定と置き換えます。今の設定は自動でバックアップされます。'),
          h('button', { class: 'btn primary', onclick: async () => {
            const r = await window.dl.importConfig();
            if (!r.ok && !r.message) return;
            lastImport = r;
            if (r.ok) { const res = await window.dl.getConfig(); cfg = res.config; nav.folders = []; nav.pageIndex = 0; nav.selId = null; renderAll(); showTab('backup'); }
            else renderBackupTab();
          } }, '設定をインポート…'), result)),
      h('div', { class: 'card' }, h('h2', null, '新しい PC への移行手順'),
        h('ol', { class: 'steps-guide' },
          h('li', null, '今の PC で「設定をエクスポート」を押し、ファイルを保存する'),
          h('li', null, '新しい PC に DeskLauncher をインストールして起動する'),
          h('li', null, 'この画面の「設定をインポート」で、保存したファイルを選ぶ'),
          h('li', null, '見つからないアプリが表示されたら、「ボタン」でその場所を選び直す'),
          h('li', null, '「動作」タブで、ホットキーと自動起動を確認する')),
        h('p', { class: 'hint', style: { marginTop: '10px' } }, 'Web サイトのログイン状態はブラウザ側で管理されるため、新しい PC のブラウザで一度ログインしてください。'),
        h('button', { class: 'btn', onclick: () => openHelp('migration') }, '📖 移行手順書を読む')),
      h('div', { class: 'card' }, h('h2', null, 'その他'),
        h('div', { class: 'inline' },
          h('button', { class: 'btn', onclick: () => window.dl.openBackups() }, '📁 自動バックアップのフォルダを開く'),
          h('button', { class: 'btn danger', onclick: () => confirmBox('設定を初期状態に戻しますか？', '今の設定は自動でバックアップされます。', '初期化する', async () => {
            await window.dl.resetConfig();
            const res = await window.dl.getConfig();
            cfg = res.config; nav.folders = []; nav.pageIndex = 0; nav.selId = null;
            renderAll();
            snack('初期状態に戻しました');
          }) }, '初期状態に戻す…'),
          h('span', { style: { flex: 1 } }),
          h('button', { class: 'btn ghost', onclick: () => window.dl.quit() }, 'DeskLauncher を終了'))));
  }


  // =====================================================================
  // ヘルプ（同梱の説明書）
  // =====================================================================
  let helpDocs = [];
  let helpDoc = 'manual';
  const helpCache = {};

  function openHelp(id) {
    helpDoc = id;
    renderHelpTab();
    showTab('help');
    $('#main').scrollTop = 0;
  }

  async function renderHelpTab() {
    const tab = $('#tab-help');
    if (!helpDocs.length) helpDocs = await window.dl.listDocs();
    if (!helpCache[helpDoc]) helpCache[helpDoc] = await window.dl.readDoc(helpDoc);
    const res = helpCache[helpDoc];
    tab.textContent = '';
    const body = h('article', { class: 'doc' });
    const toc = h('nav', { class: 'doc-toc' });
    if (res.ok) {
      const { html, headings } = window.DLMarkdown.render(res.text);
      body.innerHTML = html; // 変換器が HTML をエスケープ済み（同梱ファイルのみを表示）
      toc.append(h('div', { class: 'doc-toc-title' }, '目次'),
        ...headings.map(x => h('a', { onclick: () => {
          const el = document.getElementById(x.id);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } }, x.text)));
    } else {
      body.append(h('div', { class: 'note err' }, res.message));
    }
    tab.append(
      h('h1', null, 'ヘルプ'),
      h('p', { class: 'lead' }, 'DeskLauncher に同梱している説明書です。読みたいものを選んでください。'),
      h('div', { class: 'pages-bar' },
        helpDocs.map(d => h('button', { class: `chip${d.id === helpDoc ? ' on' : ''}`, onclick: () => openHelp(d.id) }, d.title)),
        h('div', { class: 'page-tools' },
          h('button', { class: 'btn small', onclick: async () => {
            const r = await window.dl.openDocExternal(helpDoc);
            if (!r.ok) snack(r.message || '開けませんでした', true);
          } }, '📄 ファイルで開く（印刷・保存用）'))),
      h('div', { class: 'doc-layout' }, h('div', { class: 'card doc-card' }, body), toc));
  }

  // ---------- モーダル ----------
  function modal(content) {
    const m = $('#modal');
    m.textContent = '';
    m.append(content);
    m.classList.add('on');
    m.onclick = e => { if (e.target === m) closeModal(); };
  }
  function closeModal() { $('#modal').classList.remove('on'); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  function confirmBox(title, text, okLabel, onOk) {
    modal(h('div', { class: 'modal', style: { width: '420px' } }, h('h3', null, title), h('p', null, text),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: closeModal }, 'キャンセル'),
        h('button', { class: 'btn primary', style: { background: 'var(--danger)', borderColor: 'var(--danger)' }, onclick: () => { closeModal(); onOk(); } }, okLabel))));
  }

  function prompt(title, text, value, onOk) {
    const input = h('input', { type: 'text', value });
    const ok = () => { closeModal(); onOk(input.value.trim()); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    modal(h('div', { class: 'modal', style: { width: '420px' } }, h('h3', null, title), h('p', null, text), input,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: closeModal }, 'キャンセル'), h('button', { class: 'btn primary', onclick: ok }, 'OK'))));
    setTimeout(() => { input.focus(); input.select(); }, 30);
  }

  // ---------- 初期表示 ----------
  // 自動アイコンがまだ取れていないボタンは、開いたときにまとめて取得する
  async function fillMissingIcons(pages) {
    for (const p of pages) for (const b of p.buttons) {
      if (!b) continue;
      if (b.type === 'folder') await fillMissingIcons(b.pages);
      else if (b.icon.mode === 'auto' && !b.icon.data && b.steps.length) await fetchAutoIcon(b);
    }
  }

  if (nav.selId && locate(nav.selId)) selectById(nav.selId);
  renderAll();
  const startTab = new URLSearchParams(location.search).get('tab');
  if (startTab) showTab(startTab);
  fillMissingIcons(cfg.pages);
  window.__dl = { showTab, selectById, openStepPicker, closeModal, openHelp }; // 動作確認用
})();
