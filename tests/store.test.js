'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../electron/schema');
const { Store } = require('../electron/store');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sticky-test-'));

test('sanitizeNotePatch keeps valid fields and drops everything else', () => {
  const patch = S.sanitizeNotePatch({
    title: 'Groceries\nlist',
    color: 'mint',
    mode: 'monthly',
    month: '2026-11',
    date: '2026-02-30', // not a real day
    bounds: { x: 0, y: 0, width: 1, height: 1 }, // not renderer-editable
    hidden: true, // not renderer-editable
    __proto__: { polluted: true },
  });
  assert.deepEqual(patch, { title: 'Groceries list', color: 'mint', mode: 'monthly', month: '2026-11' });
});

test('sanitizeNotePatch rejects bad enums and malformed months', () => {
  assert.deepEqual(S.sanitizeNotePatch({ color: 'red', mode: 'weekly', month: '2026-13' }), {});
  assert.deepEqual(S.sanitizeNotePatch(null), {});
  assert.deepEqual(S.sanitizeNotePatch('title'), {});
});

test('sanitizeTasks validates, trims and de-duplicates', () => {
  const now = Date.now();
  const tasks = S.sanitizeTasks([
    { id: 'a', text: 'Buy milk', done: true, createdAt: now },
    { id: 'a', text: 'duplicate id', done: false },
    { id: 'b', text: '   ', done: false },
    { id: 'c', text: 'x'.repeat(900), done: 'yes', deadline: '2026-11-31' },
    { text: 'no id' },
    'not an object',
  ]);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].done, true);
  assert.equal(typeof tasks[0].completedAt, 'number');
  assert.equal(tasks[1].done, false, 'only boolean true counts as done');
  assert.equal(tasks[1].completedAt, null);
  assert.equal(tasks[1].text.length, S.LIMITS.taskText);
  assert.equal(tasks[1].deadline, null, 'Nov 31 is not a valid deadline');
});

test('isValidDateKey checks real calendar dates', () => {
  assert.equal(S.isValidDateKey('2028-02-29'), true);
  assert.equal(S.isValidDateKey('2026-02-29'), false);
  assert.equal(S.isValidDateKey('2026-1-05'), false);
});

test('normalizeData repairs partial or hostile files', () => {
  const data = S.normalizeData({
    settings: { alwaysOnTop: 'yes', colorCursor: 13 },
    notes: [{ id: 'n1', title: 5, color: 'nope', tasks: 'x' }, { id: 'n1' }, { title: 'no id' }, null],
  });
  assert.equal(data.notes.length, 1);
  const [note] = data.notes;
  assert.equal(note.id, 'n1');
  assert.equal(note.title, '');
  assert.equal(note.color, 'yellow');
  assert.deepEqual(note.tasks, []);
  assert.equal(data.settings.alwaysOnTop, true);
  assert.equal(data.settings.colorCursor, 13 % S.COLORS.length);
});

test('store: first run, save, reload round-trip', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'nested', 'sticky-notes.json');
  const a = new Store(file, { debounceMs: 10 });
  a.load();
  assert.equal(a.isFirstRun, true);

  const note = S.createNote({ title: 'Today', color: 'sky', tasks: [{ id: 't1', text: 'Ship it' }] });
  a.addNote(note);
  for (let i = 0; i < 100 && !(fs.existsSync(file) && fs.readFileSync(file, 'utf8').length > 2); i += 1) await new Promise((r) => setTimeout(r, 20)); // let the background save finish
  assert.ok(fs.existsSync(file));
  assert.ok(!fs.existsSync(`${file}.tmp`), 'temp file is renamed away');

  const b = new Store(file);
  b.load();
  assert.equal(b.isFirstRun, false);
  assert.equal(b.getNote(note.id).tasks[0].text, 'Ship it');
});

test('store: flush() writes a pending save synchronously', () => {
  const file = path.join(tmpDir(), 'sticky-notes.json');
  const s = new Store(file, { debounceMs: 60_000 });
  s.load();
  s.addNote(S.createNote({ title: 'Quit test' }));
  assert.ok(!fs.existsSync(file), 'debounced, not yet written');
  assert.equal(s.flush(), true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).notes[0].title, 'Quit test');
});

