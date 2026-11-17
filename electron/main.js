'use strict';
// Main process.
//
// Architecture: every sticky note is its own small frameless, transparent
// BrowserWindow. That is what lets notes sit anywhere on the desktop, float
// above Chrome/VS Code independently, and remember their own positions. A
// tiny "note pad" launcher window holds the + button and the settings menu,
// and a tray icon offers the same menu. The main process owns all data; note
// windows only ever see and patch their own note.

const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  Tray,
  clipboard,
  ClipboardItem,
  dialog,
  nativeImage,
  screen,
  session,
  shell,
} = require('electron');
const { Store } = require('./store');
const S = require('./schema');
const { dueReminders, carryReminded } = require('./reminders');
const { createStartup } = require('./startup');
const { migrateLegacyData } = require('./migrate');
const about = require('./about');
const { Pomodoro, DEFAULTS: POMODORO_DEFAULTS } = require('./pomodoro');
const { NotepadStore, cleanPng } = require('./notepad');

const DEV_URL = process.env.VITE_DEV_SERVER_URL || null;
const PRELOAD = path.join(__dirname, 'preload.js');
const ICON = path.join(__dirname, 'assets', 'icon.png');
// Also the name of the "start with Windows" registry value, which
// build/installer.nsh writes too: change both together, or not at all.
// Kept from when the app was called Sticky Notes (before 1.4.0): the
// installer derives its Installed Apps ID from build.appId, which is the same
// value, so changing either would make an update install a second copy.
const APP_ID = 'com.stickynotes.desktop';
const startup = createStartup({ app, valueName: APP_ID });

// Window geometry, in device-independent pixels. Note windows include a
// transparent margin around the paper so the soft shadow has room to render;
// these numbers must match .note-shell padding in src/styles/note.css.
const NOTE_MIN = { width: 230, height: 200 };
const NOTE_COLLAPSED_HEIGHT = 68; // 44px header + 8px top + 16px bottom margin
const LAUNCHER_SIZE = { width: 116, height: 144 };
const MANAGER_SIZE = { width: 404, height: 500 }; // hidden-notes manager
const TIMER_SIZE = { width: 236, height: 416 }; // Pomodoro
const SETTINGS_SIZE = { width: 372, height: 600 }; // Settings
const ABOUT_SIZE = { width: 300, height: 392 }; // About Scratch
const NOTEPAD_SIZE = { width: 960, height: 660 }; // Notepad (drawing pad), first open
const NOTEPAD_MIN = { width: 600, height: 420 };
const EDGE_GAP = 24;
const CASCADE_STEP = 28;
const REMINDER_CHECK_MS = 30_000;
const IS_SMOKE = process.env.STICKY_SMOKE_TEST === '1'; // end-to-end test run, see smoke.js

if (process.env.STICKY_DATA_DIR) app.setPath('userData', process.env.STICKY_DATA_DIR);


let store = null;
let tray = null;
let launcherWin = null;
let quitting = false;
let managerWin = null; // hidden-notes manager
let aboutWin = null; // About Scratch
let timerWin = null; // Pomodoro
let settingsWin = null; // Settings
const notepadWindows = new Map(); // notepadId -> BrowserWindow (Notepads: drawing pads)
const senderNotepads = new Map(); // webContents.id -> notepadId
let notepadStore = null;
const noteWindows = new Map(); // noteId -> BrowserWindow
const senderNotes = new Map(); // webContents.id -> noteId
const senderRoles = new Map(); // webContents.id -> 'launcher' | 'manager' | 'timer'
// The smoke test swaps this in to answer confirmation dialogs without a human.
const testHooks = { confirm: null };

// ---------------------------------------------------------------- helpers ---

// Window scale (Settings). Windows and their content grow together: sizes in
// this file are base sizes, and sc() turns them into real window sizes. Notes
// keep their size at scale 1 in the data file, so changing the scale back and
// forth never drifts.
let uiScale = 1;
const sc = (n) => Math.round(n * uiScale);
const scaled = (size) => ({ width: sc(size.width), height: sc(size.height) });
const baseBounds = (b) => ({ x: b.x, y: b.y, width: Math.round(b.width / uiScale), height: Math.round(b.height / uiScale) });

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Keep a rectangle fully inside the work area of the display it overlaps most. */
function clampToWorkArea(bounds) {
  const wa = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(bounds.width, wa.width);
  const height = Math.min(bounds.height, wa.height);
  return {
    x: clamp(bounds.x, wa.x, wa.x + wa.width - width),
    y: clamp(bounds.y, wa.y, wa.y + wa.height - height),
    width,
    height,
  };
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function noteLabel(note) {
  if (note.title.trim()) return note.title.trim();
  if (note.mode === 'monthly') {
    const [y, m] = note.month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  const [y, m, d] = note.date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function toRenderer(note) {
  const { id, title, color, mode, date, month, tasks, collapsed, opacity, historyOpen } = note;
  const ticker = store.data.settings.ticker; // app-wide setting, sent with each note
  return structuredClone({ id, title, color, mode, date, month, tasks, collapsed, opacity, historyOpen, ticker });
}

function loadView(win, query) {
  if (DEV_URL) {
    const url = new URL(DEV_URL);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return win.loadURL(url.toString());
  }
  return win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
}

function harden(win) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    if (url !== wc.getURL()) event.preventDefault();
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.on('dom-ready', () => wc.setZoomFactor(uiScale));
  const crashes = []; // times this window's renderer died in the last minute
  wc.on('render-process-gone', (_event, { reason, exitCode }) => {
    if (reason === 'clean-exit' || quitting) return;
    logError('window', `renderer gone: ${reason} (exit code ${exitCode})`);
    const now = Date.now();
    crashes.push(now);
    while (crashes[0] < now - 60_000) crashes.shift();
    // If a window's renderer dies, bring the page back (a beat later: reloading
    // while the dead process is still being cleaned up can hang the page).
    if (crashes.length < 3) {
      setTimeout(() => !wc.isDestroyed() && wc.reload(), 300);
      return;
    }
    // Dying again and again: another reload would only loop. Ask instead.
    crashes.length = 0;
    showProblem({
      message: 'A Scratch window keeps closing unexpectedly.',
      detail: `Your notes are safe. Restarting Scratch usually fixes this.\n\nDetails were written to:\n${logFile()}`,
      buttons: ['Restart Scratch', 'Not now'],
    }).then(({ response }) => response === 0 && restartApp());
  });
}

function baseWindowOptions(bounds) {
  return {
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false, // the paper draws its own shadow
    resizable: false, // transparent windows can't use native resize; we resize via IPC
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: store.data.settings.alwaysOnTop,
    title: 'Scratch',
    icon: ICON,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      devTools: !app.isPackaged,
    },
  };
}

function applyAlwaysOnTop(win) {
  if (!win || win.isDestroyed()) return;
  // 'floating' keeps notes above normal app windows (Chrome, VS Code, ...)
  // without fighting system UI like the Start menu.
  win.setAlwaysOnTop(store.data.settings.alwaysOnTop, 'floating');
}

// 'moved' fires once when a drag ends on Windows and macOS. Elsewhere only
// 'move' exists, so debounce it there; using it on Windows would snap a note
// back inside the screen while the user is still dragging it.
function trackMoves(win, handler) {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    win.on('moved', handler);
  } else {
    win.on('move', debounce(handler, 250));
  }
}

