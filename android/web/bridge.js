// window.sticky for Android.
//
// The desktop UI talks to Electron's main process through window.sticky
// (electron/preload.js). On Android the same API is provided here, on top of
// ScratchNative, a Java object the app adds to every WebView (Bridge.java).
// The channel names are the desktop IPC channel names, so the Java side reads
// like electron/main.js.
//
//   ScratchNative.invoke(channel, argsJson, callId)  -> answer via __scratch.resolve(callId, value)
//   ScratchNative.send(channel, argsJson)            -> no answer
//   ScratchNative.drag(mode)                         -> the native window follows the finger
//   ScratchNative.info()                             -> JSON { overlay: bool }
//   events from Java                                 -> __scratch.emit(channel, value)
//
// It also stands in for desktop-only behaviour that a phone doesn't have:
// dragging a window by its header (-webkit-app-region: drag), the resize
// grip, the window zoom factor, and the native date/time pickers (which a
// WebView floating over other apps cannot open by itself).

const N = window.ScratchNative;

if (N) {
  const info = (() => {
    try {
      return JSON.parse(N.info());
    } catch {
      return { overlay: false };
    }
  })();

  // ------------------------------------------------------------ transport ---

  // PNG bytes (Uint8Array) travel as base64 inside the JSON.
  const toBase64 = (bytes) => {
    let s = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(s);
  };
  const fromBase64 = (b64) => {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
    return out;
  };
  const encode = (v) => {
    if (v instanceof Uint8Array) return { __bytes: toBase64(v) };
    if (Array.isArray(v)) return v.map(encode);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = encode(x);
      return o;
    }
    return v;
  };
  const decode = (v) => {
    if (Array.isArray(v)) return v.map(decode);
    if (v && typeof v === 'object') {
      if (typeof v.__bytes === 'string') return fromBase64(v.__bytes);
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = decode(x);
      return o;
    }
    return v;
  };

  let nextCall = 1;
  const calls = new Map();
  const listeners = new Map(); // channel -> Set(callback)

  const invoke = (channel, ...args) =>
    new Promise((resolve, reject) => {
      const id = nextCall++;
      calls.set(id, { resolve, reject });
      try {
        N.invoke(channel, JSON.stringify(encode(args)), id);
      } catch (err) {
        calls.delete(id);
        reject(err);
      }
    });
  const send = (channel, ...args) => N.send(channel, JSON.stringify(encode(args)));
  const subscribe = (channel, callback) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    const set = listeners.get(channel);
    const handler = (payload) => callback(payload);
    set.add(handler);
    return () => set.delete(handler);
  };

  window.__scratch = {
    resolve(id, value, error) {
      const call = calls.get(id);
      if (!call) return;
      calls.delete(id);
      if (error) call.reject(new Error(error));
      else call.resolve(decode(value));
    },
    emit(channel, value) {
      const set = listeners.get(channel);
      if (!set) return;
      const payload = decode(value);
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (err) {
          console.error(err);
        }
      }
    },
  };

  // ------------------------------------------------- the API, as on desktop ---

  window.sticky = {
    note: {
      get: () => invoke('note:get'),
      update: (patch) => send('note:update', patch),
      setCollapsed: (collapsed) => invoke('note:set-collapsed', collapsed),
      setPopoverHeight: (height) => send('note:popover-height', height),
      resize: () => {}, // the native window does this itself (see the resize grip below)
      hide: () => send('note:hide'),
      openMenu: () => send('note:context-menu'),
      onChanged: (callback) => subscribe('note:changed', callback),
    },
    app: {
      newNote: (mode) => send('app:new-note', { mode }),
      openMenu: () => send('app:menu'),
      openManager: () => send('app:open-manager'),
      openTimer: () => send('app:open-timer'),
      openSettings: () => send('app:open-settings'),
      openNotepad: () => send('app:open-notepad'),
      newNotepad: () => send('app:new-notepad'),
      hiddenCount: () => invoke('app:hidden-count'),
      onHiddenCount: (callback) => subscribe('launcher:hidden-count', callback),
      closeWindow: () => send('window:close'),
    },
    hidden: {
      list: () => invoke('hidden:list'),
      restore: (ids) => invoke('hidden:restore', ids),
      remove: (ids) => invoke('hidden:delete', ids),
      onChanged: (callback) => subscribe('hidden:changed', callback),
    },
    about: {
      get: () => invoke('about:get'),
      openRepository: () => send('about:open-repository'),
    },
    settings: {
      get: () => invoke('settings:get'),
      set: (key, value) => send('settings:set', key, value),
      action: (name) => send('settings:action', name),
      onChanged: (callback) => subscribe('settings:changed', callback),
    },
    timer: {
      get: () => invoke('timer:get'),
      command: (name) => send('timer:command', name),
      setLengths: (lengths) => send('timer:set-lengths', lengths),
      onChanged: (callback) => subscribe('timer:changed', callback),
    },
    notepad: {
      load: () => invoke('notepad:load'),
      save: (drawing) => invoke('notepad:save', drawing),
      rename: (title) => send('notepad:rename', title),
      exportPng: (png) => invoke('notepad:export', png),
      copyPng: (png) => send('notepad:copy', png),
      setFullScreen: (flag) => invoke('notepad:set-fullscreen', flag),
      minimize: () => send('notepad:minimize'),
      toggleMaximize: () => send('notepad:toggle-maximize'),
      close: () => send('notepad:close'),
      onFlush: (callback) => subscribe('notepad:flush', callback),
      onFullScreen: (callback) => subscribe('notepad:fullscreen-changed', callback),
    },
  };

  // ------------------------------------------------------ phone behaviour ---

  document.documentElement.classList.add('is-android');
  if (info.overlay) document.documentElement.classList.add('is-overlay');
  if (info.lowEnd) document.documentElement.classList.add('low-end');

  const style = document.createElement('style');
  style.textContent = `
    /* Notes always float over other apps on Android, so this switch does nothing there. */
    .set-row:has(.switch[aria-label="Keep notes on top"]) { display: none; }
    /* No hover on a touch screen. The per-task buttons appear on hover on
       desktop; invisible but tappable would invite accidental deletes. */
    .task-actions { opacity: 0.55; }
    .task-row:focus-within .task-actions { opacity: 1; }
    html.is-android { -webkit-tap-highlight-color: transparent; }
    /* A finger needs a bigger corner grip than a mouse pointer. */
    html.is-android .resize-handle { touch-action: none; width: 28px; height: 28px; opacity: 0.8; }
    /* The notepad fills a phone screen: no Maximize, and Minimize is the Home button.
       A very narrow screen may still scroll the header. */
    html.is-android .np-btn[aria-label="Maximize"],
    html.is-android .np-btn[aria-label="Minimize"] { display: none; }
    html.is-android .np-header { overflow-x: auto; scrollbar-width: none; }
    html.is-android .np-header > * { flex-shrink: 0; }
    html.is-android .np-header .np-status { flex-shrink: 1; }
    /* A long title gives way so the header's buttons (close included) stay on screen. */
    html.is-android .np-header .np-title-sizer { flex-shrink: 1; min-width: 56px; overflow: hidden; }
    html.is-android .np-tools { flex-wrap: wrap; }

    /* Notepad toolbar on one line, with dropdowns (see "Notepad toolbar" below). */
    .np-oneline { flex-wrap: nowrap; gap: 6px; padding: 6px 8px; min-height: 46px; }
    .np-oneline > .np-sep { display: none; }
    .np-oneline > .np-dd-tools { order: 1; }
    .np-oneline > .np-dd-size { order: 2; }
    .np-oneline > .np-chip, .np-oneline > .np-seg { order: 3; }
    .np-oneline > .np-dd-colors { order: 4; }
    .np-oneline > .np-dd-more { order: 5; margin-left: auto; }
    .np-dd {
      display: inline-flex; align-items: center; justify-content: center; gap: 3px; flex: none;
      height: 34px; min-width: 34px; padding: 0 6px; border: 0; border-radius: 8px;
      background: rgba(39, 48, 74, 0.07); color: var(--ink); font: inherit; font-size: 13px; font-weight: 700;
    }
    .np-dd[aria-expanded="true"] { background: rgba(53, 80, 168, 0.16); color: var(--pen); }
    .np-dd svg { width: 20px; height: 20px; }
    .np-dd .np-dd-caret { width: 10px; height: 10px; opacity: 0.7; }
    .np-dd-icon { display: grid; place-items: center; width: 22px; height: 22px; }
    .np-dd-icon svg { width: 20px; height: 20px; }
    .np-dd-num { min-width: 18px; text-align: center; }
    .np-dd-swatch { width: 20px; height: 20px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2); }
    .np-dd-more svg { fill: currentColor; }

    /* Closed: the desktop controls are hidden; open: shown as a panel under the row. */
    .np-oneline > .np-tools, .np-oneline > .np-size, .np-oneline > .np-colors,
    .np-oneline > .np-select, .np-oneline > .np-btn, .np-oneline > .np-more-panel { display: none; }
    .np-oneline.np-open-tools > .np-tools,
    .np-oneline.np-open-size > .np-size,
    .np-oneline.np-open-colors > .np-colors {
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
      position: absolute; z-index: 20; top: calc(100% + 4px); left: 8px; right: 8px;
      padding: 10px; border-radius: 12px; background: #fff6c9;
      box-shadow: 0 0 0 0.5px rgba(80, 60, 10, 0.2), 0 8px 20px -6px rgba(70, 52, 12, 0.4);
    }
    .np-oneline.np-open-tools > .np-tools .np-tool { width: 42px; height: 42px; }
    .np-oneline.np-open-size > .np-size { gap: 12px; padding: 14px 16px; }
    .np-oneline.np-open-size > .np-size input[type="range"] { flex: 1; min-width: 0; }
    .np-oneline.np-open-colors > .np-colors .np-swatch,
    .np-oneline.np-open-colors > .np-colors .np-custom { width: 32px; height: 32px; }
    /* ⋯: paper, more paper and clear the page, one under the other. */
    .np-oneline.np-open-more > .np-more-panel {
      display: block; position: absolute; z-index: 20; top: calc(100% + 4px); right: 8px; width: 216px; height: 140px;
      border-radius: 12px; background: #fff6c9;
      box-shadow: 0 0 0 0.5px rgba(80, 60, 10, 0.2), 0 8px 20px -6px rgba(70, 52, 12, 0.4);
    }
    .np-oneline.np-open-more > .np-select,
    .np-oneline.np-open-more > .np-btn {
      display: flex; position: absolute; z-index: 21; right: 16px; width: 200px; height: 38px; margin: 0;
    }
    .np-oneline.np-open-more > .np-select { top: calc(100% + 12px); }
    .np-oneline.np-open-more > .np-btn {
      align-items: center; justify-content: flex-start; gap: 10px; padding: 0 10px; place-items: initial;
      font-size: 14px; font-weight: 600;
    }
    .np-oneline.np-open-more > .np-btn:not(.danger) { top: calc(100% + 56px); }
    .np-oneline.np-open-more > .np-btn.danger { top: calc(100% + 100px); color: var(--danger); }
    .np-oneline.np-open-more > .np-btn::after { content: attr(aria-label); }
    /* Slower phones (Java decides, see ScratchService.detectLowEnd): every note
       is its own page, so keep each one cheap to draw. No paper texture, one
       shadow instead of three, and nothing that animates forever. */
    html.low-end .note { background-image: none; }
    html.low-end .note, html.low-end .panel { box-shadow: 0 2px 6px rgba(70, 52, 12, 0.22); }
    html.low-end .note::after { display: none; }
    html.low-end .timer-face.is-running .timer-fill,
    html.low-end .status-overdue .ticker-dot { animation: none; }
  `;
  document.head.appendChild(style);

  // Window size (Settings > Size): Electron zooms the whole page; do the same.
  const applyScale = (s) => {
    const scale = s && typeof s.scale === 'number' ? s.scale : 1;
    document.documentElement.style.zoom = scale === 1 ? '' : String(scale);
  };
  window.sticky.settings.get().then(applyScale).catch(() => {});
  window.sticky.settings.onChanged(applyScale);

  // Dragging a window by its header, and resizing a note by its corner grip.
  // The page only says which gesture started; Java moves the window with the
  // finger's screen position, so the window can't run away from the finger.
  const DRAG_AREAS = '.note-header, .panel-header, .np-header';
  const NO_DRAG =
    'input, textarea, select, button, a, [contenteditable], .title-sizer, .note-controls, .palette, .np-group, .np-title-sizer';
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!e.isPrimary || !(e.target instanceof Element)) return;
      if (e.target.closest('.resize-handle')) {
        e.stopPropagation(); // the desktop grip measures in screen pixels; Java does it here
        e.preventDefault();
        N.drag('resize');
        return;
      }
      if (e.target.closest(DRAG_AREAS) && !e.target.closest(NO_DRAG)) N.drag('move');
    },
    true,
  );

  // Notepad toolbar on one line. On a phone the desktop toolbar wraps to three
  // rows; here it becomes one row of dropdowns: Tool, Size, Colour and ⋯
  // (paper, more paper, clear the page). Each dropdown shows the desktop's own
  // controls (the same React elements, restyled as a panel), so every feature
  // stays. The dropdown buttons are added after React's elements and placed
  // with CSS `order`; React's elements are never moved.
  if (new URLSearchParams(window.location.search).get('view') === 'notepad') {
    const CARET = '<svg class="np-dd-caret" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const MENUS = ['tools', 'size', 'colors', 'more'];
    let bar = null;
    const triggers = {};

    const close = () => MENUS.forEach((m) => bar && bar.classList.remove(`np-open-${m}`));
    const open = (m) => {
      const was = bar.classList.contains(`np-open-${m}`);
      close();
      if (!was) bar.classList.add(`np-open-${m}`);
      Object.entries(triggers).forEach(([k, t]) => t.setAttribute('aria-expanded', String(!was && k === m)));
    };

    // The buttons show the current tool, size and colour. They sit inside the
    // observed toolbar, so only write what actually changed: any write is a
    // mutation, and writing every time would call this again, forever.
    let shown = { icon: null, title: null, num: null, colour: null };
    const sync = () => {
      if (!bar) return;
      const active = bar.querySelector('.np-tools .is-active');
      const icon = active ? active.innerHTML : '';
      const title = `Tool: ${active ? active.getAttribute('aria-label') : ''}`;
      const dot = bar.querySelector('.np-size-dot');
      const numEl = bar.querySelector('.np-size-num');
      const num = numEl ? numEl.textContent : '';
      const colour = dot ? dot.style.background : '';
      if (icon !== shown.icon) triggers.tools.firstElementChild.innerHTML = icon;
      if (title !== shown.title) triggers.tools.title = title;
      if (num !== shown.num) triggers.size.querySelector('.np-dd-num').textContent = num;
      if (colour !== shown.colour) triggers.colors.querySelector('.np-dd-swatch').style.background = colour;
      shown = { icon, title, num, colour };
    };

    const makeTrigger = (menu, label, inner) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `np-dd np-dd-${menu}`;
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-haspopup', 'true');
      b.setAttribute('aria-expanded', 'false');
      b.title = label;
      b.innerHTML = inner + (menu === 'more' ? '' : CARET);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        open(menu);
      });
      triggers[menu] = b;
      return b;
    };

    const setUp = (toolbar) => {
      bar = toolbar;
      bar.classList.add('np-oneline');
      const panel = document.createElement('div'); // the background of the ⋯ panel
      panel.className = 'np-more-panel';
      bar.append(
        makeTrigger('tools', 'Tools', '<span class="np-dd-icon"></span>'),
        makeTrigger('size', 'Size', '<span class="np-dd-num"></span>'),
        makeTrigger('colors', 'Colour', '<span class="np-dd-swatch"></span>'),
        makeTrigger('more', 'Paper and page', '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4.5" cy="10" r="1.7"/><circle cx="10" cy="10" r="1.7"/><circle cx="15.5" cy="10" r="1.7"/></svg>'),
        panel,
      );
      sync();
      new MutationObserver(sync).observe(bar, { subtree: true, childList: true, attributes: true, characterData: true });

      // Choosing something closes its menu; the size slider and the colour
      // wheel stay open until the user taps elsewhere.
      bar.addEventListener('click', (e) => {
        const t = e.target instanceof Element ? e.target : null;
        if (!t) return;
        if (t.closest('.np-tools .np-tool') || t.closest('.np-colors .np-swatch')) setTimeout(close, 0);
        else if (t.closest('.np-oneline > .np-btn')) setTimeout(close, 0);
      });
      bar.addEventListener('change', (e) => {
        if (e.target instanceof Element && e.target.matches('.np-select')) setTimeout(close, 0);
      });
    };

    // Tapping anywhere outside an open menu closes it.
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!bar || !MENUS.some((m) => bar.classList.contains(`np-open-${m}`))) return;
        const t = e.target instanceof Element ? e.target : null;
        const inside = t && (t.closest('.np-dd') || t.closest('.np-tools, .np-size, .np-colors, .np-select, .np-more-panel, .np-oneline > .np-btn'));
        if (!inside) close();
      },
      true,
    );

    const found = () => document.querySelector('.np-toolbar');
    if (found()) setUp(found());
    else {
      const wait = new MutationObserver(() => {
        if (found()) {
          wait.disconnect();
          setUp(found());
        }
      });
      wait.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  // Native pickers. A WebView floating over other apps has no Activity to
  // open its own date/time dialog from, so Java shows it and the value is
  // written back the way a user's choice would be (React sees an input event).
  if (info.overlay) {
    const PICKERS = new Set(['date', 'time', 'month']);
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const setValue = (el, value) => {
      valueSetter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const openPicker = (el) => {
      invoke('x:pick', { type: el.type, value: el.value })
        .then((value) => {
          if (typeof value === 'string') setValue(el, value);
        })
        .catch(() => {});
    };
    document.addEventListener(
      'click',
      (e) => {
        const el = e.target instanceof Element ? e.target.closest('input') : null;
        if (el && PICKERS.has(el.type) && !el.disabled) {
          e.preventDefault();
          openPicker(el);
        }
      },
      true,
    );
    const nativeShowPicker = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = function showPicker() {
      if (PICKERS.has(this.type)) return openPicker(this);
      return nativeShowPicker?.call(this);
    };
  }
}
