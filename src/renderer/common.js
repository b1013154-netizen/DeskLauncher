'use strict';
// ランチャー本体と設定画面のプレビューで共有する描画処理
(function () {
  const STEP_TYPES = {
    url: { icon: '🌐', name: 'URL を開く', desc: 'Web ページを開きます。ブラウザも選べます' },
    open: { icon: '📂', name: 'アプリ・ファイル・フォルダを開く', desc: 'exe やドキュメント、フォルダを開きます' },
    command: { icon: '⌨️', name: 'コマンドを実行', desc: 'コマンドプロンプトの命令を実行します' },
    keys: { icon: '🎹', name: 'キーを送る', desc: 'Ctrl+C などのキー操作を、使っていたアプリに送ります' },
    text: { icon: '📋', name: '文字を貼り付け', desc: '登録した文章を、使っていたアプリに貼り付けます' },
    wait: { icon: '⏱️', name: '待つ', desc: '次の動作まで指定した時間だけ待ちます' }
  };

  function hexA(hex, alpha) {
    const h = String(hex || '#000000').replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
    const n = parseInt(full, 16) || 0;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  // 明るい背景かどうか（ラベルの影の付け方を変えるため）
  function isLight(hex) {
    const h = String(hex || '#000').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16) || 0;
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return (r * 299 + g * 587 + b * 114) / 1000 > 160;
  }

  function fallbackEmoji(btn) {
    if (!btn) return '';
    if (btn.type === 'folder') return '📁';
    const s = (btn.steps || [])[0];
    return s ? STEP_TYPES[s.type]?.icon || '✨' : '✨';
  }

  function iconNode(btn, size) {
    const wrap = document.createElement('div');
    wrap.className = 'dl-ico';
    wrap.style.width = wrap.style.height = `${size}px`;
    const icon = btn.icon || {};
    if ((icon.mode === 'auto' || icon.mode === 'custom') && icon.data) {
      const img = document.createElement('img');
      img.src = icon.data;
      img.alt = '';
      img.draggable = false;
      wrap.appendChild(img);
    } else if (icon.mode === 'none') {
      wrap.classList.add('dl-ico-letter');
      wrap.textContent = (btn.label || '?').trim().slice(0, 1).toUpperCase();
      wrap.style.fontSize = `${Math.round(size * 0.45)}px`;
    } else {
      wrap.classList.add('dl-ico-emoji');
      wrap.textContent = icon.emoji || fallbackEmoji(btn);
      wrap.style.fontSize = `${Math.round(size * 0.62)}px`;
    }
    if (btn.type === 'folder') wrap.classList.add('dl-folder');
    return wrap;
  }

  // パネルの見た目を CSS 変数として設定する
  function applyPanelVars(el, a) {
    const s = el.style;
    const cell = a.iconSize + 20;
    s.setProperty('--cols', a.cols);
    s.setProperty('--rows', a.rows);
    s.setProperty('--icon', `${a.iconSize}px`);
    s.setProperty('--cell', `${cell}px`);
    s.setProperty('--gap', `${a.gap}px`);
    s.setProperty('--pad', `${a.padding}px`);
    s.setProperty('--panel-radius', `${a.panelRadius}px`);
    s.setProperty('--btn-radius', `${a.buttonRadius}px`);
    s.setProperty('--border', a.borderWidth > 0 ? `${a.borderWidth}px solid ${hexA(a.borderColor, a.borderAlpha)}` : 'none');
    s.setProperty('--btn-bg', hexA(a.buttonColor, a.buttonAlpha));
    s.setProperty('--btn-bg-hover', hexA(a.buttonColor, Math.min(1, a.buttonAlpha + 0.08)));
    s.setProperty('--accent', a.accent);
    s.setProperty('--label', a.labelColor);
    s.setProperty('--font', `${a.fontSize}px`);
    s.setProperty('--label-shadow', isLight(a.labelColor) ? '0 1px 2px rgba(0,0,0,.45)' : 'none');
    s.setProperty('--bg-opacity', a.opacity);
    let bg;
    if (a.bgType === 'image' && a.bgImage) bg = `center / ${a.bgImageFit || 'cover'} no-repeat url("${a.bgImage}"), ${a.bgColor}`;
    else if (a.bgType === 'gradient') bg = `linear-gradient(140deg, ${a.bgColor}, ${a.bgColor2})`;
    else bg = a.bgColor;
    s.setProperty('--bg', bg);
    el.classList.toggle('dl-no-labels', !a.showLabels);
  }

  function buttonNode(btn, a) {
    const el = document.createElement('div');
    el.className = 'dl-btn';
    if (btn.color) el.style.background = btn.color;
    el.appendChild(iconNode(btn, a.iconSize));
    if (a.showLabels) {
      const l = document.createElement('div');
      l.className = 'dl-lbl';
      l.textContent = btn.label || '';
      el.appendChild(l);
    }
    el.title = btn.label || '';
    return el;
  }

  // パネル全体を描画する。opts: { title, canBack, page, pageCount, pageIndex, showHeader, onButton, onBack, onGear, onDot, onContext }
  function renderPanel(panel, a, opts) {
    panel.className = 'dl-panel';
    panel.textContent = '';
    applyPanelVars(panel, a);
    if (a.showHeader || opts.canBack) {
      const head = document.createElement('div');
      head.className = 'dl-head';
      if (opts.canBack) {
        const back = document.createElement('button');
        back.textContent = '‹';
        back.title = '戻る';
        back.style.fontSize = '18px';
        back.addEventListener('click', () => opts.onBack && opts.onBack());
        head.appendChild(back);
      }
      const t = document.createElement('div');
      t.className = 'dl-title';
      t.textContent = opts.title || '';
      head.appendChild(t);
      const gear = document.createElement('button');
      gear.textContent = '⚙';
      gear.title = '設定';
      gear.addEventListener('click', () => opts.onGear && opts.onGear());
      head.appendChild(gear);
      panel.appendChild(head);
    }
    const grid = document.createElement('div');
    grid.className = 'dl-grid';
    const slots = a.cols * a.rows;
    for (let i = 0; i < slots; i++) {
      const btn = opts.page?.buttons[i];
      if (!btn) {
        const empty = document.createElement('div');
        empty.className = 'dl-slot';
        grid.appendChild(empty);
        continue;
      }
      const node = buttonNode(btn, a);
      node.dataset.id = btn.id;
      node.addEventListener('click', () => opts.onButton && opts.onButton(btn, node));
      node.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); opts.onContext && opts.onContext(btn); });
      grid.appendChild(node);
    }
    panel.appendChild(grid);
    if (opts.pageCount > 1) {
      const dots = document.createElement('div');
      dots.className = 'dl-dots';
      for (let i = 0; i < opts.pageCount; i++) {
        const d = document.createElement('div');
        d.className = `dl-dot${i === opts.pageIndex ? ' dl-on' : ''}`;
        d.addEventListener('click', () => opts.onDot && opts.onDot(i));
        dots.appendChild(d);
      }
      panel.appendChild(dots);
    }
    return panel;
  }

  window.DLCommon = { STEP_TYPES, hexA, isLight, iconNode, buttonNode, applyPanelVars, fallbackEmoji, renderPanel };
})();
