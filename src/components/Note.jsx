import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNote, useNow, useToday, newId } from '../lib/hooks.js';
import { dayDiff, deadlineInfo, doneLabel } from '../lib/dates.js';
import { IconChevronDown, IconChevronRight, IconChevronUp, IconClose, IconDrop } from './icons.jsx';
import ColorPicker from './ColorPicker.jsx';
import Ticker from './Ticker.jsx';
import PeriodBar from './PeriodBar.jsx';
import ProgressRing from './ProgressRing.jsx';
import TaskInput from './TaskInput.jsx';
import TaskItem from './TaskItem.jsx';
import ResizeHandle from './ResizeHandle.jsx';

// A task that was just checked stays put long enough to watch the pen stroke
// cross it out, then slides off into the Completed section.
const HOLD_MS = 700;
const EXIT_MS = 200; // keep in sync with .task.is-leaving in note.css
const FLIP_MS = 320;
const FLIP_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

const motionOff = () =>
  document.documentElement.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Where every task row is, relative to the scroll area's content. */
function measureRows(root) {
  const base = root.getBoundingClientRect();
  const rows = new Map();
  for (const el of root.querySelectorAll('[data-task-id]')) {
    const r = el.getBoundingClientRect();
    rows.set(el.dataset.taskId, { x: r.left - base.left, y: r.top - base.top + root.scrollTop, el });
  }
  return rows;
}

/**
 * FLIP: when rows are added, removed or moved, each row that stays in its
 * list slides from where it was to where it is now, using transform only
 * (compositor, no layout per frame). `layoutKey` changes whenever the
 * arrangement does. The "before" positions are read while rendering, i.e.
 * before React touches the DOM.
 *
 * A row that moved between the to-do list and Completed is a new element in
 * the other list. Sliding it there would carry it across the rows in between
 * (rows have no background, so the texts overlapped); instead it fades in at
 * its new place once the others have finished sliding.
 */
function useFlip(rootRef, layoutKey) {
  const seen = useRef(layoutKey);
  const first = useRef(null);
  if (seen.current !== layoutKey && rootRef.current) {
    first.current = measureRows(rootRef.current);
    seen.current = layoutKey;
  }
  useLayoutEffect(() => {
    const before = first.current;
    first.current = null;
    if (!before || !rootRef.current || motionOff()) return;
    for (const [id, now] of measureRows(rootRef.current)) {
      const was = before.get(id);
      if (!was) continue;
      // A slide still running from the last change is replaced, not stacked
      // (the "before" position above already includes where it had got to).
      for (const a of now.el.getAnimations()) if (a.id === 'flip' || a.id === 'flip-in') a.cancel();
      if (was.el !== now.el) {
        now.el.animate([{ opacity: 0 }, { opacity: 1 }], {
          id: 'flip-in', duration: 180, delay: FLIP_MS, easing: 'ease-out', fill: 'backwards',
        });
        continue;
      }
      const dx = was.x - now.x;
      const dy = was.y - now.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      now.el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
        id: 'flip', duration: FLIP_MS, easing: FLIP_EASE,
      });
    }
  }, [layoutKey, rootRef]);
}

export default function NoteApp({ fresh }) {
  const { note, commit, setLocal, updateTasks } = useNote();
  const today = useToday();
  if (!note) return <div className="note-shell" />;
  return (
    <Note
      note={note}
      today={today}
      fresh={fresh}
      commit={commit}
      setLocal={setLocal}
      updateTasks={updateTasks}
    />
  );
}

