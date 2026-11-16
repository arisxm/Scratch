import { useEffect, useRef } from 'react';
import { addDays } from '../lib/dates.js';

// Inline deadline editor shown under a task. Every change is saved straight
// away; "Done" (or Escape) just closes it. Time is optional: a deadline with
// no time means "some time that day".
export default function DeadlineEditor({ value, today, onChange, onClose }) {
  const ref = useRef(null);
  const date = value ? value.slice(0, 10) : '';
  const time = value && value.length > 10 ? value.slice(11) : '';

  useEffect(() => {
    ref.current?.querySelector('input[type="date"]')?.focus();
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const set = (nextDate, nextTime) => {
    if (!nextDate && !nextTime) return onChange(null);
    const d = nextDate || today; // a time on its own means today
    onChange(nextTime ? `${d}T${nextTime}` : d);
  };

  const quick = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'In a week', date: addDays(today, 7) },
  ];

  return (
    <div
      className="deadline-editor"
      ref={ref}
      role="group"
      aria-label="Deadline"
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && e.target.tagName === 'INPUT')) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="deadline-quick">
        {quick.map((q) => (
          <button key={q.label} type="button" aria-pressed={date === q.date} onClick={() => set(q.date, time)}>
            {q.label}
          </button>
        ))}
      </div>
      <div className="deadline-fields">
        <input type="date" aria-label="Deadline date" value={date} onChange={(e) => set(e.target.value, time)} />
        <input
          type="time"
          aria-label="Deadline time (optional)"
          title="Time (optional)"
          value={time}
          onChange={(e) => set(date, e.target.value)}
        />
      </div>
      <div className="deadline-buttons">
        {value && (
          <button type="button" className="text-btn subtle" onClick={() => { onChange(null); onClose(); }}>
            Remove
          </button>
        )}
        <button type="button" className="text-btn" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
