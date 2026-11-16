import { useEffect, useState } from 'react';
import { IconMinus, IconPlus } from './icons.jsx';

// A whole-number field with - and + buttons, for minutes. Type a value, or use
// the buttons or the arrow keys; it is clamped to [min, max] and committed on
// Enter, on leaving the field, and on each step.
export default function Stepper({ label, value, min, max, unit = 'min', onChange }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = (raw) => {
    const n = Math.round(Number(raw));
    if (raw === '' || !Number.isFinite(n)) return setText(String(value));
    const next = Math.min(max, Math.max(min, n));
    setText(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <div className="stepper" role="group" aria-label={label}>
      <span className="stepper-label">{label}</span>
      <button type="button" className="icon-btn small" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => commit(value - 1)}>
        <IconMinus />
      </button>
      <input
        className="stepper-input"
        inputMode="numeric"
        maxLength={3}
        value={text}
        aria-label={`${label} in ${unit === 'min' ? 'minutes' : unit}`}
        onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
        onBlur={(e) => commit(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            commit(value + (e.key === 'ArrowUp' ? 1 : -1));
          }
        }}
      />
      <button type="button" className="icon-btn small" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => commit(value + 1)}>
        <IconPlus />
      </button>
      <span className="stepper-unit">{unit}</span>
    </div>
  );
}
