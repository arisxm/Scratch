'use strict';
// Data shape + validation for everything that crosses the IPC boundary or is
// read back from disk. The renderer is treated as untrusted input: every patch
// it sends is passed through sanitizeNotePatch() before touching the store.

const { randomUUID } = require('node:crypto');

const SCHEMA_VERSION = 1;
// The first six are the original palette; the rest were added later. New ones go at the end so notes keep their colors.
const COLORS = ['yellow', 'pink', 'lavender', 'mint', 'sky', 'peach', 'coral', 'lime', 'aqua', 'orchid', 'sand', 'stone'];
const MODES = ['daily', 'monthly'];
const LIMITS = Object.freeze({ title: 80, taskText: 500, tasksPerNote: 500, id: 64 });
const DEFAULT_NOTE_SIZE = Object.freeze({ width: 300, height: 360 });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const pad2 = (n) => String(n).padStart(2, '0');

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function localMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function isValidDateKey(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** A deadline is a day ("2026-11-20") or a day and time ("2026-11-20T17:30"). */
function isValidDeadline(s) {
  if (typeof s !== 'string') return false;
  if (s.length === 10) return isValidDateKey(s);
  return s.length === 16 && s[10] === 'T' && isValidDateKey(s.slice(0, 10)) && TIME_RE.test(s.slice(11));
}

function isValidMonthKey(s) {
  return typeof s === 'string' && MONTH_RE.test(s);
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function cleanId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= LIMITS.id ? id : null;
}

const OPACITY = Object.freeze({ min: 0.3, max: 1, default: 1 });

/** Note transparency: 1 is solid; never below 0.3 so a note can't vanish. */
function cleanOpacity(value) {
  if (!isFiniteNumber(value)) return null;
  return Math.round(Math.min(OPACITY.max, Math.max(OPACITY.min, value)) * 100) / 100;
}

function cleanTitle(title) {
  if (typeof title !== 'string') return null;
  return title.replace(/[\r\n\t]+/g, ' ').slice(0, LIMITS.title);
}

/**
 * `trusted` is true only for data we wrote ourselves (the file on disk).
 * `reminded` records that a deadline notification was already shown; note
 * windows can't set it, the main process manages it.
 */
function sanitizeTask(raw, trusted = false) {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanId(raw.id);
  if (!id) return null;
  if (typeof raw.text !== 'string') return null;
  const text = raw.text.replace(/[\r\n]+/g, ' ').slice(0, LIMITS.taskText);
  if (!text.trim()) return null;
  const done = raw.done === true;
  return {
    id,
    text,
    done,
    createdAt: isFiniteNumber(raw.createdAt) ? raw.createdAt : Date.now(),
    completedAt: done ? (isFiniteNumber(raw.completedAt) ? raw.completedAt : Date.now()) : null,
    deadline: isValidDeadline(raw.deadline) ? raw.deadline : null,
    reminded: trusted && raw.reminded === true,
  };
}

function sanitizeTasks(list, trusted = false) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const raw of list.slice(0, LIMITS.tasksPerNote)) {
    const task = sanitizeTask(raw, trusted);
    if (task && !seen.has(task.id)) {
      seen.add(task.id);
      out.push(task);
    }
  }
  return out;
}

function sanitizeBounds(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { x, y, width, height } = raw;
  if (![x, y, width, height].every(isFiniteNumber)) return null;
  if (width <= 0 || height <= 0) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/**
 * Validate a partial update coming from a note window. Unknown keys and
 * invalid values are dropped silently; the result only contains fields that
 * are safe to merge into the stored note.
 */
function sanitizeNotePatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;

  if ('title' in patch) {
    const t = cleanTitle(patch.title);
    if (t !== null) out.title = t;
  }
  if ('color' in patch && COLORS.includes(patch.color)) out.color = patch.color;
  if ('mode' in patch && MODES.includes(patch.mode)) out.mode = patch.mode;
  if ('date' in patch && isValidDateKey(patch.date)) out.date = patch.date;
  if ('month' in patch && isValidMonthKey(patch.month)) out.month = patch.month;
  if ('tasks' in patch) {
    const tasks = sanitizeTasks(patch.tasks);
    if (tasks) out.tasks = tasks;
  }
  if ('opacity' in patch) {
    const opacity = cleanOpacity(patch.opacity);
    if (opacity !== null) out.opacity = opacity;
  }
  if ('historyOpen' in patch && typeof patch.historyOpen === 'boolean') out.historyOpen = patch.historyOpen;
  return out;
}

