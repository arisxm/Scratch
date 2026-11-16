import { useLayoutEffect, useRef } from 'react';
import { addDays, addMonths, dayDiff, dayLabel, formatFull, formatMonth } from '../lib/dates.js';
import { IconChevronLeft, IconChevronRight } from './icons.jsx';

export default function PeriodBar({ note, today, commit }) {
  const pickerRef = useRef(null);
  const switchRef = useRef(null);
  const isDaily = note.mode === 'daily';

  // The white pill under the active tab. It is placed from the tab's measured
  // position; the first placement is instant, every later one rolls across.
  useLayoutEffect(() => {
    const box = switchRef.current;
    if (!box) return undefined;
    const place = () => {
      const tab = box.querySelector('[aria-checked="true"]');
      if (!tab) return;
      box.style.setProperty('--pill-x', `${tab.offsetLeft}px`);
      box.style.setProperty('--pill-w', `${tab.offsetWidth}px`);
    };
    place();
    box.classList.add('is-placed');
    document.fonts?.ready.then(place);
    const watch = new ResizeObserver(place);
    watch.observe(box);
    return () => watch.disconnect();
  }, [isDaily]);

  const openPicker = () => {
    try {
      pickerRef.current?.showPicker();
    } catch {
      pickerRef.current?.focus();
    }
  };

  const step = (n) =>
    isDaily ? commit({ date: addDays(note.date, n) }) : commit({ month: addMonths(note.month, n) });

  let label;
  let tone = 'current';
  if (isDaily) {
    const { lead, rest } = dayLabel(note.date, today.date);
    label = lead ? (
      <>
        <strong>{lead}</strong> {rest}
      </>
    ) : (
      rest
    );
    const diff = dayDiff(today.date, note.date);
    tone = diff === 0 ? 'current' : diff < 0 ? 'past' : 'future';
  } else {
    label = formatMonth(note.month);
    tone = note.month === today.month ? 'current' : note.month < today.month ? 'past' : 'future';
  }

  return (
    <div className="period">
      <div className="period-row">
        <div className="mode-switch" role="radiogroup" aria-label="List type" ref={switchRef}>
          <span className="mode-pill" aria-hidden="true" />
          <button
            type="button"
            role="radio"
            aria-checked={isDaily}
            title="Tasks for one day"
            onClick={() => commit({ mode: 'daily', date: note.date || today.date })}
          >
            Day
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!isDaily}
            title="Goals for a whole month"
            onClick={() => commit({ mode: 'monthly', month: note.month || today.month })}
          >
            Month
          </button>
        </div>

        <div className={`period-nav tone-${tone}`} key={note.mode}>
          <button
            type="button"
            className="icon-btn small"
            aria-label={isDaily ? 'Previous day' : 'Previous month'}
            onClick={() => step(-1)}
          >
            <IconChevronLeft />
          </button>
          <span className="date-anchor period-anchor">
            <button
              type="button"
              className="period-label"
              title={isDaily ? `${formatFull(note.date)}. Click to pick a date.` : 'Click to pick a month'}
              onClick={openPicker}
            >
              {label}
            </button>
            <input
              ref={pickerRef}
              key={note.mode}
              type={isDaily ? 'date' : 'month'}
              className="visually-hidden-input"
              tabIndex={-1}
              aria-hidden="true"
              value={isDaily ? note.date : note.month}
              onChange={(e) => {
                if (!e.target.value) return; // "Clear" in the picker keeps the current period
                commit(isDaily ? { date: e.target.value } : { month: e.target.value });
              }}
            />
          </span>
          <button
            type="button"
            className="icon-btn small"
            aria-label={isDaily ? 'Next day' : 'Next month'}
            onClick={() => step(1)}
          >
            <IconChevronRight />
          </button>
        </div>
      </div>
    </div>
  );
}
