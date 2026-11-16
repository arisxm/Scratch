'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pomodoro } = require('../electron/pomodoro');

// A fake clock: timers fire only when advance() moves time past them.
function harness(opts = {}) {
  let now = 1_000_000;
  let nextId = 1;
  const timers = new Map();
  const events = [];
  const p = new Pomodoro({
    focusMs: 25 * 60_000,
    breakMs: 5 * 60_000,
    ...opts,
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    onFinish: (phase) => events.push(`finish:${phase}`),
    onChange: () => events.push('change'),
  });
  const advance = (ms) => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
    }
    now = target;
  };
  return { p, advance, events, timers, fireEarly: () => { const [id, t] = [...timers.entries()][0]; timers.delete(id); t.fn(); } };
}

test('starts idle with a full 25-minute focus session', () => {
  const { p } = harness();
  assert.deepEqual(p.snapshot(), { phase: 'focus', status: 'idle', remainingMs: 1_500_000, endsAt: null, durationMs: 1_500_000 });
});

test('counts down while running and stops at zero', () => {
  const { p, advance } = harness();
  p.start();
  advance(10 * 60_000);
  assert.equal(p.snapshot().remainingMs, 15 * 60_000);
  assert.equal(p.snapshot().status, 'running');
});

test('pause freezes the remaining time; start resumes from it', () => {
  const { p, advance } = harness();
  p.start();
  advance(60_000);
  p.pause();
  advance(10 * 60_000); // time passes while paused
  assert.equal(p.snapshot().status, 'paused');
  assert.equal(p.snapshot().remainingMs, 24 * 60_000);
  p.start();
  advance(23 * 60_000);
  assert.equal(p.snapshot().phase, 'focus');
  assert.equal(p.snapshot().remainingMs, 60_000);
});

test('focus finishing reports it and starts the 5-minute break by itself', () => {
  const { p, advance, events } = harness();
  p.start();
  advance(25 * 60_000);
  assert.ok(events.includes('finish:focus'));
  const s = p.snapshot();
  assert.equal(s.phase, 'break');
  assert.equal(s.status, 'running');
  assert.equal(s.remainingMs, 5 * 60_000);
});

test('break finishing returns to an idle focus session', () => {
  const { p, advance, events } = harness();
  p.start();
  advance(30 * 60_000);
  assert.deepEqual(events.filter((e) => e.startsWith('finish')), ['finish:focus', 'finish:break']);
  const s = p.snapshot();
  assert.equal(s.phase, 'focus');
  assert.equal(s.status, 'idle');
  assert.equal(s.remainingMs, 25 * 60_000);
});

test('reset and skip do not count as a finished session', () => {
  const { p, advance, events, timers } = harness();
  p.start();
  advance(5 * 60_000);
  p.skip();
  assert.equal(p.snapshot().phase, 'break');
  assert.equal(p.snapshot().status, 'idle');
  p.reset();
  assert.equal(p.snapshot().phase, 'focus');
  assert.equal(p.snapshot().remainingMs, 25 * 60_000);
  assert.equal(timers.size, 0, 'no timer left running');
  advance(60 * 60_000);
  assert.equal(events.filter((e) => e.startsWith('finish')).length, 0);
});

test('a timer that fires early (PC woke from sleep) does not end the session early', () => {
  const { p, advance, events, fireEarly } = harness();
  p.start();
  advance(60_000);
  fireEarly();
  assert.equal(p.snapshot().phase, 'focus');
  assert.equal(events.filter((e) => e.startsWith('finish')).length, 0);
  advance(24 * 60_000);
  assert.ok(events.includes('finish:focus'));
});

test('custom lengths apply at once when idle', () => {
  const { p } = harness();
  p.setDurations({ focusMs: 50 * 60_000, breakMs: 10 * 60_000 });
  assert.equal(p.snapshot().remainingMs, 50 * 60_000);
  assert.equal(p.snapshot().durationMs, 50 * 60_000);
  p.skip();
  assert.equal(p.snapshot().remainingMs, 10 * 60_000);
});

test('a running session keeps its length; new lengths apply from the next phase', () => {
  const { p, advance } = harness();
  p.start();
  advance(5 * 60_000);
  p.setDurations({ focusMs: 50 * 60_000, breakMs: 10 * 60_000 });
  assert.equal(p.snapshot().durationMs, 25 * 60_000);
  assert.equal(p.snapshot().remainingMs, 20 * 60_000);
  advance(20 * 60_000); // focus ends, the break starts on its own
  assert.equal(p.snapshot().phase, 'break');
  assert.equal(p.snapshot().remainingMs, 10 * 60_000);
  assert.equal(p.snapshot().durationMs, 10 * 60_000);
});

test('with autoFocus on, the next focus session starts when the break ends', () => {
  const { p, advance } = harness();
  p.autoFocus = true;
  p.start();
  advance(25 * 60_000); // focus ends, break starts
  advance(5 * 60_000); // break ends
  assert.equal(p.snapshot().phase, 'focus');
  assert.equal(p.snapshot().status, 'running');
  assert.equal(p.snapshot().remainingMs, 25 * 60_000);
});

test('without autoFocus, the timer waits after the break (the default)', () => {
  const { p, advance } = harness();
  p.start();
  advance(30 * 60_000);
  assert.equal(p.snapshot().phase, 'focus');
  assert.equal(p.snapshot().status, 'idle');
});
