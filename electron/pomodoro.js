'use strict';
// Pomodoro: a focus session (25 minutes by default), then a break (5 by default). Pure state machine
// with an injectable clock, so it can be unit tested without waiting. It runs
// in the main process: the countdown keeps going and the "time's up" toast
// still fires even if the timer window is closed.

const MINUTE = 60_000;
const DEFAULTS = Object.freeze({ focusMs: 25 * MINUTE, breakMs: 5 * MINUTE });

class Pomodoro {
  constructor({
    focusMs = DEFAULTS.focusMs,
    breakMs = DEFAULTS.breakMs,
    onChange = () => {},
    onFinish = () => {},
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    this.durations = { focus: focusMs, break: breakMs };
    this.onChange = onChange;
    this.onFinish = onFinish;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.autoFocus = false; // start the next focus session when a break ends
    this.phase = 'focus'; // 'focus' | 'break'
    this.status = 'idle'; // 'idle' | 'running' | 'paused'
    this.remainingMs = focusMs;
    this.totalMs = focusMs; // length of the session in progress (a custom length applies from the next one)
    this.endsAt = null;
    this._timer = null;
  }

  snapshot() {
    const remainingMs =
      this.status === 'running' ? Math.max(0, this.endsAt - this.now()) : this.remainingMs;
    return {
      phase: this.phase,
      status: this.status,
      remainingMs,
      endsAt: this.status === 'running' ? this.endsAt : null,
      durationMs: this.totalMs,
    };
  }

  /**
   * Custom lengths. An idle timer picks them up straight away; a session that
   * is running or paused finishes at the length it started with.
   */
  setDurations({ focusMs = this.durations.focus, breakMs = this.durations.break } = {}) {
    this.durations = { focus: focusMs, break: breakMs };
    if (this.status === 'idle') {
      this.remainingMs = this.durations[this.phase];
      this.totalMs = this.remainingMs;
    }
    this.onChange();
  }

  start() {
    if (this.status === 'running') return;
    this.status = 'running';
    this.endsAt = this.now() + this.remainingMs;
    this._arm();
    this.onChange();
  }

  pause() {
    if (this.status !== 'running') return;
    this.remainingMs = Math.max(0, this.endsAt - this.now());
    this._disarm();
    this.endsAt = null;
    this.status = 'paused';
    this.onChange();
  }

  /** Back to a fresh focus session. */
  reset() {
    this._enter('focus');
    this.onChange();
  }

  /** Jump to the other phase without counting the current one as finished. */
  skip() {
    this._enter(this.phase === 'focus' ? 'break' : 'focus');
    this.onChange();
  }

  _enter(phase) {
    this._disarm();
    this.endsAt = null;
    this.phase = phase;
    this.status = 'idle';
    this.remainingMs = this.durations[phase];
    this.totalMs = this.remainingMs;
  }

  _arm() {
    this._disarm();
    this._timer = this.setTimer(() => this._finish(), Math.max(0, this.endsAt - this.now()));
  }

  _disarm() {
    if (this._timer !== null) this.clearTimer(this._timer);
    this._timer = null;
  }

  _finish() {
    // Timers can fire early after the PC sleeps and wakes; only finish when
    // the wall clock agrees, otherwise wait out the remainder.
    if (this.status !== 'running') return;
    if (this.now() < this.endsAt) {
      const endsAt = this.endsAt;
      this._timer = this.setTimer(() => this._finish(), endsAt - this.now());
      return;
    }
    const finished = this.phase;
    if (finished === 'focus') {
      this._enter('break');
      this.status = 'running'; // the break starts on its own
      this.endsAt = this.now() + this.remainingMs;
      this._arm();
    } else {
      this._enter('focus'); // wait for the user to start the next session, unless autoFocus is on
      if (this.autoFocus) {
        this.status = 'running';
        this.endsAt = this.now() + this.remainingMs;
        this._arm();
      }
    }
    this.onFinish(finished);
    this.onChange();
  }
}

module.exports = { Pomodoro, DEFAULTS };
