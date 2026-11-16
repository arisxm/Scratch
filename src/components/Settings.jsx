import { useEffect } from 'react';
import { IconClose } from './icons.jsx';
import { closePanel, useSettings } from '../lib/hooks.js';
import Stepper from './Stepper.jsx';

const SCALE_LABELS = { 0.8: '80%', 0.9: '90%', 1: '100%', 1.1: '110%', 1.25: '125%', 1.5: '150%' };
const OPACITY_STEPS = [1, 0.85, 0.7, 0.55, 0.4];
const COLOR_NAMES = { yellow: 'Lemon', pink: 'Blush', lavender: 'Lavender', mint: 'Mint', sky: 'Sky', peach: 'Peach', coral: 'Coral', lime: 'Lime', aqua: 'Aqua', orchid: 'Orchid', sand: 'Sand', stone: 'Stone' };

function Switch({ checked, disabled, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="switch" onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

function Row({ label, hint, children }) {
  return (
    <label className="set-row">
      <span className="set-text">
        <span className="set-label">{label}</span>
        {hint && <span className="set-hint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Segmented({ label, options, value, onChange }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'is-on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Settings: everything you can adjust in one place. The menu's own switches
// stay as they were; both read and write the same values.
export default function Settings() {
  const [s, setS] = useSettings();

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && closePanel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!s) return <div className="panel-shell" />;

  // Show the change at once; the main process then confirms it to every window.
  const set = (key, value) => {
    setS((prev) => ({ ...prev, [key]: value }));
    window.sticky.settings.set(key, value);
  };
  const lengths = (patch) => {
    setS((prev) => ({ ...prev, ...patch }));
    window.sticky.timer.setLengths(patch);
  };

  return (
    <div className="panel-shell">
      <section className="panel settings" aria-label="Settings">
        <header className="panel-header">
          <h1>Settings</h1>
          <span className="header-spacer" />
          <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={closePanel}>
            <IconClose />
          </button>
        </header>

        <div className="settings-body">
          <section className="set-group" aria-label="Appearance">
            <h2>Appearance</h2>
            <div className="set-row is-stacked">
              <span className="set-text">
                <span className="set-label">Size</span>
                <span className="set-hint">Scales every Scratch window.</span>
              </span>
              <Segmented label="Size" value={s.scale} onChange={(v) => set('scale', v)} options={s.scales.map((v) => ({ value: v, label: SCALE_LABELS[v] }))} />
            </div>
            <div className="set-row is-stacked">
              <span className="set-text">
                <span className="set-label">Transparency</span>
                <span className="set-hint">For all notes. Each note can also be set from its drop icon.</span>
              </span>
              <Segmented label="Transparency" value={s.opacity} onChange={(v) => set('opacity', v)} options={OPACITY_STEPS.map((v) => ({ value: v, label: v === 1 ? 'Solid' : `${Math.round(v * 100)}%` }))} />
            </div>
            <Row label="Animations" hint="Smooth motion when things open and change.">
              <Switch label="Animations" checked={s.animations} onChange={(v) => set('animations', v)} />
            </Row>
          </section>

          <section className="set-group" aria-label="Notes">
            <h2>Notes</h2>
            <Row label="Keep notes on top">
              <Switch label="Keep notes on top" checked={s.alwaysOnTop} onChange={(v) => set('alwaysOnTop', v)} />
            </Row>
            <Row label="Rotating tasks in note headers">
              <Switch label="Rotating tasks in note headers" checked={s.ticker} onChange={(v) => set('ticker', v)} />
            </Row>
            <div className="set-row is-stacked">
              <span className="set-text">
                <span className="set-label">New notes start as</span>
                <span className="set-hint">What the + pad creates. Any note can be switched later.</span>
              </span>
              <Segmented
                label="New notes start as"
                value={s.newNoteMode}
                onChange={(v) => set('newNoteMode', v)}
                options={[{ value: 'daily', label: 'Daily list' }, { value: 'monthly', label: 'Monthly goals' }]}
              />
            </div>
            <div className="set-row is-stacked">
              <span className="set-text">
                <span className="set-label">Color of new notes</span>
                <span className="set-hint">Auto goes through the colors in turn.</span>
              </span>
              <div className="color-choice" role="radiogroup" aria-label="Color of new notes">
                <button type="button" role="radio" aria-checked={s.newNoteColor === 'rotate'} className={s.newNoteColor === 'rotate' ? 'auto-chip is-on' : 'auto-chip'} onClick={() => set('newNoteColor', 'rotate')}>
                  Auto
                </button>
                {s.colors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={s.newNoteColor === c}
                    aria-label={COLOR_NAMES[c]}
                    title={COLOR_NAMES[c]}
                    className={`swatch-dot paper-${c}${s.newNoteColor === c ? ' is-on' : ''}`}
                    onClick={() => set('newNoteColor', c)}
                  />
                ))}
              </div>
            </div>
          </section>

          <section className="set-group" aria-label="Reminders">
            <h2>Reminders</h2>
            <Row label="Deadline reminders">
              <Switch label="Deadline reminders" checked={s.reminders} onChange={(v) => set('reminders', v)} />
            </Row>
            <div className="set-row">
              <span className="set-text">
                <span className="set-label">Reminder hour</span>
                <span className="set-hint">For deadlines with a date but no time (24-hour clock).</span>
              </span>
              <Stepper label="Reminder hour" value={s.reminderHour} min={0} max={23} unit="h" onChange={(v) => set('reminderHour', v)} />
            </div>
            <Row label="Notification sound" hint="Applies to reminders and Pomodoro alerts.">
              <Switch label="Notification sound" checked={s.notifySound} onChange={(v) => set('notifySound', v)} />
            </Row>
          </section>

          <section className="set-group" aria-label="Startup">
            <h2>Startup</h2>
            <Row label="Open when I sign in" hint={s.startupSupported ? undefined : 'Available in the installed app only.'}>
              <Switch label="Open when I sign in" checked={s.openAtLogin} disabled={!s.startupSupported} onChange={(v) => set('openAtLogin', v)} />
            </Row>
            <Row label="Collapse notes at launch" hint="Start each session with notes folded to their header strip.">
              <Switch label="Collapse notes at launch" checked={s.startCollapsed} onChange={(v) => set('startCollapsed', v)} />
            </Row>
          </section>

          <section className="set-group" aria-label="Pomodoro">
            <h2>Pomodoro</h2>
            <div className="set-row">
              <span className="set-text">
                <span className="set-label">Focus length</span>
              </span>
              <Stepper label="Focus" value={s.focusMin} min={s.limits.focusMin[0]} max={s.limits.focusMin[1]} onChange={(focusMin) => lengths({ focusMin })} />
            </div>
            <div className="set-row">
              <span className="set-text">
                <span className="set-label">Break length</span>
              </span>
              <Stepper label="Break" value={s.breakMin} min={s.limits.breakMin[0]} max={s.limits.breakMin[1]} onChange={(breakMin) => lengths({ breakMin })} />
            </div>
          </section>

          <section className="set-group" aria-label="Pomodoro options">
            <Row label="Start the next focus session by itself" hint="When a break ends. The break always starts on its own.">
              <Switch label="Start the next focus session by itself" checked={s.pomodoroAutoFocus} onChange={(v) => set('pomodoroAutoFocus', v)} />
            </Row>
            <Row label="Pomodoro alerts" hint="A notification when a session or break ends.">
              <Switch label="Pomodoro alerts" checked={s.pomodoroNotify} onChange={(v) => set('pomodoroNotify', v)} />
            </Row>
          </section>

          <section className="set-group" aria-label="Data and windows">
            <h2>Data and windows</h2>
            <div className="set-actions">
              <button type="button" className="btn" data-action="show-all" onClick={() => window.sticky.settings.action('show-all')}>
                Bring all windows to front
              </button>
              <button type="button" className="btn" data-action="open-data" onClick={() => window.sticky.settings.action('open-data')}>
                Open data folder
              </button>
              <button type="button" className="btn danger" data-action="reset" onClick={() => window.sticky.settings.action('reset')}>
                Restore default settings…
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
