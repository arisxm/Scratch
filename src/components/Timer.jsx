import { useEffect, useState } from 'react';
import { IconClose, IconPause, IconPlay, IconRestore, IconSkip } from './icons.jsx';
import { closePanel } from '../lib/hooks.js';
import Stepper from './Stepper.jsx';

const R = 52;
const C = 2 * Math.PI * R;

function clock(ms) {
  const seconds = Math.ceil(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

const PRESETS = [
  { focusMin: 25, breakMin: 5, name: 'Classic' },
  { focusMin: 50, breakMin: 10, name: 'Deep' },
  { focusMin: 15, breakMin: 3, name: 'Short' },
];

// Pomodoro window. The countdown itself runs in the main process (so it
// survives this window being closed); this view just draws it.
export default function Timer() {
  const [snap, setSnap] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    window.sticky.timer.get().then((s) => alive && setSnap(s));
    const off = window.sticky.timer.onChanged((s) => {
      setNow(Date.now());
      setSnap(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const running = snap?.status === 'running';
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);

  const remaining = !snap ? 0 : running ? Math.max(0, snap.endsAt - now) : snap.remainingMs;
  const label = snap ? clock(remaining) : '';
  const isFocus = snap?.phase !== 'break';

  useEffect(() => {
    if (snap) document.title = `${label} ${isFocus ? 'Focus' : 'Break'}`;
  }, [snap, label, isFocus]);

  if (!snap) return <div className="panel-shell" />;

  const elapsed = 1 - remaining / snap.durationMs;
  const send = (name) => window.sticky.timer.command(name);
  const primary = running
    ? { name: 'pause', text: 'Pause', icon: <IconPause /> }
    : { name: 'start', text: snap.status === 'paused' ? 'Resume' : 'Start', icon: <IconPlay /> };
  const dots = Math.min(snap.sessionsToday, 8);
  const setLengths = (lengths) => window.sticky.timer.setLengths({ focusMin: snap.focusMin, breakMin: snap.breakMin, ...lengths });

  return (
    <div className="panel-shell">
      <section className={`panel timer ${isFocus ? 'paper-peach' : 'paper-mint'}`} aria-label="Pomodoro">
        <header className="panel-header">
          <h1>Pomodoro</h1>
          <span className="header-spacer" />
          <button type="button" className="icon-btn" aria-label="Close Pomodoro" title="Close (the timer keeps running)" onClick={closePanel}>
            <IconClose />
          </button>
        </header>

        <div className={running ? 'timer-face is-running' : 'timer-face'}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle className="timer-track" cx="60" cy="60" r={R} />
            <circle
              className="timer-fill"
              cx="60"
              cy="60"
              r={R}
              strokeDasharray={C}
              strokeDashoffset={C * (1 - elapsed)}
              transform="rotate(-90 60 60)"
            />
          </svg>
          <div className="timer-readout" role="timer" aria-live="off">
            <span className="timer-phase">{isFocus ? 'Focus' : 'Break'}</span>
            <span className="timer-time">{label}</span>
            <span className="timer-status">
              {running ? (isFocus ? 'Stay with it' : 'Rest your eyes') : snap.status === 'paused' ? 'Paused' : isFocus ? 'Ready' : 'Break ready'}
            </span>
          </div>
        </div>

        <div className="timer-controls">
          <button type="button" className="icon-btn" aria-label="Reset" title="Reset to a new focus session" onClick={() => send('reset')}>
            <IconRestore />
          </button>
          <button type="button" className="btn primary" data-action="primary" onClick={() => send(primary.name)}>
            {primary.icon} {primary.text}
          </button>
          <button type="button" className="icon-btn" aria-label={isFocus ? 'Skip to break' : 'Skip break'} title={isFocus ? 'Skip to break' : 'Skip break'} onClick={() => send('skip')}>
            <IconSkip />
          </button>
        </div>

        <p className="timer-sessions" title="Focus sessions finished today">
          {snap.sessionsToday === 0 ? (
            'No sessions yet today'
          ) : (
            <>
              <span className="session-dots" aria-hidden="true">
                {Array.from({ length: dots }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
              {snap.sessionsToday} {snap.sessionsToday === 1 ? 'session' : 'sessions'} today
            </>
          )}
        </p>

        <div className="timer-config">
          <div className="timer-presets" role="group" aria-label="Presets">
            {PRESETS.map((p) => {
              const active = p.focusMin === snap.focusMin && p.breakMin === snap.breakMin;
              return (
                <button
                  key={p.name}
                  type="button"
                  className={active ? 'chip is-active' : 'chip'}
                  aria-pressed={active}
                  title={`${p.focusMin} minutes of focus, ${p.breakMin} minutes of break`}
                  onClick={() => setLengths(p)}
                >
                  {p.focusMin} / {p.breakMin}
                </button>
              );
            })}
          </div>
          <Stepper label="Focus" value={snap.focusMin} min={1} max={180} onChange={(focusMin) => setLengths({ focusMin })} />
          <Stepper label="Break" value={snap.breakMin} min={1} max={60} onChange={(breakMin) => setLengths({ breakMin })} />
          {snap.status !== 'idle' && <p className="timer-hint">New lengths start with the next session.</p>}
        </div>
      </section>
    </div>
  );
}
