'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();
const t = (id, over = {}) => ({ id, text: id, done: false, deadline: null, ...over });

test('ticker order: overdue (most late first), then nearest deadline, then list order', async () => {
  const { tickerItems } = await import('../src/lib/ticker.js');
  const now = at(2026, 11, 12, 10, 0);
  const tasks = [
    t('plain-1'),
    t('due-next-week', { deadline: '2026-11-19' }),
    t('done', { done: true, deadline: '2026-11-01' }),
    t('late-1h', { deadline: '2026-11-12T09:00' }),
    t('due-in-2h', { deadline: '2026-11-12T12:00' }),
    t('late-2-days', { deadline: '2026-11-10' }),
    t('plain-2'),
    t('due-tomorrow', { deadline: '2026-11-13' }),
  ];
  assert.deepEqual(
    tickerItems(tasks, now).map((i) => i.task.id),
    ['late-2-days', 'late-1h', 'due-in-2h', 'due-tomorrow', 'due-next-week', 'plain-1', 'plain-2'],
  );
});

test('ticker is empty when everything is done', async () => {
  const { tickerItems } = await import('../src/lib/ticker.js');
  assert.equal(tickerItems([t('a', { done: true })], Date.now()).length, 0);
});
