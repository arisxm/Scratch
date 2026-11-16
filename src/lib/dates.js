// Dates are stored as local calendar keys ("2026-11-06", "2026-11"), never as
// timestamps, so a task for "today" stays on the same day across time zones
// and daylight-saving changes.

const pad2 = (n) => String(n).padStart(2, '0');

export const toDateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const toMonthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

export function fromDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function fromMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1);
}

export function addDays(key, n) {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

export function addMonths(key, n) {
  const d = fromMonthKey(key);
  d.setMonth(d.getMonth() + n);
  return toMonthKey(d);
}

/** Whole calendar days from a to b (positive when b is later). */
export function dayDiff(a, b) {
  const ms = fromDateKey(b) - fromDateKey(a);
  return Math.round(ms / 86_400_000);
}

const fmt = (opts) => new Intl.DateTimeFormat(undefined, opts);
const shortDay = fmt({ day: 'numeric', month: 'short' });
const weekdayDay = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const fullDay = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const monthYear = fmt({ month: 'long', year: 'numeric' });

export const formatShort = (key) => shortDay.format(fromDateKey(key));
export const formatFull = (key) => fullDay.format(fromDateKey(key));
export const formatMonth = (key) => monthYear.format(fromMonthKey(key));

/** { lead, rest } so the relative word can be styled separately. */
export function dayLabel(key, todayKey) {
  const diff = dayDiff(todayKey, key);
  const relative = { 0: 'Today', [-1]: 'Yesterday', 1: 'Tomorrow' }[diff];
  if (relative) return { lead: relative, rest: shortDay.format(fromDateKey(key)) };
  return { lead: null, rest: weekdayDay.format(fromDateKey(key)) };
}

const clock = fmt({ hour: 'numeric', minute: '2-digit' });

/** Local Date for a deadline key ("2026-11-20" or "2026-11-20T17:30"). */
export function deadlineDate(deadline) {
  const d = fromDateKey(deadline.slice(0, 10));
  if (deadline.length > 10) {
    const [hh, mm] = deadline.slice(11).split(':').map(Number);
    d.setHours(hh, mm, 0, 0);
  }
  return d;
}

/** "25 min", "3h 20m", "2d 4h", "12 days" */
function span(totalMinutes) {
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) {
    const m = totalMinutes % 60;
    return m ? `${hours}h ${m}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days >= 7) return `${days} days`;
  const h = hours % 24;
  return h ? `${days}d ${h}h` : days === 1 ? '1 day' : `${days} days`;
}

/**
 * Countdown / overdue label for a task's deadline chip.
 * status: 'overdue' | 'today' | 'soon' | 'later' | 'done'
 * text:   the short label on the chip;  exact: full date for the tooltip.
 */
export function deadlineInfo(deadline, nowMs, done) {
  const now = new Date(nowMs);
  const timed = deadline.length > 10;
  const dayKey = deadline.slice(0, 10);
  const due = deadlineDate(deadline);
  const days = dayDiff(toDateKey(now), dayKey);
  const exact = timed ? `${formatFull(dayKey)}, ${clock.format(due)}` : formatFull(dayKey);

  if (done) {
    return { status: 'done', text: timed ? `${formatShort(dayKey)}, ${clock.format(due)}` : formatShort(dayKey), exact };
  }

  if (!timed) {
    // A day-only deadline is overdue once that day has ended.
    if (days < 0) return { status: 'overdue', text: days === -1 ? '1 day overdue' : `${-days} days overdue`, exact };
    if (days === 0) return { status: 'today', text: 'Due today', exact };
    if (days === 1) return { status: 'soon', text: 'Tomorrow', exact };
    return { status: days <= 2 ? 'soon' : 'later', text: `in ${days} days`, exact };
  }

  const ms = due.getTime() - nowMs;
  const minutes = Math.floor(Math.abs(ms) / 60_000);
  if (ms <= 0) return { status: 'overdue', text: minutes < 1 ? 'Due now' : `${span(minutes)} overdue`, exact };
  const text = minutes < 1 ? 'in under a minute' : `in ${span(minutes)}`;
  const status = days === 0 ? 'today' : ms <= 48 * 3_600_000 ? 'soon' : 'later';
  return { status, text, exact };
}

/** "Done today", "Done yesterday", "Done 3 Nov" for the Completed section. */
export function doneLabel(completedAt, todayKey) {
  if (!completedAt) return 'Done';
  const key = toDateKey(new Date(completedAt));
  const diff = dayDiff(todayKey, key);
  if (diff === 0) return 'Done today';
  if (diff === -1) return 'Done yesterday';
  return `Done ${shortDay.format(fromDateKey(key))}`;
}

/** "just now", "5 min ago", "3 hours ago", "yesterday", "12 days ago", "3 Nov" */
export function timeAgo(ms, nowMs = Date.now()) {
  if (!ms) return '';
  const minutes = Math.floor((nowMs - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = dayDiff(toDateKey(new Date(ms)), toDateKey(new Date(nowMs)));
  if (days <= 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return shortDay.format(new Date(ms));
}
