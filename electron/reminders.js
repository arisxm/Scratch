'use strict';
// Deadline reminders: pure logic, no Electron imports, so it can be unit
// tested. main.js calls dueReminders() on a timer and shows the notifications.

const DATE_ONLY_REMINDER_HOUR = 9; // "due on the 20th" reminds at 09:00 that day
const LATE_AFTER_MS = 5 * 60_000; // beyond this, word it as overdue rather than due now

/** Local time (ms) at which a deadline should trigger its reminder. */
function reminderTime(deadline, dateOnlyHour = DATE_ONLY_REMINDER_HOUR) {
  const [y, m, d] = deadline.slice(0, 10).split('-').map(Number);
  if (deadline.length === 10) return new Date(y, m - 1, d, dateOnlyHour, 0, 0).getTime();
  const [hh, mm] = deadline.slice(11).split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0).getTime();
}

/**
 * Tasks whose reminder time has arrived and that haven't been reminded yet.
 * Completed tasks never remind. Returns [{ note, task, late }].
 */
function dueReminders(notes, nowMs, dateOnlyHour = DATE_ONLY_REMINDER_HOUR) {
  const due = [];
  for (const note of notes) {
    for (const task of note.tasks) {
      if (task.done || !task.deadline || task.reminded) continue;
      const at = reminderTime(task.deadline, dateOnlyHour);
      if (at <= nowMs) due.push({ note, task, late: nowMs - at > LATE_AFTER_MS });
    }
  }
  return due;
}

/**
 * When a note window sends a new task list, keep each task's `reminded` flag
 * only if its deadline is unchanged, so moving a deadline re-arms the reminder.
 */
function carryReminded(previousTasks, nextTasks) {
  const prev = new Map(previousTasks.map((t) => [t.id, t]));
  for (const task of nextTasks) {
    const old = prev.get(task.id);
    task.reminded = !!(old && old.reminded && old.deadline === task.deadline);
  }
  return nextTasks;
}

module.exports = { reminderTime, dueReminders, carryReminded, DATE_ONLY_REMINDER_HOUR };