function createNote(opts = {}) {
  const now = Date.now();
  return {
    id: randomUUID(),
    title: cleanTitle(opts.title) ?? '',
    color: COLORS.includes(opts.color) ? opts.color : COLORS[0],
    mode: MODES.includes(opts.mode) ? opts.mode : 'daily',
    date: isValidDateKey(opts.date) ? opts.date : localDateKey(),
    month: isValidMonthKey(opts.month) ? opts.month : localMonthKey(),
    tasks: sanitizeTasks(opts.tasks, true) ?? [],
    opacity: cleanOpacity(opts.opacity) ?? OPACITY.default,
    historyOpen: opts.historyOpen === true, // is the "Completed" section expanded
    collapsed: false,
    hidden: false,
    hiddenAt: null,
    bounds: sanitizeBounds(opts.bounds) ?? { x: 100, y: 100, ...DEFAULT_NOTE_SIZE },
    createdAt: now,
    updatedAt: now,
  };
}

/** Repair a note read from disk. Returns null if it is unrecoverable. */
function normalizeNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanId(raw.id);
  if (!id) return null;
  const base = createNote(raw);
  return {
    ...base,
    id,
    collapsed: raw.collapsed === true,
    hidden: raw.hidden === true,
    hiddenAt: raw.hidden === true && isFiniteNumber(raw.hiddenAt) ? raw.hiddenAt : null,
    createdAt: isFiniteNumber(raw.createdAt) ? raw.createdAt : base.createdAt,
    updatedAt: isFiniteNumber(raw.updatedAt) ? raw.updatedAt : base.updatedAt,
  };
}

// Options added in the Settings window. Windows are scaled by one of these
// steps; the Pomodoro lengths are whole minutes.
const SCALES = Object.freeze([0.8, 0.9, 1, 1.1, 1.25, 1.5]);
const POMODORO_LIMITS = Object.freeze({ focusMin: [1, 180], breakMin: [1, 60] });
const POMODORO_DEFAULT_MIN = Object.freeze({ focusMin: 25, breakMin: 5 });

function cleanScale(v) {
  return isFiniteNumber(v) && SCALES.includes(v) ? v : null;
}