// When Windows signs out or shuts down it closes our windows before any
// 'before-quit'. Without this, each note's close handler would mark it hidden
// and every note would be missing after the restart.
function markQuitting() {
  quitting = true;
  if (store) store.flush();
}

// ----------------------------------------------------------------- errors ---
// Problems go to errors.log in the data folder (to attach to a bug report).
// When the user needs to know or act, they also get a plain-language dialog.

const LOG_MAX_BYTES = 1_000_000;
const logFile = () => path.join(app.getPath('userData'), 'errors.log');

function logError(where, err) {
  const line = `${new Date().toISOString()} [${where}] ${err?.stack || err}\n`;
  console.error(line.trimEnd());
  try {
    const file = logFile();
    if ((fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) > LOG_MAX_BYTES) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, line);
  } catch {
    // logging is best effort; it must never cause a second error
  }
}

// Non-blocking. Skipped in the smoke test, where nobody is there to click OK.
function showProblem({ type = 'error', message, detail, buttons = ['OK'] }) {
  if (IS_SMOKE) return Promise.resolve({ response: -1 });
  return dialog.showMessageBox({ type, title: 'Scratch', message, detail, buttons, defaultId: 0, noLink: true });
}

function restartApp() {
  app.relaunch();
  markQuitting();
  app.quit();
}

// Before the app is up there is nothing to keep running: explain, then exit,
// rather than leave an invisible Scratch.exe behind.
function fatalStart(err) {
  logError('startup', err);
  if (!IS_SMOKE) {
    dialog.showErrorBox(
      'Scratch could not start',
      `Something went wrong while opening Scratch, so it has closed. Your notes have not been deleted.\n\n` +
        `Try opening Scratch again. If this keeps happening, please report it and attach this file:\n${logFile()}\n\n` +
        `Error: ${err?.message || err}`,
    );
  }
  app.exit(1);
}

let errorDialogOpen = false;
function onUnexpectedError(err) {
  logError('main', err);
  if (errorDialogOpen || quitting) return;
  errorDialogOpen = true;
  const saved = store ? store.flush() : false;
  showProblem({
    message: 'Scratch ran into an unexpected problem.',
    detail:
      `${saved ? 'Your notes are saved. ' : ''}You can keep working, or restart Scratch if something looks wrong.\n\n` +
      `Details were written to:\n${logFile()}`,
    buttons: ['Keep working', 'Restart Scratch'],
  }).then(({ response }) => {
    errorDialogOpen = false;
    if (response === 1) restartApp();
  });
}

let saveWarned = false; // once per session: a full disk would otherwise raise a dialog on every keystroke
function onSaveError(err) {
  logError('save', err);
  if (saveWarned || quitting) return;
  saveWarned = true;
  showProblem({
    type: 'warning',
    message: "Scratch couldn't save your notes.",
    detail:
      `Your notes are still open and Scratch will keep trying to save them. Check that the disk isn't full ` +
      `and that this folder can be written to:\n${app.getPath('userData')}\n\nError: ${err?.code || err?.message || err}`,
  });
}

// Tell the user when their notes file was damaged, instead of silently showing fewer notes.
function reportRecovery() {
  const kept = store.unreadableFile ? `\n\nThe damaged file was kept, in case you need it:\n${store.unreadableFile}` : '';
  if (store.loadedFrom === store.bakPath) {
    logError('load', `notes file unreadable, opened the backup${kept ? `; damaged file kept as ${store.unreadableFile}` : ''}`);
    showProblem({
      type: 'warning',
      message: 'Scratch restored your notes from a backup.',
      detail: `Your notes file couldn't be read, so Scratch opened the most recent backup. Your last few changes may be missing.${kept}`,
    });
  } else if (!store.loadedFrom && !store.isFirstRun) {
    logError('load', `notes file and backup unreadable${kept ? `; damaged file kept as ${store.unreadableFile}` : ''}`);
    showProblem({
      type: 'warning',
      message: "Scratch couldn't read your notes.",
      detail: `Your notes file is damaged and no usable backup was found, so Scratch started with no notes.${kept}`,
    });
  }
}

process.on('uncaughtException', (err) => (store ? onUnexpectedError(err) : fatalStart(err)));
process.on('unhandledRejection', (reason) => logError('promise', reason));

function watchSessionEnd(win) {
  win.on('query-session-end', markQuitting);
  win.on('session-end', markQuitting);
}

function allWindows() {
  return [launcherWin, managerWin, timerWin, aboutWin, settingsWin, ...notepadWindows.values(), ...noteWindows.values()].filter((w) => w && !w.isDestroyed());
}

// ----------------------------------------------------------- note windows ---

function windowBoundsFor(note) {
  const b = { ...note.bounds };
  b.width = sc(Math.max(b.width, NOTE_MIN.width));
  b.height = sc(note.collapsed ? NOTE_COLLAPSED_HEIGHT : Math.max(b.height, NOTE_MIN.height));
  return clampToWorkArea(b);
}

function createNoteWindow(note, { focus = false } = {}) {
  const existing = noteWindows.get(note.id);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    if (focus) existing.focus();
    return existing;
  }

  const bounds = windowBoundsFor(note);
  note.bounds.x = bounds.x;
  note.bounds.y = bounds.y;

  const win = new BrowserWindow(baseWindowOptions(bounds));
  const wcId = win.webContents.id;
  noteWindows.set(note.id, win);
  senderNotes.set(wcId, note.id);
  harden(win);
  applyAlwaysOnTop(win);
  applyOpacity(note);

  win.once('ready-to-show', () => {
    if (focus) {
      win.show();
      win.focus();
    } else {
      win.showInactive();
    }
  });

  const rememberPosition = () => {
    if (win.isDestroyed()) return;
    const current = win.getBounds();
    const safe = clampToWorkArea(current);
    if (safe.x !== current.x || safe.y !== current.y) win.setPosition(safe.x, safe.y);
    note.bounds.x = safe.x;
    note.bounds.y = safe.y;
    store.save();
  };
  trackMoves(win, rememberPosition);
  watchSessionEnd(win);

  // Alt+F4 or any other close that isn't an app quit hides the note rather
  // than losing track of it. Deleting goes through deleteNote() instead.
  win.on('close', () => {
    if (!quitting && !win.__deleting && store.getNote(note.id)) {
      note.hidden = true;
      note.hiddenAt = Date.now();
      store.save();
    }
  });
  win.on('closed', () => {
    noteWindows.delete(note.id);
    senderNotes.delete(wcId);
    broadcastHidden();
  });

  loadView(win, { view: 'note', id: note.id, fresh: focus ? '1' : '0' });
  return win;
}

function nextNotePosition() {
  const anchor =
    launcherWin && !launcherWin.isDestroyed()
      ? launcherWin.getBounds()
      : (() => {
          const wa = screen.getPrimaryDisplay().workArea;
          return { x: wa.x + wa.width - EDGE_GAP, y: wa.y + wa.height - EDGE_GAP, width: 0, height: 0 };
        })();
  const visible = store.data.notes.filter((n) => !n.hidden).length;
  const step = (visible % 6) * CASCADE_STEP;
  const { width, height } = scaled(S.DEFAULT_NOTE_SIZE);
  const at = clampToWorkArea({
    x: anchor.x - width - 8 - step,
    y: anchor.y + anchor.height - height - step,
    width,
    height,
  });
  return { ...at, ...S.DEFAULT_NOTE_SIZE }; // stored at scale 1

}

