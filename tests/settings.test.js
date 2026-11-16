'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../electron/schema');

test('settings from an older version keep their values and gain the new defaults', () => {
  const s = S.normalizeSettings({ alwaysOnTop: false, ticker: false, reminders: false });
  assert.equal(s.alwaysOnTop, false);
  assert.equal(s.ticker, false);
  assert.equal(s.reminders, false);
  assert.equal(s.scale, 1);
  assert.equal(s.animations, true);
  assert.equal(s.startCollapsed, false);
  assert.equal(s.newNoteColor, 'rotate');
  assert.equal(s.notifySound, true);
  assert.deepEqual(s.pomodoroLengths, { focusMin: 25, breakMin: 5 });
});

test('scale only accepts the offered steps', () => {
  for (const ok of S.SCALES) assert.equal(S.cleanScale(ok), ok);
  for (const bad of [0, 0.5, 3, '1', NaN, null]) assert.equal(S.cleanScale(bad), null);
  assert.equal(S.normalizeSettings({ scale: 7 }).scale, 1);
});

test('Pomodoro lengths are whole minutes within limits', () => {
  assert.equal(S.cleanMinutes('focusMin', 45.4), 45);
  assert.equal(S.cleanMinutes('focusMin', 0), 1);
  assert.equal(S.cleanMinutes('focusMin', 9999), 180);
  assert.equal(S.cleanMinutes('breakMin', 90), 60);
  assert.equal(S.cleanMinutes('breakMin', 'ten'), null);
  assert.deepEqual(S.normalizeSettings({ pomodoroLengths: { focusMin: 'x', breakMin: 10 } }).pomodoroLengths, { focusMin: 25, breakMin: 10 });
});

test('there are twelve note colours, the original six first', () => {
  assert.equal(S.COLORS.length, 12);
  assert.deepEqual(S.COLORS.slice(0, 6), ['yellow', 'pink', 'lavender', 'mint', 'sky', 'peach']);
  assert.equal(new Set(S.COLORS).size, 12);
  assert.deepEqual(S.sanitizeNotePatch({ color: 'coral' }), { color: 'coral' });
  assert.equal(S.cleanNewNoteColor('stone'), 'stone');
});

test('the newer options validate and default', () => {
  const d = S.defaultSettings();
  assert.equal(d.newNoteMode, 'daily');
  assert.equal(d.reminderHour, 9);
  assert.equal(d.pomodoroAutoFocus, false);
  assert.equal(d.pomodoroNotify, true);
  assert.equal(S.cleanHour(30), 23);
  assert.equal(S.cleanHour(-3), 0);
  assert.equal(S.cleanHour('9'), null);
  assert.equal(S.cleanNewNoteMode('weekly'), null);
  const s = S.normalizeSettings({ newNoteMode: 'monthly', reminderHour: 14.4, pomodoroAutoFocus: true, pomodoroNotify: 'no' });
  assert.equal(s.newNoteMode, 'monthly');
  assert.equal(s.reminderHour, 14);
  assert.equal(s.pomodoroAutoFocus, true);
  assert.equal(s.pomodoroNotify, true);
});

test('new-note colour is "rotate" or one of the pastels', () => {
  assert.equal(S.cleanNewNoteColor('rotate'), 'rotate');
  assert.equal(S.cleanNewNoteColor('mint'), 'mint');
  assert.equal(S.cleanNewNoteColor('red'), null);
  assert.equal(S.normalizeSettings({ newNoteColor: 'red' }).newNoteColor, 'rotate');
});