function cleanMinutes(key, v) {
  if (!isFiniteNumber(v)) return null;
  const [lo, hi] = POMODORO_LIMITS[key];
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function cleanHour(v) {
  return isFiniteNumber(v) ? Math.min(23, Math.max(0, Math.round(v))) : null;
}

function cleanNewNoteMode(v) {
  return MODES.includes(v) ? v : null;
}

function cleanNewNoteColor(v) {
  return v === 'rotate' || COLORS.includes(v) ? v : null;
}

function defaultSettings() {
  return {
    alwaysOnTop: true,
    openAtLogin: false,
    reminders: true,
    ticker: true, // rotating "next task" line in each note's header
    scale: 1, // size of every Scratch window
    animations: true,
    startCollapsed: false, // collapse all notes when Scratch starts
    newNoteColor: 'rotate', // 'rotate' cycles the pastels; or one fixed colour
    notifySound: true,
    newNoteMode: 'daily', // what the + pad creates
    reminderHour: 9, // when a deadline with a date but no time reminds
    pomodoroAutoFocus: false, // start the next focus session when a break ends
    pomodoroNotify: true, // announce finished sessions and breaks
    pomodoroLengths: { ...POMODORO_DEFAULT_MIN },
    colorCursor: 0,
    launcherBounds: null,
    timerBounds: null,
    aboutBounds: null,
    managerBounds: null,
    settingsBounds: null,
    pomodoro: { date: null, count: 0 }, // focus sessions finished on `date`
  };
}

function normalizeSettings(raw) {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  return {
    alwaysOnTop: typeof raw.alwaysOnTop === 'boolean' ? raw.alwaysOnTop : d.alwaysOnTop,
    openAtLogin: typeof raw.openAtLogin === 'boolean' ? raw.openAtLogin : d.openAtLogin,
    reminders: typeof raw.reminders === 'boolean' ? raw.reminders : d.reminders,
    ticker: typeof raw.ticker === 'boolean' ? raw.ticker : d.ticker,
    scale: cleanScale(raw.scale) ?? d.scale,
    animations: typeof raw.animations === 'boolean' ? raw.animations : d.animations,
    startCollapsed: typeof raw.startCollapsed === 'boolean' ? raw.startCollapsed : d.startCollapsed,
    newNoteColor: cleanNewNoteColor(raw.newNoteColor) ?? d.newNoteColor,
    notifySound: typeof raw.notifySound === 'boolean' ? raw.notifySound : d.notifySound,
    newNoteMode: cleanNewNoteMode(raw.newNoteMode) ?? d.newNoteMode,
    reminderHour: cleanHour(raw.reminderHour) ?? d.reminderHour,
    pomodoroAutoFocus: typeof raw.pomodoroAutoFocus === 'boolean' ? raw.pomodoroAutoFocus : d.pomodoroAutoFocus,
    pomodoroNotify: typeof raw.pomodoroNotify === 'boolean' ? raw.pomodoroNotify : d.pomodoroNotify,
    pomodoroLengths: {
      focusMin: cleanMinutes('focusMin', raw.pomodoroLengths?.focusMin) ?? d.pomodoroLengths.focusMin,
      breakMin: cleanMinutes('breakMin', raw.pomodoroLengths?.breakMin) ?? d.pomodoroLengths.breakMin,
    },
    colorCursor:
      Number.isInteger(raw.colorCursor) && raw.colorCursor >= 0
        ? raw.colorCursor % COLORS.length
        : d.colorCursor,
    launcherBounds: sanitizeBounds(raw.launcherBounds),
    timerBounds: sanitizeBounds(raw.timerBounds),
    aboutBounds: sanitizeBounds(raw.aboutBounds),
    managerBounds: sanitizeBounds(raw.managerBounds),
    settingsBounds: sanitizeBounds(raw.settingsBounds),
    pomodoro:
      raw.pomodoro && isValidDateKey(raw.pomodoro.date) && Number.isInteger(raw.pomodoro.count) && raw.pomodoro.count >= 0
        ? { date: raw.pomodoro.date, count: raw.pomodoro.count }
        : d.pomodoro,
  };
}

function emptyData() {
  return { version: SCHEMA_VERSION, settings: defaultSettings(), notes: [] };
}

function normalizeData(raw) {
  if (!raw || typeof raw !== 'object') return emptyData();
  const seen = new Set();
  const notes = [];
  for (const n of Array.isArray(raw.notes) ? raw.notes : []) {
    const note = normalizeNote(n);
    if (note && !seen.has(note.id)) {
      seen.add(note.id);
      notes.push(note);
    }
  }
  return { version: SCHEMA_VERSION, settings: normalizeSettings(raw.settings), notes };
}

module.exports = {
  SCHEMA_VERSION,
  COLORS,
  MODES,
  LIMITS,
  OPACITY,
  DEFAULT_NOTE_SIZE,
  localDateKey,
  localMonthKey,
  isValidDateKey,
  isValidMonthKey,
  isValidDeadline,
  sanitizeTask,
  sanitizeTasks,
  sanitizeBounds,
  cleanOpacity,
  SCALES,
  POMODORO_LIMITS,
  cleanScale,
  cleanMinutes,
  cleanNewNoteColor,
  cleanNewNoteMode,
  cleanHour,
  defaultSettings,
  normalizeSettings,
  sanitizeNotePatch,
  createNote,
  normalizeNote,
  normalizeData,
  emptyData,
};
