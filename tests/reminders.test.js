'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../electron/schema');
const { reminderTime, dueReminders, carryReminded } = require('../electron/reminders');

const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();
const note = (tasks) => ({ id: 'n', tasks });
const task = (over) => ({ id: 't', text: 'x', done: false, deadline: null, reminded: false, ...over });

test('isValidDeadline accepts a day or a day with time, nothing else', () => {
  assert.equal(S.isValidDeadline('2026-11-20'), true);
  assert.equal(S.isValidDeadline('2026-11-20T17:30'), true);
  assert.equal(S.isValidDeadline('2026-11-20T24:00'), false);
  assert.equal(S.isValidDeadline('2026-11-31T10:00'), false);
  assert.equal(S.isValidDeadline('2026-11-20 17:30'), false);
  assert.equal(S.isValidDeadline('2026-11-20T17:30:00'), false);
  assert.equal(S.isValidDeadline(20261120), false);
});

test('timed deadlines survive sanitizing; reminded is only trusted from disk', () => {
  const raw = { id: 'a', text: 'Pay rent', deadline: '2026-12-01T09:00', reminded: true };
  assert.equal(S.sanitizeTask(raw).deadline, '2026-12-01T09:00');
  assert.equal(S.sanitizeTask(raw).reminded, false, 'from a note window');
  assert.equal(S.sanitizeTask(raw, true).reminded, true, 'from our own file');
  assert.equal(S.sanitizeNotePatch({ tasks: [raw] }).tasks[0].reminded, false);
  assert.equal(S.normalizeData({ notes: [{ id: 'n', tasks: [raw] }] }).notes[0].tasks[0].reminded, true);
});

test('reminderTime: timed at that minute, day-only at 09:00 local', () => {
  assert.equal(reminderTime('2026-11-20T17:30'), at(2026, 11, 20, 17, 30));
  assert.equal(reminderTime('2026-11-20'), at(2026, 11, 20, 9, 0));
});

test('dueReminders fires at the deadline, not before, and flags late ones', () => {
  const n = note([task({ deadline: '2026-11-20T17:30' })]);
  assert.equal(dueReminders([n], at(2026, 11, 20, 17, 29)).length, 0);
  const onTime = dueReminders([n], at(2026, 11, 20, 17, 30));
  assert.equal(onTime.length, 1);
  assert.equal(onTime[0].late, false);
  assert.equal(dueReminders([n], at(2026, 11, 20, 17, 40))[0].late, true);
});

test('dueReminders skips done, already reminded and deadline-free tasks', () => {
  const n = note([
    task({ id: 'a', deadline: '2026-11-01', done: true }),
    task({ id: 'b', deadline: '2026-11-01', reminded: true }),
    task({ id: 'c' }),
    task({ id: 'd', deadline: '2026-11-01' }),
  ]);
  assert.deepEqual(dueReminders([n], at(2026, 11, 12, 12)).map((r) => r.task.id), ['d']);
});

test('carryReminded keeps the flag only while the deadline is unchanged', () => {
  const prev = [task({ id: 'a', deadline: '2026-11-20', reminded: true }), task({ id: 'b', deadline: '2026-11-20', reminded: true })];
  const next = carryReminded(prev, [
    task({ id: 'a', deadline: '2026-11-20', text: 'renamed' }),
    task({ id: 'b', deadline: '2026-11-21' }),
    task({ id: 'new', deadline: '2026-11-20', reminded: true }),
  ]);
  assert.deepEqual(next.map((t) => t.reminded), [true, false, false]);
});

test('countdown labels', async () => {
  const { deadlineInfo } = await import('../src/lib/dates.js');
  const now = at(2026, 11, 12, 10, 0);
  const label = (deadline, done = false) => {
    const { status, text } = deadlineInfo(deadline, now, done);
    return `${status}: ${text}`;
  };
  assert.equal(label('2026-11-12T10:25'), 'today: in 25 min');
  assert.equal(label('2026-11-12T13:20'), 'today: in 3h 20m');
  assert.equal(label('2026-11-13T12:00'), 'soon: in 1d 2h');
  assert.equal(label('2026-11-20T10:00'), 'later: in 8 days');
  assert.equal(label('2026-11-12T10:00'), 'overdue: Due now');
  assert.equal(label('2026-11-12T09:48'), 'overdue: 12 min overdue');
  assert.equal(label('2026-11-10T08:00'), 'overdue: 2d 2h overdue');
  assert.equal(label('2026-11-12'), 'today: Due today');
  assert.equal(label('2026-11-13'), 'soon: Tomorrow');
  assert.equal(label('2026-11-17'), 'later: in 5 days');
  assert.equal(label('2026-11-11'), 'overdue: 1 day overdue');
  assert.equal(label('2026-11-09'), 'overdue: 3 days overdue');
  assert.equal(deadlineInfo('2026-11-09', now, true).status, 'done');
});

test('a deadline with only a date reminds at the chosen hour', () => {
  const { reminderTime } = require('../electron/reminders');
  assert.equal(new Date(reminderTime('2026-11-20')).getHours(), 9);
  assert.equal(new Date(reminderTime('2026-11-20', 7)).getHours(), 7);
  assert.equal(new Date(reminderTime('2026-11-20T17:30', 7)).getHours(), 17, 'a set time is never moved');
});
