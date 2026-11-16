import { deadlineDate, deadlineInfo } from './dates.js';

const URGENCY = { overdue: 0, today: 1, soon: 2, later: 3 };

/**
 * Unfinished tasks in the order they deserve attention: overdue first (most
 * overdue first), then by nearest deadline, then tasks without a deadline in
 * the order they appear on the note.
 */
export function tickerItems(tasks, now) {
  return tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => !task.done)
    .map(({ task, index }) => {
      const due = task.deadline ? deadlineInfo(task.deadline, now, false) : null;
      return { task, index, due, at: task.deadline ? deadlineDate(task.deadline).getTime() : Infinity };
    })
    .sort((a, b) => {
      const ua = a.due ? URGENCY[a.due.status] : 4;
      const ub = b.due ? URGENCY[b.due.status] : 4;
      return ua - ub || a.at - b.at || a.index - b.index;
    });
}