function Note({ note, today, fresh, commit, setLocal, updateTasks }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newestId, setNewestId] = useState(null);
  const [lingering, setLingering] = useState({}); // task id -> 'hold' | 'leaving'
  const lingerTimers = useRef(new Map());
  const scrollRef = useRef(null);
  const tasksRef = useRef(note.tasks);
  tasksRef.current = note.tasks;

  const isDaily = note.mode === 'daily';
  const isTodayNote = isDaily && note.date === today.date;
  const isPastDay = isDaily && dayDiff(today.date, note.date) < 0;
  const total = note.tasks.length;
  const doneCount = note.tasks.filter((t) => t.done).length;
  const remaining = total - doneCount;
  const now = useNow();
  const overdue = note.tasks.filter(
    (t) => !t.done && t.deadline && deadlineInfo(t.deadline, now, false).status === 'overdue',
  ).length;

  const active = note.tasks.filter((t) => !t.done || lingering[t.id]);
  const history = note.tasks
    .filter((t) => t.done && !lingering[t.id])
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  // Changes whenever the rows are arranged differently (not when only text changes).
  const layoutKey = `${active.map((t) => t.id).join()}|${note.historyOpen ? history.map((t) => t.id).join() : history.length}`;
  useFlip(scrollRef, layoutKey);

  useEffect(() => {
    document.title = note.title || (isDaily ? 'Daily list' : 'Monthly goals');
  }, [note.title, isDaily]);

  useEffect(() => {
    const timers = lingerTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const stopLingering = useCallback((id) => {
    clearTimeout(lingerTimers.current.get(id));
    lingerTimers.current.delete(id);
    setLingering((l) => {
      if (!(id in l)) return l;
      const { [id]: _gone, ...rest } = l;
      return rest;
    });
  }, []);

  const addTask = useCallback(
    (text) => {
      const task = { id: newId(), text, done: false, createdAt: Date.now(), completedAt: null, deadline: null };
      setNewestId(task.id);
      updateTasks((tasks) => [...tasks, task]);
      requestAnimationFrame(() => {
        scrollRef.current?.querySelector('.task.is-new')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    },
    [updateTasks],
  );

  const toggleTask = useCallback(
    (id) => {
      const task = tasksRef.current.find((t) => t.id === id);
      if (!task) return;
      if (task.done) {
        stopLingering(id); // undo: at once, whether it is still in the list or comes back from Completed
      } else {
        setLingering((l) => ({ ...l, [id]: 'hold' }));
        clearTimeout(lingerTimers.current.get(id));
        lingerTimers.current.set(
          id,
          setTimeout(() => {
            // It fades off first, then reappears in Completed (if open) without
            // crossing the rows in between (see useFlip).
            if (motionOff()) return stopLingering(id);
            setLingering((l) => (id in l ? { ...l, [id]: 'leaving' } : l));
            lingerTimers.current.set(id, setTimeout(() => stopLingering(id), EXIT_MS));
            return undefined;
          }, HOLD_MS),
        );
      }
      updateTasks((tasks) =>
        tasks.map((t) => (t.id === id ? { ...t, done: !t.done, completedAt: t.done ? null : Date.now() } : t)),
      );
    },
    [updateTasks, stopLingering],
  );

  const editTask = useCallback(
    (id, changes) => updateTasks((tasks) => tasks.map((t) => (t.id === id ? { ...t, ...changes } : t))),
    [updateTasks],
  );

  const removeTask = useCallback(
    (id) => updateTasks((tasks) => tasks.filter((t) => t.id !== id)),
    [updateTasks],
  );

  // A collapsed note's window is just the strip; let it grow while the palette
  // is open so the palette isn't cut off, and shrink back when it closes.
  useLayoutEffect(() => {
    if (!paletteOpen || !note.collapsed) return undefined;
    const el = document.querySelector('.palette');
    if (!el) return undefined;
    window.sticky.note.setPopoverHeight(Math.ceil(el.getBoundingClientRect().bottom + 14));
    return () => window.sticky.note.setPopoverHeight(null);
  }, [paletteOpen, note.collapsed]);

  const toggleCollapsed = async () => {
    setPaletteOpen(false);
    if (!note.collapsed) {
      setLocal({ collapsed: true }); // hide content first, then shrink the window
      await window.sticky.note.setCollapsed(true);
    } else {
      await window.sticky.note.setCollapsed(false); // grow the window first
      setLocal({ collapsed: false });
    }
  };

  const openNoteMenu = (event) => {
    event.preventDefault();
    window.sticky.note.openMenu();
  };

  const classes = [
    'note',
    `paper-${note.color}`,
    `mode-${note.mode}`,
    note.collapsed && 'is-collapsed',
    isTodayNote && 'is-today',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="note-shell">
      <article className={classes} aria-label={note.title || (isDaily ? 'Daily list' : 'Monthly goals')}>
        {isTodayNote && <span className="tape" aria-hidden="true" />}

        <header className="note-header" onContextMenu={openNoteMenu}>
          {/* The input is sized by an invisible copy of its text in the same
              font (see .title-sizer), instead of CSS field-sizing, which left
              "To do" clipped on Windows. */}
          <span className="title-sizer" data-value={note.title || (isDaily ? 'To do' : 'This month')}>
          <input
            className="note-title"
            size={1} /* no built-in ~20-character width; the hidden copy sets it */
            value={note.title}
            maxLength={80}
            spellCheck={false}
            placeholder={isDaily ? 'To do' : 'This month'}
            aria-label="Note title"
            onChange={(e) => commit({ title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
            }}
          />
          </span>
          {note.ticker !== false ? <Ticker tasks={note.tasks} now={now} /> : <span className="header-spacer" />}
          {note.ticker === false && note.collapsed && total > 0 && (
            <span
              className={overdue ? 'collapsed-count has-overdue' : 'collapsed-count'}
              title={`${doneCount} of ${total} done`}
            >
              {overdue ? `${overdue} overdue` : remaining === 0 ? 'All done' : `${remaining} left`}
            </span>
          )}
          <div className="note-controls">
            <button
              type="button"
              className="icon-btn"
              data-palette-toggle
              aria-label="Color and opacity"
              aria-expanded={paletteOpen}
              title="Color and opacity"
              onClick={() => setPaletteOpen((v) => !v)}
            >
              <IconDrop />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={note.collapsed ? 'Expand note' : 'Collapse note'}
              title={note.collapsed ? 'Expand' : 'Collapse'}
              onClick={toggleCollapsed}
            >
              {note.collapsed ? <IconChevronDown /> : <IconChevronUp />}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Hide note"
              title="Hide note (find it again under Hidden notes)"
              onClick={() => window.sticky.note.hide()}
            >
              <IconClose />
            </button>
          </div>
        </header>

        {paletteOpen && (
          <ColorPicker
            value={note.color}
            opacity={note.opacity ?? 1}
            onPick={(color) => commit({ color })}
            onOpacity={(opacity) => commit({ opacity })}
            onClose={() => setPaletteOpen(false)}
          />
        )}

        {!note.collapsed && (
          <>
            <PeriodBar note={note} today={today} commit={commit} />

            <TaskInput
              autoFocus={fresh}
              placeholder={isDaily ? 'Add a task' : 'Add a goal for this month'}
              onAdd={addTask}
            />

            <div className="task-scroll" ref={scrollRef}>
              <ul className="task-list" aria-label="To do">
                {active.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    today={today.date}
                    now={task.deadline ? now : 0}
                    isNew={task.id === newestId}
                    exiting={lingering[task.id] === 'leaving'}
                    onToggle={toggleTask}
                    onEdit={editTask}
                    onRemove={removeTask}
                  />
                ))}
                {active.length === 0 && (
                  <li className="empty-state">
                    {total > 0
                      ? 'Everything is done.'
                      : isDaily
                        ? 'Nothing planned for this day yet.'
                        : 'No goals for this month yet.'}
                  </li>
                )}
              </ul>

              {history.length > 0 && (
                <section className="history">
                  <button
                    type="button"
                    className="history-toggle"
                    aria-expanded={note.historyOpen}
                    onClick={() => commit({ historyOpen: !note.historyOpen })}
                  >
                    {note.historyOpen ? <IconChevronDown /> : <IconChevronRight />}
                    Completed
                    <span className="history-count" key={history.length}>{history.length}</span>
                  </button>
                  {note.historyOpen && (
                    <ul className="task-list history-list" aria-label="Completed">
                      {history.map((task) => (
                        <TaskItem
                          key={task.id}
                          task={task}
                          today={today.date}
                          now={task.deadline ? now : 0}
                          doneLabel={doneLabel(task.completedAt, today.date)}
                          onToggle={toggleTask}
                          onEdit={editTask}
                          onRemove={removeTask}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>

            <footer className="note-footer">
              <span className="tally">
                {total > 0 && (
                  <>
                    <ProgressRing done={doneCount} total={total} />
                    <span>{remaining === 0 ? 'All done' : `${doneCount} of ${total} done`}</span>
                  </>
                )}
                {overdue > 0 && <span className="overdue-tally">{overdue} overdue</span>}
              </span>
              {isPastDay && remaining > 0 && (
                <button type="button" className="text-btn" onClick={() => commit({ date: today.date })}>
                  Move to today
                </button>
              )}
            </footer>

            <ResizeHandle />
          </>
        )}
      </article>
    </div>
  );
}
