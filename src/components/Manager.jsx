import { useEffect, useMemo, useRef, useState } from 'react';
import { timeAgo } from '../lib/dates.js';
import { IconClose, IconRestore, IconTrash } from './icons.jsx';
import { closePanel } from '../lib/hooks.js';

const api = () => window.sticky.hidden;

// Hidden-notes manager: tick the notes you want, then restore or delete them
// together; or act on one row, or on everything at once. Deleting always asks
// for confirmation first (a native dialog shown by the main process).
export default function Manager() {
  const [items, setItems] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const selectAllRef = useRef(null);

  useEffect(() => {
    let alive = true;
    api().list().then((list) => alive && setItems(list));
    const off = api().onChanged(setItems);
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Drop ticks for notes that are no longer hidden (restored or deleted).
  useEffect(() => {
    if (!items) return;
    setSelected((prev) => {
      const ids = new Set(items.map((i) => i.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const count = items?.length ?? 0;
  const allSelected = count > 0 && selected.size === count;
  const someSelected = selected.size > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const chosen = useMemo(() => [...selected], [selected]);

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  const allIds = () => items.map((i) => i.id);

  return (
    <div className="panel-shell">
      <section className="panel manager" aria-label="Hidden notes">
        <header className="panel-header">
          <h1>Hidden notes</h1>
          {count > 0 && <span className="panel-count">{count}</span>}
          <span className="header-spacer" />
          <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={closePanel}>
            <IconClose />
          </button>
        </header>

        {items && count === 0 && (
          <div className="manager-empty">
            <p className="manager-empty-title">No hidden notes</p>
            <p>When you close a note with ×, it waits here until you restore or delete it.</p>
          </div>
        )}

        {count > 0 && (
          <>
            <div className="manager-toolbar">
              <label className="select-all">
                <input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={toggleAll} />
                <span>{selected.size ? `${selected.size} selected` : 'Select all'}</span>
              </label>
              <span className="header-spacer" />
              <button
                type="button"
                className="btn"
                data-action="restore-selected"
                disabled={!selected.size}
                onClick={() => api().restore(chosen)}
              >
                <IconRestore /> Restore
              </button>
              <button
                type="button"
                className="btn danger"
                data-action="delete-selected"
                disabled={!selected.size}
                onClick={() => api().remove(chosen)}
              >
                <IconTrash /> Delete
              </button>
            </div>

            <ul className="manager-list">
              {items.map((item, index) => {
                const isSelected = selected.has(item.id);
                const tasks = item.total ? `${item.done} of ${item.total} done` : 'No tasks';
                return (
                  <li
                    key={item.id}
                    className={isSelected ? 'manager-row is-selected' : 'manager-row'}
                    style={{ '--i': Math.min(index, 8) }}
                    onClick={() => toggle(item.id)}
                    title={item.preview.length ? `Still to do: ${item.preview.join(', ')}` : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      aria-label={`Select ${item.label}`}
                      onChange={() => toggle(item.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className={`row-chip paper-${item.color}`} aria-hidden="true" />
                    <span className="row-text">
                      <span className={item.untitled ? 'row-title is-untitled' : 'row-title'}>{item.label}</span>
                      <span className="row-meta">
                        {item.mode === 'daily' ? 'Daily list' : 'Monthly goals'}, {tasks}
                        {item.hiddenAt ? `, hidden ${timeAgo(item.hiddenAt)}` : ''}
                      </span>
                    </span>
                    <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Restore ${item.label}`}
                        title="Restore"
                        onClick={() => api().restore([item.id])}
                      >
                        <IconRestore />
                      </button>
                      <button
                        type="button"
                        className="icon-btn danger"
                        aria-label={`Delete ${item.label}`}
                        title="Delete…"
                        onClick={() => api().remove([item.id])}
                      >
                        <IconTrash />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>

            <footer className="manager-footer">
              <button type="button" className="text-btn" data-action="restore-all" onClick={() => api().restore(allIds())}>
                Restore all
              </button>
              <button type="button" className="text-btn danger" data-action="delete-all" onClick={() => api().remove(allIds())}>
                Delete all hidden notes…
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
