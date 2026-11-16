import { memo, useState } from 'react';
import { deadlineInfo } from '../lib/dates.js';
import { IconCalendar, IconClose } from './icons.jsx';
import DeadlineEditor from './DeadlineEditor.jsx';

const REMOVE_MS = 170; // keep in sync with .task.is-removing in note.css

// `now` only changes for tasks that have a deadline, so tasks without one
// don't re-render on every countdown tick.
// `exiting` plays the leave animation when the parent is about to move the
// task elsewhere (a completed task sliding off to the Completed section).
function TaskItem({ task, today, now, isNew, exiting, doneLabel, onToggle, onEdit, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.text);
  const [leaving, setLeaving] = useState(false);
  const [pickingDeadline, setPickingDeadline] = useState(false);

  const due = task.deadline ? deadlineInfo(task.deadline, now, task.done) : null;

  const startEdit = () => {
    setDraft(task.text);
    setEditing(true);
  };

  const finishEdit = (save) => {
    setEditing(false);
    const value = draft.trim();
    if (save && value && value !== task.text) onEdit(task.id, { text: value });
  };

  // Deleting: play the short exit, then remove (the rows below slide up, see useFlip).
  // Motion is skipped when it is turned off.
  const remove = () => {
    if (leaving) return;
    const still =
      document.documentElement.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) return onRemove(task.id);
    setLeaving(true);
    setTimeout(() => onRemove(task.id), REMOVE_MS);
    return undefined;
  };

  const classes = [
    'task',
    task.done && 'is-done',
    doneLabel !== undefined && 'is-history',
    exiting && 'is-leaving',
    leaving && 'is-removing',
    isNew && 'is-new',
    due?.status === 'overdue' && 'is-overdue',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={classes} data-task-id={task.id}>
      <div className="task-row">
        <button
          type="button"
          className="check"
          role="checkbox"
          aria-checked={task.done}
          aria-label={task.done ? `Mark “${task.text}” as not done` : `Mark “${task.text}” as done`}
          onClick={() => onToggle(task.id)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <circle className="check-ring" cx="10" cy="10" r="8" />
            <path className="check-mark" d="M6 10.4l2.7 2.7L14.2 7.4" pathLength="1" />
          </svg>
        </button>

        <div className="task-body">
          {editing ? (
            <input
              className="task-edit"
              value={draft}
              maxLength={500}
              autoFocus
              aria-label="Edit task"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => finishEdit(true)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') finishEdit(true);
                if (e.key === 'Escape') finishEdit(false);
              }}
            />
          ) : (
            <span className="task-text" onDoubleClick={startEdit} title="Double-click to edit">
              <span className="strike">{task.text}</span>
            </span>
          )}

          {doneLabel && !editing && <span className="done-label">{doneLabel}</span>}

          {due && !editing && !pickingDeadline && (
            <button
              type="button"
              className={`deadline deadline-${due.status}`}
              title={`Deadline: ${due.exact}. Click to change.`}
              onClick={() => setPickingDeadline(true)}
            >
              {due.text}
            </button>
          )}

          {pickingDeadline && (
            <DeadlineEditor
              value={task.deadline}
              today={today}
              onChange={(deadline) => onEdit(task.id, { deadline })}
              onClose={() => setPickingDeadline(false)}
            />
          )}
        </div>

        <div className="task-actions">
          {!task.deadline && (
            <button
              type="button"
              className="icon-btn small"
              aria-label="Set a deadline"
              aria-expanded={pickingDeadline}
              title="Set a deadline"
              onClick={() => setPickingDeadline((v) => !v)}
            >
              <IconCalendar />
            </button>
          )}
          <button
            type="button"
            className="icon-btn small danger"
            aria-label={`Delete “${task.text}”`}
            title="Delete task"
            onClick={remove}
          >
            <IconClose />
          </button>
        </div>
      </div>
    </li>
  );
}

export default memo(TaskItem);