test('store: recovers from a corrupt file using the backup', () => {
  const file = path.join(tmpDir(), 'sticky-notes.json');
  const s = new Store(file);
  s.load();
  s.addNote(S.createNote({ title: 'first' }));
  s.flush();
  s.data.notes[0].title = 'second';
  s.save();
  s.flush(); // .bak now holds "first", main file holds "second"

  fs.writeFileSync(file, '{"notes": [ truncated'); // simulate a torn write
  const r = new Store(file);
  r.load();
  assert.equal(r.loadedFrom, `${file}.bak`);
  assert.equal(r.data.notes[0].title, 'first');
  assert.equal(r.isFirstRun, false, 'a damaged file must not trigger the welcome note');
  const kept = fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.unreadable-'));
  assert.equal(kept.length, 1, 'the damaged file is kept aside, not overwritten');
  r.flush();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).notes[0].title, 'first', 'main file restored');
});

test('opacity is clamped to 30%-100% and history state must be boolean', () => {
  assert.deepEqual(S.sanitizeNotePatch({ opacity: 0.6 }), { opacity: 0.6 });
  assert.deepEqual(S.sanitizeNotePatch({ opacity: 0 }), { opacity: 0.3 }, 'never fully invisible');
  assert.deepEqual(S.sanitizeNotePatch({ opacity: 7 }), { opacity: 1 });
  assert.deepEqual(S.sanitizeNotePatch({ opacity: '0.5' }), {});
  assert.deepEqual(S.sanitizeNotePatch({ opacity: NaN }), {});
  assert.deepEqual(S.sanitizeNotePatch({ historyOpen: true }), { historyOpen: true });
  assert.deepEqual(S.sanitizeNotePatch({ historyOpen: 'yes', hiddenAt: 5 }), {});
});

test('notes saved by the previous version load with the new fields defaulted', () => {
  const v1 = { settings: { alwaysOnTop: false }, notes: [{ id: 'old', title: 'From v1', hidden: true, tasks: [{ id: 't', text: 'x', done: true, completedAt: 5 }] }] };
  const data = S.normalizeData(v1);
  const [note] = data.notes;
  assert.equal(note.opacity, 1);
  assert.equal(note.historyOpen, false);
  assert.equal(note.hidden, true);
  assert.equal(note.hiddenAt, null, 'unknown hide time is allowed');
  assert.equal(note.tasks[0].done, true);
  assert.equal(data.settings.alwaysOnTop, false);
  assert.equal(data.settings.reminders, true);
  assert.deepEqual(data.settings.pomodoro, { date: null, count: 0 });
});

test('focus-session counter in settings is validated', () => {
  const ok = S.normalizeData({ settings: { pomodoro: { date: '2026-11-12', count: 3 } } }).settings.pomodoro;
  assert.deepEqual(ok, { date: '2026-11-12', count: 3 });
  const bad = S.normalizeData({ settings: { pomodoro: { date: 'today', count: -1 } } }).settings.pomodoro;
  assert.deepEqual(bad, { date: null, count: 0 });
});

test('a data file saved with a byte-order mark still loads', () => {
  const file = path.join(tmpDir(), 'notes.json');
  fs.writeFileSync(file, '﻿' + JSON.stringify({ notes: [{ id: 'n1', title: 'Mine', tasks: [] }] }));
  const store = new Store(file);
  store.load();
  assert.equal(store.loadedFrom, file);
  assert.equal(store.data.notes[0].title, 'Mine');
  assert.equal(store.unreadableFile, null);
});

test('a damaged data file is kept aside and its new name is reported', () => {
  const file = path.join(tmpDir(), 'notes.json');
  fs.writeFileSync(file, '{"notes": [');
  const store = new Store(file);
  store.load();
  assert.equal(store.loadedFrom, null);
  assert.equal(store.isFirstRun, false);
  assert.match(store.unreadableFile, /notes\.json\.unreadable-\d+$/);
  assert.equal(fs.readFileSync(store.unreadableFile, 'utf8'), '{"notes": [');
});

test('a failed save is reported to onSaveError', () => {
  const file = path.join(tmpDir(), 'notes.json');
  const errors = [];
  const store = new Store(file, { onSaveError: (err) => errors.push(err) });
  store.load();
  fs.mkdirSync(`${file}.tmp`); // the temp file can't be created, so the write fails
  store.save();
  assert.equal(store.flush(), false);
  assert.equal(errors.length, 1);
});