function newNote({ mode = 'daily', title, tasks, color } = {}) {
  const settings = store.data.settings;
  const fixed = S.COLORS.includes(settings.newNoteColor) ? settings.newNoteColor : null;
  const pick = S.COLORS.includes(color) ? color : fixed ?? S.COLORS[settings.colorCursor % S.COLORS.length];
  if (!color && !fixed) settings.colorCursor = (settings.colorCursor + 1) % S.COLORS.length;
  const note = S.createNote({ mode, title, tasks, color: pick, bounds: nextNotePosition() });
  store.addNote(note);
  createNoteWindow(note, { focus: true });
  return note;
}

function pushNote(note) {
  const win = noteWindows.get(note.id);
  if (win && !win.isDestroyed()) win.webContents.send('note:changed', toRenderer(note));
}

// A collapsed note's window is only as tall as its strip, so a popover (the
// color palette) opened from it was cut off. While one is open the window
// grows to fit it; closing it shrinks the window back. If growing would run
// off the bottom of the screen, clampToWorkArea moves the window up, and the
// same offset is undone afterwards so the strip ends up where it was.
const popoverShift = new Map(); // noteId -> pixels the window was moved up

function setPopoverHeight(note, height) {
  const win = noteWindows.get(note.id);
  if (!win || win.isDestroyed() || !note.collapsed) return;
  const cur = win.getBounds();
  if (height === null) {
    const shift = popoverShift.get(note.id) ?? 0;
    popoverShift.delete(note.id);
    win.setBounds({ ...cur, y: cur.y + shift, height: sc(NOTE_COLLAPSED_HEIGHT) });
    return;
  }
  const want = Math.round(clamp(height * uiScale, sc(NOTE_COLLAPSED_HEIGHT), sc(600)));
  if (want <= cur.height) return;
  const next = clampToWorkArea({ ...cur, height: want });
  popoverShift.set(note.id, (popoverShift.get(note.id) ?? 0) + (cur.y - next.y));
  win.setBounds(next);
}

function setCollapsed(note, collapsed) {
  const shift = popoverShift.get(note.id) ?? 0; // undo any move made for an open palette
  popoverShift.delete(note.id);
  note.collapsed = collapsed;
  const win = noteWindows.get(note.id);
  if (win && !win.isDestroyed()) {
    const grown = win.getBounds();
    const cur = { ...grown, y: grown.y + shift };
    if (collapsed) {
      win.setBounds({ ...cur, height: sc(NOTE_COLLAPSED_HEIGHT) });
    } else {
      const next = clampToWorkArea({ ...cur, height: sc(Math.max(note.bounds.height, NOTE_MIN.height)) });
      win.setBounds(next);
      note.bounds = baseBounds(next);
    }
  }
  store.save();
}

function reopenNote(note, { focus = true } = {}) {
  note.hidden = false;
  note.hiddenAt = null;
  store.save();
  createNoteWindow(note, { focus });
  broadcastHidden();
}

/** Whole-window transparency for one note (1 = solid). */
function applyOpacity(note) {
  const win = noteWindows.get(note.id);
  if (win && !win.isDestroyed()) win.setOpacity(note.opacity);
}

function setAllOpacity(opacity) {
  const value = S.cleanOpacity(opacity);
  if (value === null) return;
  for (const note of store.data.notes) {
    note.opacity = value;
    applyOpacity(note);
    pushNote(note);
  }
  store.save();
  broadcastSettings();
}

/**
 * Delete one or more notes after a single confirmation. Returns how many
 * were deleted (0 if the user cancelled).
 */
async function deleteNotes(notes, parentWin, { all = false } = {}) {
  notes = notes.filter((n) => store.getNote(n.id));
  if (!notes.length) return 0;
  const tasks = notes.reduce((sum, n) => sum + n.tasks.length, 0);
  const one = notes.length === 1;
  const what = one ? `“${noteLabel(notes[0])}”` : all ? `all ${notes.length} hidden notes` : `${notes.length} notes`;
  const lost = tasks ? `${one ? 'Its' : 'Their'} ${tasks} task${tasks === 1 ? '' : 's'} will be removed. ` : '';
  const opts = {
    type: 'warning',
    buttons: [one ? 'Delete note' : `Delete ${notes.length} notes`, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: one ? 'Delete note' : 'Delete notes',
    message: `Delete ${what}?`,
    detail: `${lost}This can't be undone.`,
  };

  let confirmed;
  if (testHooks.confirm) {
    confirmed = testHooks.confirm(opts);
  } else {
    const target = parentWin && !parentWin.isDestroyed() ? parentWin : undefined;
    const { response } = target ? await dialog.showMessageBox(target, opts) : await dialog.showMessageBox(opts);
    confirmed = response === 0;
  }
  if (!confirmed) return 0;

  for (const note of notes) {
    store.deleteNote(note.id);
    const win = noteWindows.get(note.id);
    if (win && !win.isDestroyed()) {
      win.__deleting = true;
      win.close();
    }
  }
  broadcastHidden();
  return notes.length;
}

const deleteNote = (note, parentWin) => deleteNotes([note], parentWin);

function showAllNotes() {
  for (const win of allWindows()) {
    win.showInactive();
    win.moveTop();
  }
  reclampAll();
}

function setAllCollapsed(collapsed) {
  for (const note of store.data.notes) {
    if (note.hidden || note.collapsed === collapsed) continue;
    setCollapsed(note, collapsed);
    pushNote(note);
  }
}

function reclampAll() {
  for (const [id, win] of noteWindows) {
    if (win.isDestroyed()) continue;
    const note = store.getNote(id);
    const safe = clampToWorkArea(win.getBounds());
    win.setBounds(safe);
    if (note) {
      note.bounds.x = safe.x;
      note.bounds.y = safe.y;
    }
  }
  if (launcherWin && !launcherWin.isDestroyed()) {
    const safe = clampToWorkArea(launcherWin.getBounds());
    launcherWin.setBounds(safe);
    store.data.settings.launcherBounds = safe;
  }
  store.save();
}

// ------------------------------------------------------- launcher + menus ---

function createLauncher() {
  const wa = screen.getPrimaryDisplay().workArea;
  const saved = store.data.settings.launcherBounds;
  const fallback = {
    x: wa.x + wa.width - sc(LAUNCHER_SIZE.width) - EDGE_GAP,
    y: wa.y + wa.height - sc(LAUNCHER_SIZE.height) - EDGE_GAP,
  };
  const bounds = clampToWorkArea({ ...(saved ?? fallback), ...scaled(LAUNCHER_SIZE) });

  launcherWin = new BrowserWindow(baseWindowOptions(bounds));
  senderRoles.set(launcherWin.webContents.id, 'launcher');
  harden(launcherWin);
  applyAlwaysOnTop(launcherWin);
  launcherWin.once('ready-to-show', () => launcherWin.showInactive());

  const remember = () => {
    if (!launcherWin || launcherWin.isDestroyed()) return;
    const cur = launcherWin.getBounds();
    const safe = clampToWorkArea(cur);
    if (safe.x !== cur.x || safe.y !== cur.y) launcherWin.setPosition(safe.x, safe.y);
    store.data.settings.launcherBounds = safe;
    store.save();
  };
  trackMoves(launcherWin, remember);
  watchSessionEnd(launcherWin);
  // The launcher is the app's home base; Alt+F4 shouldn't make it vanish.
  launcherWin.on('close', (event) => {
    if (!quitting) event.preventDefault();
  });
  launcherWin.on('closed', () => {
    launcherWin = null;
  });

  loadView(launcherWin, { view: 'launcher' });
}

// ------------------------------------------- manager and timer windows ---

/** A small paper-styled window (hidden notes, Pomodoro, Settings, About). */
function createPaperWindow({ role, size, boundsKey, fallback, query, onClosed }) {
  const saved = store.data.settings[boundsKey];
  const bounds = clampToWorkArea({ ...(saved ? { x: saved.x, y: saved.y } : fallback()), ...scaled(size) });
  const win = new BrowserWindow(baseWindowOptions(bounds));
  const wcId = win.webContents.id;
  senderRoles.set(wcId, role);
  harden(win);
  applyAlwaysOnTop(win);
  watchSessionEnd(win);
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  trackMoves(win, () => {
    if (win.isDestroyed()) return;
    const cur = win.getBounds();
    const safe = clampToWorkArea(cur);
    if (safe.x !== cur.x || safe.y !== cur.y) win.setPosition(safe.x, safe.y);
    store.data.settings[boundsKey] = safe;
    store.save();
  });
  win.on('closed', () => {
    senderRoles.delete(wcId);
    onClosed();
  });
  loadView(win, query);
  return win;
}

function focusWindow(win) {
  win.show();
  win.moveTop();
  win.focus();
}

function centered(size) {
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(wa.x + (wa.width - size.width) / 2),
    y: Math.round(wa.y + (wa.height - size.height) / 2),
  };
}

