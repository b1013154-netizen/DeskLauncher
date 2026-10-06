'use strict';
// ランチャー本体の画面
(async function () {
  const { renderPanel } = window.DLCommon;
  const panel = document.getElementById('panel');
  const toastEl = document.getElementById('toast');
  let config;
  // フォルダの階層: [{ id: フォルダボタンID または null, pageIndex }]
  let stack = [{ id: null, pageIndex: 0 }];

  function findFolder(pages, id) {
    for (const p of pages) for (const b of p.buttons) {
      if (!b || b.type !== 'folder') continue;
      if (b.id === id) return b;
      const hit = findFolder(b.pages, id);
      if (hit) return hit;
    }
    return null;
  }

  function current() {
    const top = stack[stack.length - 1];
    if (top.id == null) return { pages: config.pages, folder: null, top };
    const folder = findFolder(config.pages, top.id);
    return folder ? { pages: folder.pages, folder, top } : null;
  }

  function render() {
    let cur = current();
    // 編集でフォルダが消えていたら一番上に戻る
    while (!cur && stack.length > 1) { stack.pop(); cur = current(); }
    const { pages, folder, top } = cur;
    top.pageIndex = Math.min(top.pageIndex, pages.length - 1);
    const page = pages[top.pageIndex];
    const title = folder ? (pages.length > 1 ? `${folder.label} · ${page.name}` : folder.label) : page.name;
    renderPanel(panel, config.appearance, {
      title,
      canBack: stack.length > 1,
      page,
      pageCount: pages.length,
      pageIndex: top.pageIndex,
      onButton: press,
      onBack: () => { stack.pop(); render(); },
      onGear: () => window.dl.openSettings(),
      onDot: i => { top.pageIndex = i; render(); },
      onContext: btn => window.dl.contextMenu(btn.id)
    });
    document.body.classList.toggle('unlocked', !config.behavior.locked);
    requestAnimationFrame(() => {
      const r = panel.getBoundingClientRect();
      window.dl.resize({ width: Math.ceil(r.width), height: Math.ceil(r.height) });
    });
  }

  async function press(btn, node) {
    if (btn.type === 'folder') {
      stack.push({ id: btn.id, pageIndex: 0 });
      render();
      return;
    }
    node.classList.add('dl-pressed');
    const res = await window.dl.run(btn.id);
    node.classList.remove('dl-pressed');
    const cls = res.ok ? 'dl-done' : 'dl-fail';
    node.classList.add(cls);
    setTimeout(() => node.classList.remove(cls), 700);
  }

  let toastTimer;
  function toast({ message, kind }) {
    toastEl.textContent = message;
    toastEl.className = `show ${kind || ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = ''; }, 4500);
  }

  // マウスホイールでページ切り替え
  let wheelLock = 0;
  panel.addEventListener('wheel', e => {
    const now = Date.now();
    if (now < wheelLock) return;
    const { pages, top } = current();
    if (pages.length < 2) return;
    const next = top.pageIndex + (e.deltaY > 0 ? 1 : -1);
    if (next < 0 || next >= pages.length) return;
    wheelLock = now + 250;
    top.pageIndex = next;
    render();
  }, { passive: true });

  panel.addEventListener('contextmenu', e => { e.preventDefault(); window.dl.contextMenu(null); });

  const init = await window.dl.getConfig();
  config = init.config;
  render();
  window.dl.onConfig(c => { config = c; render(); });
  window.dl.onToast(toast);
})();
