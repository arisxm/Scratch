import { useEffect, useRef } from 'react';

export const COLORS = [
  { id: 'yellow', name: 'Lemon' },
  { id: 'pink', name: 'Blush' },
  { id: 'lavender', name: 'Lavender' },
  { id: 'mint', name: 'Mint' },
  { id: 'sky', name: 'Sky' },
  { id: 'peach', name: 'Peach' },
  { id: 'coral', name: 'Coral' },
  { id: 'lime', name: 'Lime' },
  { id: 'aqua', name: 'Aqua' },
  { id: 'orchid', name: 'Orchid' },
  { id: 'sand', name: 'Sand' },
  { id: 'stone', name: 'Stone' },
];

// Popover under the note header: paper colour plus how see-through the note
// is. Both apply (and save) as you change them.
export default function ColorPicker({ value, opacity, onPick, onOpacity, onClose }) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    ref.current?.querySelector('[aria-checked="true"]')?.focus();
    const onDown = (e) => {
      if (!ref.current?.contains(e.target) && !e.target.closest?.('[data-palette-toggle]')) close.current();
    };
    const onKey = (e) => e.key === 'Escape' && close.current();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []); // mount only: re-running would steal focus from the slider mid-drag

  const move = (e) => {
    const i = COLORS.findIndex((c) => c.id === value);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = COLORS[(i + step + COLORS.length) % COLORS.length];
    onPick(next.id);
    requestAnimationFrame(() => ref.current?.querySelector(`[data-color="${next.id}"]`)?.focus());
  };

  const percent = Math.round(opacity * 100);

  return (
    <div className="palette" ref={ref}>
      <div className="swatches" role="radiogroup" aria-label="Note color" onKeyDown={move}>
        {COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={c.id === value}
            aria-label={c.name}
            title={c.name}
            data-color={c.id}
            tabIndex={c.id === value ? 0 : -1}
            className={`swatch paper-${c.id}`}
            onClick={() => onPick(c.id)}
          />
        ))}
      </div>
      <label className="opacity-row" title="Lower it to see what's behind the note">
        <span>Opacity</span>
        <input
          type="range"
          min={30}
          max={100}
          step={5}
          value={percent}
          aria-label="Note opacity"
          onChange={(e) => onOpacity(Number(e.target.value) / 100)}
        />
        <output>{percent}%</output>
      </label>
    </div>
  );
}