function nearLauncher(size) {
  size = scaled(size);
  if (!launcherWin || launcherWin.isDestroyed()) return centered(size);
  const b = launcherWin.getBounds();
  return { x: b.x - size.width - 8, y: b.y + b.height - size.height };
}

function openManager() {
  if (managerWin && !managerWin.isDestroyed()) return focusWindow(managerWin);
  managerWin = createPaperWindow({
    role: 'manager',
    size: MANAGER_SIZE,
    boundsKey: 'managerBounds',
    fallback: () => centered(scaled(MANAGER_SIZE)),
    query: { view: 'manager' },
    onClosed: () => {
      managerWin = null;
    },
  });
}

/** What the manager lists: enough to recognise a note without opening it. */
function hiddenSummary() {
  return store.data.notes
    .filter((n) => n.hidden)
    .sort((a, b) => (b.hiddenAt ?? 0) - (a.hiddenAt ?? 0))
    .map((n) => ({
      id: n.id,
      label: noteLabel(n),
      untitled: !n.title.trim(),
      color: n.color,
      mode: n.mode,
      total: n.tasks.length,
      done: n.tasks.filter((t) => t.done).length,
      preview: n.tasks.filter((t) => !t.done).slice(0, 2).map((t) => t.text),
      hiddenAt: n.hiddenAt,
    }));
}

function broadcastHidden() {
  if (quitting || !store) return;
  if (managerWin && !managerWin.isDestroyed()) managerWin.webContents.send('hidden:changed', hiddenItems());
  if (launcherWin && !launcherWin.isDestroyed()) {
    launcherWin.webContents.send('launcher:hidden-count', hiddenCount());
  }
}

function hiddenNotesByIds(ids) {
  if (!Array.isArray(ids)) return [];
  const wanted = new Set(ids.filter((id) => typeof id === 'string'));
  return store.data.notes.filter((n) => n.hidden && wanted.has(n.id));
}

// Pomodoro. Test runs can shorten the phases through the environment.
const envMs = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const pomodoro = new Pomodoro({
  focusMs: envMs('STICKY_FOCUS_MS', POMODORO_DEFAULTS.focusMs),
  breakMs: envMs('STICKY_BREAK_MS', POMODORO_DEFAULTS.breakMs),
  onChange: () => broadcastTimer(),
  onFinish: (phase) => onPomodoroFinish(phase),
});

function sessionsToday() {
  const p = store.data.settings.pomodoro;
  return p.date === S.localDateKey() ? p.count : 0;
}

function timerSnapshot() {
  const { focusMin, breakMin } = store.data.settings.pomodoroLengths;
  return { ...pomodoro.snapshot(), sessionsToday: sessionsToday(), focusMin, breakMin };
}

function broadcastTimer() {
  if (timerWin && !timerWin.isDestroyed()) timerWin.webContents.send('timer:changed', timerSnapshot());
}

function onPomodoroFinish(phase) {
  const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
  if (phase === 'focus') {
    store.data.settings.pomodoro = { date: S.localDateKey(), count: sessionsToday() + 1 };
    store.save();
    if (store.data.settings.pomodoroNotify) {
      notify('Focus session finished', `Nice work. Take a ${minutes(pomodoro.durations.break)}-minute break.`, openTimer);
    }
  } else if (store.data.settings.pomodoroNotify) {
    notify('Break is over', pomodoro.autoFocus ? 'The next focus session has started.' : 'Ready for the next focus session?', openTimer);
  }
  if (timerWin && !timerWin.isDestroyed()) {
    timerWin.showInactive();
    timerWin.moveTop();
  }
}

function openAbout() {
  if (aboutWin && !aboutWin.isDestroyed()) return focusWindow(aboutWin);
  aboutWin = createPaperWindow({
    role: 'about',
    size: ABOUT_SIZE,
    boundsKey: 'aboutBounds',
    fallback: () => centered(scaled(ABOUT_SIZE)),
    query: { view: 'about' },
    onClosed: () => {
      aboutWin = null;
    },
  });
}

function openTimer() {
  if (timerWin && !timerWin.isDestroyed()) return focusWindow(timerWin);
  timerWin = createPaperWindow({
    role: 'timer',
    size: TIMER_SIZE,
    boundsKey: 'timerBounds',
    fallback: () => nearLauncher(TIMER_SIZE),
    query: { view: 'timer' },
    onClosed: () => {
      timerWin = null; // the countdown itself keeps running in this process
    },
  });
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) return focusWindow(settingsWin);
  settingsWin = createPaperWindow({
    role: 'settings',
    size: SETTINGS_SIZE,
    boundsKey: 'settingsBounds',
    fallback: () => centered(scaled(SETTINGS_SIZE)),
    query: { view: 'settings' },
    onClosed: () => {
      settingsWin = null;
    },
  });
}

// ---------------------------------------------------------------- notepads ---
// Paint-style drawing pads on notepad paper. There can be many; like notes,
// closing one hides it (it waits under Hidden notes). Unlike the other windows
// they are opaque, so they can be resized natively, maximized and made full screen.

function newNotepadBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const size = { width: Math.min(sc(NOTEPAD_SIZE.width), wa.width), height: Math.min(sc(NOTEPAD_SIZE.height), wa.height) };
  const open = notepadStore.pads.filter((p) => !p.hidden).length;
  const at = centered(size);
  const step = (open % 6) * CASCADE_STEP;
  return clampToWorkArea({ x: at.x + step, y: at.y + step, ...size });
}

function newNotepad() {
  const pad = notepadStore.create({ bounds: newNotepadBounds() });
  openNotepadWindow(pad, { focus: true });
  return pad;
}

