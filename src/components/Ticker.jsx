import { useEffect, useMemo, useRef, useState } from 'react';
import { tickerItems } from '../lib/ticker.js';

const SHOW_MS = 4500; // how long each task stays up
const SWAP_MS = 420; // keep in sync with the ticker animations in note.css

/**
 * The rotating line in a note's header. It sits inside the header's drag
 * area, so it never takes clicks: the whole strip stays draggable.
 */
export default function Ticker({ tasks, now }) {
  const items = useMemo(() => tickerItems(tasks, now), [tasks, now]);
  const [pos, setPos] = useState(0);
  const [leaving, setLeaving] = useState(null);
  const posRef = useRef(0);

  // When the line-up changes (a task added, finished, or a deadline making
  // one more urgent), start again from the most urgent task. The order is
  // compared by id, so the countdown refreshing every 30 s doesn't reset it.
  const order = items.map((i) => i.task.id).join('|');
  const lastOrder = useRef(order);
  if (lastOrder.current !== order) {
    lastOrder.current = order;
    posRef.current = 0;
    if (pos !== 0) setPos(0);
  }

  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Rotate while there is more than one task and the window is visible.
  useEffect(() => {
    if (items.length < 2) return undefined;
    let swapTimer;
    const timer = setInterval(() => {
      if (document.hidden) return;
      const list = itemsRef.current;
      const prev = posRef.current % list.length;
      posRef.current = (prev + 1) % list.length;
      setLeaving({ key: `out-${Date.now()}`, item: list[prev] });
      setPos(posRef.current);
      clearTimeout(swapTimer);
      swapTimer = setTimeout(() => setLeaving(null), SWAP_MS);
    }, SHOW_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(swapTimer);
    };
  }, [order, items.length]);

  if (items.length === 0) {
    return tasks.length ? <span className="ticker ticker-done">All done</span> : <span className="ticker" />;
  }

  const current = items[pos % items.length];
  const count = (p) => (items.length > 1 ? `${(p % items.length) + 1}/${items.length}` : null);

  return (
    <span className="ticker" aria-hidden="true">
      <span className="ticker-window">
        {leaving && <TickerLine key={leaving.key} item={leaving.item} count={null} className="is-leaving" />}
        <TickerLine
          key={`${current.task.id}-${pos}`}
          item={current}
          count={count(pos)}
          className={leaving ? 'is-entering' : ''}
        />
      </span>
    </span>
  );
}

// Two lines: the task, and under it its countdown and its place in the rotation.
function TickerLine({ item, count, className }) {
  const status = item.due ? item.due.status : 'none';
  return (
    <span className={`ticker-line status-${status} ${className}`}>
      <span className="ticker-dot" />
      <span className="ticker-stack">
        <span className="ticker-text">{item.task.text}</span>
        <span className="ticker-meta">
          {item.due && <span className="ticker-due">{item.due.text}</span>}
          {count && <span className="ticker-count">{count}</span>}
          {!item.due && !count && <span>Next up</span>}
        </span>
      </span>
    </span>
  );
}