function openNotepadWindow(pad, { focus = true } = {}) {
  const existing = notepadWindows.get(pad.id);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    if (focus) focusWindow(existing);
    else existing.showInactive();
    return existing;
  }
  const wa = screen.getPrimaryDisplay().workArea;
  const bounds = clampToWorkArea(pad.bounds ?? newNotepadBounds());

  const win = new BrowserWindow({
    ...baseWindowOptions(bounds),
    transparent: false,
    backgroundColor: '#fffdf5',
    hasShadow: true,
    resizable: true,
    maximizable: true,
    minimizable: true,
    fullscreenable: true,
    skipTaskbar: false, // a big working window: findable on the taskbar when minimized
    minWidth: Math.min(sc(NOTEPAD_MIN.width), wa.width),
    minHeight: Math.min(sc(NOTEPAD_MIN.height), wa.height),
    title: pad.title.trim() || 'Notepad',
  });
  const wcId = win.webContents.id;
  notepadWindows.set(pad.id, win);
  senderNotepads.set(wcId, pad.id);
  senderRoles.set(wcId, 'notepad');
  harden(win);
  applyAlwaysOnTop(win);
  watchSessionEnd(win);
  win.once('ready-to-show', () => {
    if (focus) {
      win.show();
      win.focus();
    } else {
      win.showInactive();
    }
  });

  const rememberBounds = debounce(() => {
    if (win.isDestroyed() || win.isFullScreen() || win.isMaximized() || win.isMinimized()) return;
    pad.bounds = win.getBounds();
    notepadStore.save();
  }, 300);
  win.on('move', rememberBounds);
  win.on('resize', rememberBounds);

  const sendFullScreen = () => !win.isDestroyed() && win.webContents.send('notepad:fullscreen-changed', win.isFullScreen());
  win.on('enter-full-screen', sendFullScreen);
  win.on('leave-full-screen', sendFullScreen);

  // Closing asks the page to save its drawing first (it answers with
  // notepad:close). If it doesn't answer in time, close anyway. A closed
  // notepad is hidden, not deleted, just like a note.
  win.on('close', (event) => {
    if (quitting || win.__deleting) return;
    if (!win.__flushed) {
      event.preventDefault();
      if (win.__closing) return;
      win.__closing = true;
      win.webContents.send('notepad:flush');
      setTimeout(() => {
        if (win.isDestroyed()) return;
        win.__flushed = true;
        win.close();
      }, 3000);
      return;
    }
    if (notepadStore.get(pad.id)) {
      pad.hidden = true;
      pad.hiddenAt = Date.now();
      notepadStore.save();
    }
  });
  win.on('closed', () => {
    notepadWindows.delete(pad.id);
    senderNotepads.delete(wcId);
    senderRoles.delete(wcId);
    broadcastHidden();
  });

  loadView(win, { view: 'notepad', id: pad.id });
  return win;
}

function reopenNotepad(pad, { focus = true } = {}) {
  pad.hidden = false;
  pad.hiddenAt = null;
  notepadStore.save();
  openNotepadWindow(pad, { focus });
  broadcastHidden();
}

function notepadLabel(pad) {
  return pad.title.trim() || 'Untitled notepad';
}

/** Hidden notes and hidden notepads together, newest first, for the manager. */
function hiddenItems() {
  const pads = notepadStore.pads
    .filter((p) => p.hidden)
    .map((p) => ({
      id: p.id,
      kind: 'notepad',
      label: notepadLabel(p),
      untitled: !p.title.trim(),
      paper: p.paper,
      preview: [],
      hiddenAt: p.hiddenAt,
    }));
  return [...hiddenSummary(), ...pads].sort((a, b) => (b.hiddenAt ?? 0) - (a.hiddenAt ?? 0));
}

const hiddenCount = () => store.data.notes.filter((n) => n.hidden).length + notepadStore.pads.filter((p) => p.hidden).length;

function hiddenNotepadsByIds(ids) {
  if (!Array.isArray(ids)) return [];
  const wanted = new Set(ids.filter((id) => typeof id === 'string'));
  return notepadStore.pads.filter((p) => p.hidden && wanted.has(p.id));
}

/**
 * Delete hidden notes and notepads together, after one confirmation. Returns
 * how many were deleted (0 if the user cancelled). Notes alone go through
 * deleteNotes() exactly as before.
 */
async function deleteHiddenItems(notes, pads, parentWin, { all = false } = {}) {
  if (!pads.length) return deleteNotes(notes, parentWin, { all });
  notes = notes.filter((n) => store.getNote(n.id));
  pads = pads.filter((p) => notepadStore.get(p.id));
  const total = notes.length + pads.length;
  if (!total) return 0;
  const one = total === 1;
  const what = one ? `“${notepadLabel(pads[0])}”` : all ? `all ${total} hidden items` : `${total} items`;
  const tasks = notes.reduce((sum, n) => sum + n.tasks.length, 0);
  const drawings = one ? 'Its drawing' : `${pads.length === 1 ? 'A notepad drawing' : `${pads.length} notepad drawings`}`;
  const lost = tasks ? `${drawings} and ${tasks} task${tasks === 1 ? '' : 's'}` : drawings;
  const opts = {
    type: 'warning',
    buttons: [one ? 'Delete notepad' : `Delete ${total} items`, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: one ? 'Delete notepad' : 'Delete items',
    message: `Delete ${what}?`,
    detail: `${lost} will be removed. This can't be undone.`,
  };
  let confirmed;
  if (testHooks.confirm) {
    confirmed = testHooks.confirm(opts);
  } else {
    const target = parentWin && !parentWin.isDestroyed() ? parentWin : undefined;
    const { response } = target ? await dialog.showMessageBox(target, opts) : await dialog.showMessageBox(opts);
    confirmed = response === 0;
  }
  if (!confirmed) return 0;

  for (const note of notes) {
    store.deleteNote(note.id);
    const win = noteWindows.get(note.id);
    if (win && !win.isDestroyed()) {
      win.__deleting = true;
      win.close();
    }
  }
  for (const pad of pads) {
    const win = notepadWindows.get(pad.id);
    if (win && !win.isDestroyed()) {
      win.__deleting = true;
      win.close();
    }
    notepadStore.remove(pad.id).catch((err) => logError('notepad', err));
  }
  broadcastHidden();
  return total;
}

function notepadFileName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `Notepad ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}.png`;
}

// ---------------------------------------------------------------- settings ---

/** Everything the Settings window shows. Startup is read live from Windows. */
function settingsSnapshot() {
  const st = store.data.settings;
  const notes = store.data.notes;
  return {
    alwaysOnTop: st.alwaysOnTop,
    reminders: st.reminders,
    ticker: st.ticker,
    scale: st.scale,
    animations: st.animations,
    startCollapsed: st.startCollapsed,
    newNoteColor: st.newNoteColor,
    notifySound: st.notifySound,
    newNoteMode: st.newNoteMode,
    reminderHour: st.reminderHour,
    pomodoroAutoFocus: st.pomodoroAutoFocus,
    pomodoroNotify: st.pomodoroNotify,
    focusMin: st.pomodoroLengths.focusMin,
    breakMin: st.pomodoroLengths.breakMin,
    openAtLogin: startup.isSupported() ? startup.willStartAtLogin() : st.openAtLogin,
    startupSupported: startup.isSupported(),
    opacity: notes.length && notes.every((n) => n.opacity === notes[0].opacity) ? notes[0].opacity : null,
    scales: S.SCALES,
    colors: S.COLORS,
    limits: S.POMODORO_LIMITS,
  };
}

/** Tell every open window, so the Settings window and the menu never disagree. */
function broadcastSettings() {
  if (quitting || !store) return;
  const snap = settingsSnapshot();
  for (const win of allWindows()) win.webContents.send('settings:changed', snap);
}

function setAlwaysOnTop(flag) {
  store.data.settings.alwaysOnTop = flag;
  store.save();
  for (const win of allWindows()) applyAlwaysOnTop(win);
  broadcastSettings();
}

function setOpenAtLogin(flag) {
  store.data.settings.openAtLogin = startup.isSupported() ? startup.setStartAtLogin(flag) : flag;
  store.save();
  broadcastSettings();
}

function setScale(value) {
  const next = S.cleanScale(value);
  if (next === null || next === uiScale) return;
  uiScale = next;
  store.data.settings.scale = next;
  popoverShift.clear();
  for (const [id, win] of noteWindows) {
    const note = store.getNote(id);
    if (!note || win.isDestroyed()) continue;
    const cur = win.getBounds();
    win.setBounds(windowBoundsFor({ ...note, bounds: { ...note.bounds, x: cur.x, y: cur.y } }));
  }
  const fixedSize = [
    [launcherWin, LAUNCHER_SIZE],
    [managerWin, MANAGER_SIZE],
    [timerWin, TIMER_SIZE],
    [aboutWin, ABOUT_SIZE],
    [settingsWin, SETTINGS_SIZE],
  ];
  for (const [win, size] of fixedSize) {
    if (win && !win.isDestroyed()) win.setBounds(clampToWorkArea({ ...win.getBounds(), ...scaled(size) }));
  }
  for (const win of allWindows()) win.webContents.setZoomFactor(uiScale);
  reclampAll(); // also saves
  broadcastSettings();
}

function setPomodoroLengths({ focusMin, breakMin } = {}) {
  const cur = store.data.settings.pomodoroLengths;
  const next = {
    focusMin: S.cleanMinutes('focusMin', focusMin) ?? cur.focusMin,
    breakMin: S.cleanMinutes('breakMin', breakMin) ?? cur.breakMin,
  };
  store.data.settings.pomodoroLengths = next;
  store.save();
  pomodoro.setDurations({ focusMs: next.focusMin * 60_000, breakMs: next.breakMin * 60_000 }); // also updates the Pomodoro window
  broadcastSettings();
}

const isBool = (v) => typeof v === 'boolean';

/** One entry per option the Settings window can change; each validates its own value. */
const SETTING_SETTERS = {
  alwaysOnTop: (v) => isBool(v) && setAlwaysOnTop(v),
  openAtLogin: (v) => isBool(v) && startup.isSupported() && setOpenAtLogin(v),
  reminders: (v) => isBool(v) && setReminders(v),
  ticker: (v) => isBool(v) && setTicker(v),
  opacity: (v) => setAllOpacity(v),
  scale: setScale,
  newNoteColor: (v) => {
    const color = S.cleanNewNoteColor(v);
    if (color === null) return;
    store.data.settings.newNoteColor = color;
    store.save();
    broadcastSettings();
  },
  newNoteMode: (v) => {
    const mode = S.cleanNewNoteMode(v);
    if (mode === null) return;
    store.data.settings.newNoteMode = mode;
    store.save();
    broadcastSettings();
  },
  reminderHour: (v) => {
    const hour = S.cleanHour(v);
    if (hour === null) return;
    store.data.settings.reminderHour = hour;
    store.save();
    broadcastSettings();
  },
  ...Object.fromEntries(
    ['animations', 'startCollapsed', 'notifySound', 'pomodoroAutoFocus', 'pomodoroNotify'].map((key) => [
      key,
      (v) => {
        if (!isBool(v)) return;
        store.data.settings[key] = v;
        pomodoro.autoFocus = store.data.settings.pomodoroAutoFocus;
        store.save();
        broadcastSettings();
      },
    ]),
  ),
};

async function resetSettings(parentWin) {
  const opts = {
    type: 'question',
    buttons: ['Restore defaults', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'Restore default settings',
    message: 'Restore the default settings?',
    detail: 'Your notes, tasks and window positions are not changed.',
  };
  let confirmed;
  if (testHooks.confirm) {
    confirmed = testHooks.confirm(opts);
  } else {
    const target = parentWin && !parentWin.isDestroyed() ? parentWin : undefined;
    const { response } = target ? await dialog.showMessageBox(target, opts) : await dialog.showMessageBox(opts);
    confirmed = response === 0;
  }
  if (!confirmed) return;
  const d = S.defaultSettings();
  setScale(d.scale);
  setAlwaysOnTop(d.alwaysOnTop);
  setTicker(d.ticker);
  setReminders(d.reminders);
  setAllOpacity(1);
  setPomodoroLengths(d.pomodoroLengths);
  Object.assign(store.data.settings, {
    animations: d.animations,
    startCollapsed: d.startCollapsed,
    newNoteColor: d.newNoteColor,
    notifySound: d.notifySound,
    newNoteMode: d.newNoteMode,
    reminderHour: d.reminderHour,
    pomodoroAutoFocus: d.pomodoroAutoFocus,
    pomodoroNotify: d.pomodoroNotify,
  });
  pomodoro.autoFocus = d.pomodoroAutoFocus;
  store.save();
  broadcastSettings();
}

// -------------------------------------------------------------- reminders ---

const liveNotifications = new Set(); // keep references so toasts aren't garbage-collected
const reminderLog = []; // what was announced this session (also used by the smoke test)

function notify(title, body, onClick) {
  reminderLog.push({ title, body, at: Date.now() });
  if (reminderLog.length > 50) reminderLog.shift();
  if (!Notification.isSupported()) return;
  const toast = new Notification({ title, body, icon: ICON, silent: !store.data.settings.notifySound });
  liveNotifications.add(toast);
  const release = () => liveNotifications.delete(toast);
  toast.on('click', () => {
    release();
    if (onClick) onClick();
  });
  toast.on('close', release);
  toast.on('failed', release);
  setTimeout(release, 10 * 60_000);
  toast.show();
}

function revealNote(note) {
  if (!store.getNote(note.id)) return;
  if (note.hidden) return reopenNote(note);
  const win = noteWindows.get(note.id);
  if (win && !win.isDestroyed()) {
    win.show();
    win.moveTop();
    win.focus();
  } else {
    createNoteWindow(note, { focus: true });
  }
}

/** Runs every 30 s: announce each deadline once, when it arrives. */
function checkReminders(now = Date.now()) {
  if (!store.data.settings.reminders) return;
  const due = dueReminders(store.data.notes, now, store.data.settings.reminderHour);
  if (!due.length) return;
  for (const { task } of due) task.reminded = true;
  store.save();

  if (due.length > 3) {
    // e.g. the PC was off for a few days: one summary instead of a pile of toasts
    const names = due.slice(0, 3).map((d) => d.task.text);
    notify(`${due.length} tasks need attention`, `${names.join('\n')}\nand ${due.length - 3} more`, showAllNotes);
    return;
  }
  for (const { note, task, late } of due) {
    notify(late ? 'Task overdue' : 'Task due now', `${task.text}\n${noteLabel(note)}`, () => revealNote(note));
  }
}

function setTicker(flag) {
  store.data.settings.ticker = flag;
  store.save();
  for (const note of store.data.notes) if (!note.hidden) pushNote(note);
  broadcastSettings();
}

function setReminders(flag) {
  store.data.settings.reminders = flag;
  store.save();
  if (flag) checkReminders();
  broadcastSettings();
}

// The three-dot menu (also the tray's right-click menu). Everything else lives
// in Settings or behind the launcher's own buttons.
function buildAppMenu() {
  return Menu.buildFromTemplate([
    { label: 'Collapse all', click: () => setAllCollapsed(true) },
    { label: 'Expand all', click: () => setAllCollapsed(false) },
    { type: 'separator' },
    // New notepads are made from the launcher only (hover over the pad, then "Notepad").
    { label: 'Settings…', click: openSettings },
    { label: 'Open data folder', click: () => shell.showItemInFolder(store.filePath) },
    { label: 'About Scratch', click: openAbout },
    { type: 'separator' },
    { label: 'Quit Scratch', click: () => app.quit() },
  ]);
}

function buildNoteMenu(note, win) {
  return Menu.buildFromTemplate([
    {
      label: 'Daily list',
      type: 'radio',
      checked: note.mode === 'daily',
      click: () => {
        note.mode = 'daily';
        store.save();
        pushNote(note);
      },
    },
    {
      label: 'Monthly goals',
      type: 'radio',
      checked: note.mode === 'monthly',
      click: () => {
        note.mode = 'monthly';
        store.save();
        pushNote(note);
      },
    },
    { type: 'separator' },
    {
      label: note.collapsed ? 'Expand' : 'Collapse',
      click: () => {
        setCollapsed(note, !note.collapsed);
        pushNote(note);
      },
    },
    {
      label: 'Clear completed history',
      enabled: note.tasks.some((t) => t.done),
      click: () => {
        note.tasks = note.tasks.filter((t) => !t.done);
        store.save();
        pushNote(note);
      },
    },
    { type: 'separator' },
    { label: 'Hide note', click: () => win.close() },
    { label: 'Delete note…', click: () => deleteNote(note, win) },
  ]);
}

function createTray() {
  const image = nativeImage.createFromPath(ICON);
  tray = new Tray(image.isEmpty() ? image : image.resize({ width: 16, height: 16 }));
  tray.setToolTip('Scratch');
  tray.on('click', showAllNotes);
  tray.on('right-click', () => tray.popUpContextMenu(buildAppMenu()));
}

// -------------------------------------------------------------------- IPC ---

function noteFor(event) {
  const id = senderNotes.get(event.sender.id);
  return id ? store.getNote(id) : null;
}

function registerIpc() {
  ipcMain.handle('note:get', (event) => {
    const note = noteFor(event);
    return note ? toRenderer(note) : null;
  });

  ipcMain.on('note:update', (event, patch) => {
    const note = noteFor(event);
    if (!note) return;
    const clean = S.sanitizeNotePatch(patch);
    if (!Object.keys(clean).length) return;
    if (clean.tasks) carryReminded(note.tasks, clean.tasks);
    Object.assign(note, clean, { updatedAt: Date.now() });
    if ('opacity' in clean) applyOpacity(note);
    store.save();
  });

  ipcMain.on('note:popover-height', (event, height) => {
    const note = noteFor(event);
    if (!note) return;
    if (height === null || Number.isFinite(height)) setPopoverHeight(note, height);
  });

  ipcMain.handle('note:set-collapsed', (event, collapsed) => {
    const note = noteFor(event);
    if (!note || typeof collapsed !== 'boolean') return false;
    setCollapsed(note, collapsed);
    return true;
  });

  ipcMain.on('note:resize', (event, size) => {
    const note = noteFor(event);
    const win = note && noteWindows.get(note.id);
    if (!win || win.isDestroyed() || note.collapsed) return;
    if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return;
    const cur = win.getBounds();
    const wa = screen.getDisplayMatching(cur).workArea;
    const width = Math.round(clamp(size.width, sc(NOTE_MIN.width), wa.x + wa.width - cur.x));
    const height = Math.round(clamp(size.height, sc(NOTE_MIN.height), wa.y + wa.height - cur.y));
    if (width === cur.width && height === cur.height) return;
    win.setBounds({ x: cur.x, y: cur.y, width, height });
    note.bounds = baseBounds({ x: cur.x, y: cur.y, width, height });
    store.save();
  });

  ipcMain.on('note:hide', (event) => {
    const note = noteFor(event);
    const win = note && noteWindows.get(note.id);
    if (win && !win.isDestroyed()) win.close(); // 'close' handler marks it hidden
  });

  ipcMain.on('note:context-menu', (event) => {
    const note = noteFor(event);
    const win = note && noteWindows.get(note.id);
    if (win && !win.isDestroyed()) buildNoteMenu(note, win).popup({ window: win });
  });

  ipcMain.on('app:new-note', (_event, opts) => {
    const mode = opts && S.MODES.includes(opts.mode) ? opts.mode : store.data.settings.newNoteMode;
    newNote({ mode });
  });

  ipcMain.on('app:open-manager', () => openManager());
  ipcMain.on('app:open-timer', () => openTimer());
  ipcMain.on('app:open-settings', () => openSettings());

  // ---- About window
  ipcMain.handle('about:get', () =>
    about.aboutInfo({ name: app.getName(), version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome }),
  );
  ipcMain.on('about:open-repository', (event) => {
    if (senderRoles.get(event.sender.id) !== 'about') return;
    if (about.isAllowedLink(about.REPOSITORY_URL)) shell.openExternal(about.REPOSITORY_URL);
  });
  ipcMain.handle('app:hidden-count', () => hiddenCount());

  // Manager and timer windows may close themselves; nothing else may.
  ipcMain.on('window:close', (event) => {
    const role = senderRoles.get(event.sender.id);
    if (role !== 'manager' && role !== 'timer' && role !== 'about' && role !== 'settings') return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
  });

  // ---- hidden-notes manager (only that window may use these)
  const fromManager = (event) => senderRoles.get(event.sender.id) === 'manager';

  ipcMain.handle('hidden:list', (event) => (fromManager(event) ? hiddenItems() : []));

  ipcMain.handle('hidden:restore', (event, ids) => {
    if (!fromManager(event)) return 0;
    const notes = hiddenNotesByIds(ids);
    for (const note of notes) reopenNote(note, { focus: false });
    const pads = hiddenNotepadsByIds(ids);
    for (const pad of pads) reopenNotepad(pad, { focus: false });
    return notes.length + pads.length;
  });

  ipcMain.handle('hidden:delete', (event, ids) => {
    if (!fromManager(event)) return 0;
    const notes = hiddenNotesByIds(ids);
    const pads = hiddenNotepadsByIds(ids);
    const chosen = notes.length + pads.length;
    const all = chosen > 1 && chosen === hiddenCount();
    return deleteHiddenItems(notes, pads, managerWin, { all });
  });

  // ---- Settings window (only that window may change things)
  ipcMain.handle('settings:get', () => settingsSnapshot());
  ipcMain.on('settings:set', (event, key, value) => {
    if (senderRoles.get(event.sender.id) !== 'settings') return;
    if (Object.hasOwn(SETTING_SETTERS, key)) SETTING_SETTERS[key](value);
  });
  ipcMain.on('settings:action', (event, name) => {
    if (senderRoles.get(event.sender.id) !== 'settings') return;
    if (name === 'show-all') showAllNotes();
    else if (name === 'open-data') shell.showItemInFolder(store.filePath);
    else if (name === 'reset') resetSettings(settingsWin);
  });

  // ---- Pomodoro
  ipcMain.handle('timer:get', () => timerSnapshot());
  ipcMain.on('timer:set-lengths', (event, lengths) => {
    const role = senderRoles.get(event.sender.id);
    if ((role === 'timer' || role === 'settings') && lengths && typeof lengths === 'object') setPomodoroLengths(lengths);
  });
  ipcMain.on('timer:command', (event, command) => {
    if (senderRoles.get(event.sender.id) !== 'timer') return;
    if (command === 'start') pomodoro.start();
    else if (command === 'pause') pomodoro.pause();
    else if (command === 'reset') pomodoro.reset();
    else if (command === 'skip') pomodoro.skip();
  });

  ipcMain.on('app:menu', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    buildAppMenu().popup(win ? { window: win } : undefined);
  });

  // ---- Notepads (each window may only use its own notepad)
  ipcMain.on('app:new-notepad', () => newNotepad());
  ipcMain.on('app:open-notepad', () => newNotepad()); // older name for the same thing
  const notepadFor = (event) => {
    const id = senderNotepads.get(event.sender.id);
    const pad = id ? notepadStore.get(id) : null;
    const win = pad && notepadWindows.get(pad.id);
    return pad && win && !win.isDestroyed() ? { pad, win } : null;
  };

  ipcMain.handle('notepad:load', (event) => {
    const own = notepadFor(event);
    if (!own) return null;
    const { id, title, paper, width, height } = own.pad;
    return { id, title, paper, width, height, image: notepadStore.readImage(id) };
  });

  ipcMain.handle('notepad:save', async (event, drawing) => {
    const own = notepadFor(event);
    if (!own || !drawing || typeof drawing !== 'object') return false;
    try {
      return await notepadStore.saveDrawing(own.pad.id, drawing);
    } catch (err) {
      logError('notepad', err);
      return false;
    }
  });

  ipcMain.on('notepad:rename', (event, title) => {
    const own = notepadFor(event);
    if (!own || !notepadStore.rename(own.pad.id, title)) return;
    own.win.setTitle(own.pad.title.trim() || 'Notepad');
  });

  ipcMain.handle('notepad:export', async (event, data) => {
    const own = notepadFor(event);
    if (!own) return 'failed';
    const png = cleanPng(data);
    if (!png) return 'failed';
    const name = own.pad.title.replace(/[\\/:*?"<>|]+/g, ' ').trim();
    const { canceled, filePath } = await dialog.showSaveDialog(own.win, {
      title: 'Save drawing as picture',
      defaultPath: path.join(app.getPath('pictures'), name ? `${name}.png` : notepadFileName()),
      filters: [{ name: 'PNG picture', extensions: ['png'] }],
    });
    if (canceled || !filePath) return 'cancelled';
    try {
      await fs.promises.writeFile(filePath, png);
      return 'saved';
    } catch (err) {
      logError('notepad', err);
      return 'failed';
    }
  });

  ipcMain.on('notepad:copy', (event, data) => {
    if (!notepadFor(event)) return;
    const png = cleanPng(data);
    if (!png) return;
    clipboard
      .write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })])
      .catch((err) => logError('notepad', err));
  });

  ipcMain.handle('notepad:set-fullscreen', (event, flag) => {
    const own = notepadFor(event);
    if (!own || typeof flag !== 'boolean') return false;
    own.win.setFullScreen(flag);
    return flag;
  });

  ipcMain.on('notepad:minimize', (event) => {
    notepadFor(event)?.win.minimize();
  });

  ipcMain.on('notepad:toggle-maximize', (event) => {
    const own = notepadFor(event);
    if (!own || own.win.isFullScreen()) return;
    if (own.win.isMaximized()) own.win.unmaximize();
    else own.win.maximize();
  });

  // The page has saved its drawing: now really close (which hides the notepad).
  ipcMain.on('notepad:close', (event) => {
    const own = notepadFor(event);
    if (!own) return;
    own.win.__flushed = true;
    own.win.close();
  });
}

// -------------------------------------------------------------- lifecycle ---

function firstRunNote() {
  const now = Date.now();
  const task = (text, i) => ({ id: `welcome-${i}`, text, done: false, createdAt: now + i });
  newNote({
    mode: 'daily',
    title: 'Start here',
    tasks: [
      'Type in the box above and press Enter to add a task',
      'Click the circle to check a task off',
      'Drag this note by its top strip',
      'Right-click the top strip for more options',
      'Click the note pad in the corner for a new note',
    ].map(task),
  });
}

function boot() {
  app.setAppUserModelId(APP_ID);
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  // Before 1.4.0 the app was called "Sticky Notes" and kept its data under
  // that name; bring those notes along (copy, never overwrite).
  if (!process.env.STICKY_DATA_DIR) {
    migrateLegacyData({ fromDir: path.join(app.getPath('appData'), 'Sticky Notes'), toDir: app.getPath('userData') });
  }
  store = new Store(path.join(app.getPath('userData'), 'sticky-notes.json'), { onSaveError });
  store.load();
  notepadStore = new NotepadStore(app.getPath('userData'), { onError: (err) => logError('notepad', err) });
  notepadStore.load();
  uiScale = store.data.settings.scale;
  pomodoro.autoFocus = store.data.settings.pomodoroAutoFocus;
  if (!process.env.STICKY_FOCUS_MS && !process.env.STICKY_BREAK_MS) {
    const { focusMin, breakMin } = store.data.settings.pomodoroLengths;
    pomodoro.setDurations({ focusMs: focusMin * 60_000, breakMs: breakMin * 60_000 });
  }
  if (store.data.settings.startCollapsed) {
    for (const note of store.data.notes) note.collapsed = true;
    store.save();
  }

  if (startup.isSupported()) {
    // Windows is the source of truth: the installer may have turned this on,
    // or the user may have turned it off in Task Manager.
    store.data.settings.openAtLogin = startup.willStartAtLogin();
  }

  registerIpc();
  createLauncher();
  for (const note of store.data.notes) {
    if (!note.hidden) createNoteWindow(note);
  }
  for (const pad of notepadStore.pads) {
    if (!pad.hidden) openNotepadWindow(pad, { focus: false });
  }
  if (store.isFirstRun && store.data.notes.length === 0) firstRunNote();
  createTray();
  reportRecovery();

  // The smoke test calls checkReminders() itself; a background timer firing
  // mid-assertion made two of its checks intermittent (traced to this timer).
  if (!IS_SMOKE) {
    setTimeout(checkReminders, 4000); // let the notes appear before any toast
    setInterval(checkReminders, REMINDER_CHECK_MS);
  }

  screen.on('display-removed', reclampAll);
  screen.on('display-metrics-changed', reclampAll);

  if (IS_SMOKE) {
    require('./smoke').run({
      app, store, noteWindows, launcherWin, newNote, setAlwaysOnTop, checkReminders, reminderLog,
      testHooks, pomodoro, setAllOpacity,
      windows: () => ({ managerWin, timerWin, aboutWin, settingsWin }),
      openAbout, openSettings, setScale, setPomodoroLengths,
    });
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showAllNotes());
  app.whenReady().then(boot).catch(fatalStart);
  // GPU and utility processes: Chromium restarts them itself; keep a record.
  app.on('child-process-gone', (_event, d) => {
    if (d.reason !== 'clean-exit' && !quitting) logError('process', `${d.type} process gone: ${d.reason} (exit code ${d.exitCode})`);
  });

  app.on('before-quit', markQuitting);
  app.on('will-quit', () => store && store.flush());
  app.on('will-quit', () => notepadStore && notepadStore.saveIndexSync());
  // Notes can all be hidden while the launcher and tray keep the app alive;
  // only an explicit quit should exit.
  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });
}
