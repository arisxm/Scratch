'use strict';
// End-to-end smoke test. Drives the real app (real windows, real preload, real
// IPC, real disk writes) and records each check. Only loaded when
// STICKY_SMOKE_TEST=1; excluded from the installer. See scripts/smoke.sh.

const fs = require('node:fs');
const path = require('node:path');
const { screen } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 8000, every = 50, label = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${label} (last: ${last})`);
}

// Text and Enter must go through the same input channel. webContents.insertText
// and sendInputEvent are separate IPC paths with no ordering guarantee: traced
// in the renderer, the Enter keydown landed before the inserted text, so the
// app saw Enter on an empty field. Typing char-by-char keeps the real order.
function typeText(win, text) {
  for (const ch of text) win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
}

function typeLine(win, text) {
  typeText(win, text);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
}

async function run(ctx) {
  const { app, store, noteWindows, launcherWin, newNote, setAlwaysOnTop, checkReminders, reminderLog, testHooks, pomodoro, setAllOpacity, windows } = ctx;
  const phase = process.env.STICKY_SMOKE_PHASE || '1';
  const outDir = process.env.STICKY_SMOKE_OUT || process.cwd();
  const results = [];
  const consoleErrors = [];
  // Printed as they happen, so a hang shows exactly how far the run got.
  const check = (name, pass, detail = '') => {
    results.push({ name, pass: !!pass, detail: String(detail) });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : `  -> ${detail}`}`);
  };
  const step = (text) => console.log(`STEP  ${text}`);

  const js = (win, code) => win.webContents.executeJavaScript(code, true);
  // For clicks that close the clicked window: the window can be gone before
  // it replies, and awaiting that reply hung the run (seen at each such click).
  const clickToClose = (win, selector) => {
    js(win, `document.querySelector(${JSON.stringify(selector)}).click()`).catch(() => {});
  };
  const watchConsole = (win, label) =>
    win.webContents.on('console-message', (event) => {
      const level = event.level ?? event.params?.level;
      const message = event.message ?? event.params?.message;
      if (level === 'error' || level === 3) consoleErrors.push(`${label}: ${message}`);
    });
  const ready = (win, selector) =>
    waitFor(() => js(win, `!!document.querySelector(${JSON.stringify(selector)})`), { label: selector });
  // Let animations finish and force a fresh frame first: without this some
  // captures were stale (an earlier state of the window than the DOM showed).
  const shot = async (win, name) => {
    win.moveTop();
    await sleep(350);
    win.webContents.invalidate();
    await sleep(60);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
  };

  try {
    watchConsole(launcherWin, 'launcher');
    for (const win of noteWindows.values()) watchConsole(win, 'note');
    await ready(launcherWin, '.pad');
    check('launcher renders the + pad', true);

    if (phase === '1') {
      // ---- first run
      check('first run creates a welcome note', store.data.notes.length === 1, store.data.notes.length);
      const welcomeWin = [...noteWindows.values()][0];
      await ready(welcomeWin, '.task');
      check('welcome note shows 5 tasks', (await js(welcomeWin, `document.querySelectorAll('.task').length`)) === 5);
      check('welcome note is always on top', welcomeWin.isAlwaysOnTop());
      check('note window is frameless + transparent-friendly', !welcomeWin.isResizable());

      const isolation = await js(
        welcomeWin,
        `JSON.stringify({ require: typeof require, process: typeof process, api: Object.keys(window.sticky).sort() })`,
      );
      check(
        'renderer has no Node access, only the sticky API',
        isolation === JSON.stringify({ require: 'undefined', process: 'undefined', api: ['about', 'app', 'hidden', 'note', 'settings', 'timer'] }),
        isolation,
      );
      check(
        'fonts are bundled (offline)',
        await js(welcomeWin, `document.fonts.ready.then(() => document.fonts.check('26px "Caveat Variable"'))`),
      );
      await shot(welcomeWin, 'shot-welcome');

      // ---- create a note through the same path as the + button
      await js(launcherWin, `document.querySelector('.pad').click()`);
      const note = await waitFor(() => store.data.notes.length === 2 && store.data.notes[1], { label: 'new note' });
      const win = noteWindows.get(note.id);
      watchConsole(win, 'note2');
      await ready(win, '.task-input input');
      check('+ pad creates a note with the next pastel color', note.color === 'pink', note.color);

      // ---- type a task and press Enter (real keyboard events)
      win.focus();
      win.webContents.focus();
      await js(win, `document.querySelector('.task-input input').focus()`);
      typeLine(win, 'Buy milk');
      await waitFor(() => note.tasks.length === 1, { label: 'task saved in main' });
      check('Enter adds a task and it reaches the store', note.tasks[0].text === 'Buy milk', note.tasks[0]?.text);
      check('input clears after adding', (await js(win, `document.querySelector('.task-input input').value`)) === '');

      // ---- check it off: strikethrough animates to full width, text fades
      await js(win, `document.querySelector('.task .check').click()`);
      await waitFor(() => note.tasks[0].done, { label: 'done saved' });
      const midway = await js(win, `getComputedStyle(document.querySelector('.strike')).backgroundSize`);
      await sleep(700);
      const struck = await js(
        win,
        `(() => { const s = document.querySelector('.strike'); return getComputedStyle(s).backgroundSize + '|' + getComputedStyle(s.parentElement).color })()`,
      );
      check('checking a task saves done=true', note.tasks[0].done && typeof note.tasks[0].completedAt === 'number');
      check('strikethrough is animating (not instant)', midway !== '100% 8px', `mid-transition: ${midway}`);
      check('strikethrough ends at full width', struck.startsWith('100% 8px'), struck);
      check('completed text is faded', /rgba\(39, 48, 74, 0\.4\)/.test(struck), struck);
      await shot(win, 'shot-checked');

      // ---- history: the completed task moves to the Completed section instead of vanishing
      const activeTasks = `document.querySelectorAll('.task-scroll > .task-list .task').length`;
      await waitFor(async () => (await js(win, activeTasks)) === 0 && (await js(win, `!!document.querySelector('.history-toggle')`)), {
        label: 'task moved to history',
        timeout: 4000,
      });
      check('a completed task moves to the Completed section, not deleted', note.tasks.length === 1 && note.tasks[0].done);
      const historyHead = await js(win, `document.querySelector('.history-toggle').getAttribute('aria-expanded') + '|' + document.querySelector('.history-count').textContent`);
      check('Completed section starts folded and shows a count', historyHead === 'false|1', historyHead);
      const ringLabel = await js(win, `document.querySelector('.ring').getAttribute('aria-label')`);
      check('progress ring reports completed out of total', ringLabel === '1 of 1 tasks done (100%)', ringLabel);
      await js(win, `document.querySelector('.history-toggle').click()`);
      await ready(win, '.history-list .task');
      await waitFor(() => note.historyOpen === true, { label: 'history open saved' });
      const doneWhen = await js(win, `document.querySelector('.history-list .done-label').textContent`);
      check('history shows when the task was completed', doneWhen === 'Done today', doneWhen);
      await shot(win, 'shot-history');

      // ---- uncheck in history: back on the list, stroke retracts
      await js(win, `document.querySelector('.history-list .check').click()`);
      await waitFor(() => !note.tasks[0].done, { label: 'undone saved' });
      await waitFor(async () => (await js(win, activeTasks)) === 1, { label: 'task back on the list' });
      await sleep(700);
      const restored = await js(win, `getComputedStyle(document.querySelector('.strike')).backgroundSize`);
      check('unchecking in history restores the task', restored.startsWith('0% 8px') && note.tasks[0].completedAt === null, restored);
      const ringAfter = await js(win, `document.querySelector('.ring').getAttribute('aria-label')`);
      check('progress ring updates when a task is reopened', ringAfter === '0 of 1 tasks done (0%)', ringAfter);

      // ---- title edit
      await js(win, `document.querySelector('.note-title').focus()`);
      typeText(win, 'Errands');
      await waitFor(() => note.title === 'Errands', { label: 'title saved' });
      check('title edits are saved', true);

      // ---- inline edit: Enter saves, Escape cancels
      const dbl = `document.querySelector('.task-text').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`;
      await js(win, dbl);
      await ready(win, '.task-edit');
      await js(win, `document.querySelector('.task-edit').select()`);
      typeLine(win, 'Buy oat milk');
      await waitFor(() => note.tasks[0].text === 'Buy oat milk', { label: 'edit saved', timeout: 3000 });
      check('double-click edit + Enter saves', true);
      await js(win, dbl);
      await ready(win, '.task-edit');
      typeText(win, ' and eggs');
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await waitFor(() => js(win, `!document.querySelector('.task-edit')`), { label: 'edit closed', timeout: 3000 });
      await sleep(150);
      check('Escape cancels an edit', note.tasks[0].text === 'Buy oat milk', note.tasks[0].text);
      await js(win, dbl);
      await ready(win, '.task-edit');
      await js(win, `document.querySelector('.task-edit').select()`);
      typeLine(win, 'Buy milk');
      await waitFor(() => note.tasks[0].text === 'Buy milk', { label: 'edit restored', timeout: 3000 });

      // ---- second task, then delete it
      await js(win, `document.querySelector('.task-input input').focus()`);
      typeLine(win, 'Call the bank');
      await waitFor(() => note.tasks.length === 2, { label: 'second task' });
      await js(win, `document.querySelectorAll('.task')[1].querySelector('.danger').click()`);
      await waitFor(() => note.tasks.length === 1, { label: 'task deleted', timeout: 2000 });
      check('delete removes a single task', note.tasks[0].text === 'Buy milk');

      // ---- the + button adds what has been typed (and does nothing on an empty field)
      await js(win, `document.querySelector('.task-input input').focus()`);
      await js(win, `document.querySelector('.task-input-add').click()`);
      await sleep(200);
      check('the + button does nothing while the field is empty', note.tasks.length === 1);
      typeText(win, 'Pay rent');
      await waitFor(() => js(win, `document.querySelector('.task-input').classList.contains('has-text')`), { label: '+ turns into a button' });
      await js(win, `document.querySelector('.task-input-add').click()`);
      await waitFor(() => note.tasks.length === 2, { label: 'task added with +' });
      check('the + button adds the typed task and clears the field', note.tasks[1].text === 'Pay rent' && (await js(win, `document.querySelector('.task-input input').value`)) === '', note.tasks[1]?.text);
      await js(win, `document.querySelectorAll('.task')[1].querySelector('.danger').click()`);
      await waitFor(() => note.tasks.length === 1, { label: 'extra task deleted', timeout: 2000 });

      // ---- monthly mode + per-task deadline
      const pillAt = () => js(win, `parseFloat(document.querySelector('.mode-switch').style.getPropertyValue('--pill-x'))`);
      const pillDay = await pillAt();
      await js(win, `[...document.querySelectorAll('.mode-switch button')][1].click()`);
      await waitFor(() => note.mode === 'monthly', { label: 'monthly saved' });
      await waitFor(async () => (await pillAt()) > pillDay + 10, { label: 'pill rolls to Month' });
      check('the white pill moves to the active tab', true);
      check('Day/Month switch selects Month', (await js(win, `document.querySelector('.mode-switch button[aria-checked="true"]').textContent`)) === 'Month');
      win.webContents.send('note:changed', { ...note, tasks: [{ ...note.tasks[0], deadline: '2026-01-01' }] });
      await ready(win, '.deadline-overdue');
      check('past deadlines are flagged as overdue', true);
      await js(win, `[...document.querySelectorAll('.mode-switch button')][0].click()`);
      await waitFor(() => note.mode === 'daily', { label: 'daily saved' });

      // ---- deadlines: inline editor, countdown chip, reminders
      const pad = (n) => String(n).padStart(2, '0');
      const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const stamp = (d) => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const setField = (type, value) =>
        js(
          win,
          `(() => { const el = document.querySelector('.deadline-fields input[type="${type}"]');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
            el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
        );
      const chip = () => js(win, `(() => { const c = document.querySelector('.deadline'); return c ? c.textContent + '|' + c.className : null })()`);
      const closeEditor = async () => {
        await js(win, `[...document.querySelectorAll('.deadline-buttons button')].pop().click()`);
        await waitFor(() => js(win, `!document.querySelector('.deadline-editor')`), { label: 'editor closed' });
      };

      await js(win, `document.querySelector('.deadline').click()`);
      await ready(win, '.deadline-editor');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      await js(win, `[...document.querySelectorAll('.deadline-quick button')][1].click()`);
      await waitFor(() => note.tasks[0].deadline === dayKey(tomorrow), { label: 'deadline saved', timeout: 3000 });
      await shot(win, 'shot-deadline-editor');
      await closeEditor();
      check('quick-pick "Tomorrow" saves a day deadline', (await chip()) === 'Tomorrow|deadline deadline-soon', await chip());

      const in90 = new Date(Date.now() + 90 * 60_000);
      await js(win, `document.querySelector('.deadline').click()`);
      await ready(win, '.deadline-editor');
      await setField('date', dayKey(in90));
      await waitFor(() => note.tasks[0].deadline === dayKey(in90), { label: 'date field saved', timeout: 3000 });
      await setField('time', stamp(in90).slice(11));
      await waitFor(() => note.tasks[0].deadline === stamp(in90), { label: 'time field saved', timeout: 3000 });
      await closeEditor();
      const countdown = await chip();
      check('timed deadline shows a live countdown', /^in 1h (2[89]|30)m\|/.test(countdown), countdown);
      await shot(win, 'shot-countdown');

      // overdue: push a deadline 3 hours in the past through the normal update path
      const task0 = () => ({ ...note.tasks[0] });
      const send = async (tasks) => {
        await js(win, `window.sticky.note.update({ tasks: ${JSON.stringify(tasks)} })`);
        await sleep(150);
        win.webContents.send('note:changed', { ...note });
        await sleep(150);
      };
      const logged = reminderLog.length;
      await send([{ ...task0(), deadline: stamp(new Date(Math.floor(Date.now() / 60_000) * 60_000 - 3 * 3_600_000)), reminded: true }]);
      check('a note window cannot pre-mark a reminder as shown', note.tasks[0].reminded === false);
      const overdueChip = await chip();
      // minute-aligned deadline: 3h plus 0-59s late, so "3h" unless a minute ticks over mid-test
      check('overdue task shows how late it is, in red', /^3h( 1m)? overdue\|deadline deadline-overdue$/.test(overdueChip), overdueChip);
      check('footer counts overdue tasks', (await js(win, `document.querySelector('.overdue-tally')?.textContent`)) === '1 overdue');
      await shot(win, 'shot-overdue');

      checkReminders();
      checkReminders();
      const fired = reminderLog.slice(logged);
      check('an arrived deadline is announced exactly once', fired.length === 1 && fired[0].title === 'Task overdue' && fired[0].body.startsWith('Buy milk'), JSON.stringify(fired));
      await send([task0()]);
      check('reminder stays marked when the task is saved again', note.tasks[0].reminded === true);
      await send([{ ...task0(), deadline: stamp(new Date(Date.now() - 60_000)) }]);
      check('changing the deadline re-arms the reminder', note.tasks[0].reminded === false, JSON.stringify({ task: note.tasks[0], log: reminderLog.slice(logged), sinceStart: Math.round(process.uptime() * 1000) }));
      checkReminders();
      check('a just-arrived deadline says "due now"', reminderLog.length === logged + 2 && reminderLog.at(-1).title === 'Task due now', JSON.stringify(reminderLog.slice(logged)));
      await send([{ ...task0(), done: true, deadline: stamp(new Date(Date.now() - 7_200_000)) }]);
      checkReminders();
      check('completed tasks never remind', reminderLog.length === logged + 2);
      check('completed task chip shows the date, not a countdown', /deadline-done$/.test(await chip()), await chip());
      await send([{ ...task0(), done: false, completedAt: null, deadline: null }]);
      check('deadline can be removed', note.tasks[0].deadline === null && (await chip()) === null);

      // ---- untrusted patch from the renderer is filtered
      const before = JSON.stringify({ b: note.bounds, h: note.hidden, id: note.id });
      await js(win, `window.sticky.note.update({ hidden: true, id: 'evil', bounds: { x: 1, y: 1, width: 5, height: 5 }, color: 'black' })`);
      await sleep(150);
      check(
        'renderer cannot change protected fields',
        JSON.stringify({ b: note.bounds, h: note.hidden, id: note.id }) === before && note.color === 'pink',
      );

      // ---- collapse / expand
      const tall = win.getBounds().height;
      await js(win, `document.querySelector('[aria-label="Collapse note"]').click()`);
      await waitFor(() => win.getBounds().height === 68, { label: 'collapsed height' });
      check('collapse shrinks the note to its strip', note.collapsed === true);
      await shot(win, 'shot-collapsed');
      await js(win, `document.querySelector('[aria-label="Expand note"]').click()`);
      await waitFor(() => win.getBounds().height === tall, { label: 'expanded height' });
      check('expand restores the previous height', note.collapsed === false);

      // ---- resize via the corner grip's IPC, clamped to minimum
      await js(win, `window.sticky.note.resize({ width: 380, height: 420 })`);
      await waitFor(() => win.getBounds().width === 380, { label: 'resize' });
      await js(win, `window.sticky.note.resize({ width: 10, height: 10 })`);
      await waitFor(() => win.getBounds().width === 230, { label: 'min clamp' });
      check('resize works and respects the minimum size', note.bounds.width === 230 && note.bounds.height === 200);
      await js(win, `window.sticky.note.resize({ width: 300, height: 360 })`);

      // ---- dragged off-screen: snapped back inside the work area and saved
      win.setPosition(-4000, -4000);
      if (process.platform === 'win32') win.emit('moved'); // on Windows only a real drag fires 'moved'
      const wa = screen.getPrimaryDisplay().workArea;
      await waitFor(
        () => {
          const b = win.getBounds();
          return b.x >= wa.x && b.y >= wa.y && note.bounds.x === b.x && note.bounds.y === b.y;
        },
        { label: 'clamped back on screen', timeout: 3000 },
      );
      check('notes stay inside the desktop and positions are saved', true, JSON.stringify(note.bounds));
      win.setPosition(wa.x + 40, wa.y + 50);
      if (process.platform === 'win32') win.emit('moved');
      await waitFor(() => note.bounds.x === wa.x + 40 && note.bounds.y === wa.y + 50, { label: 'position saved' });

      // ---- always-on-top toggle reaches every window
      setAlwaysOnTop(false);
      check('always-on-top can be turned off', !win.isAlwaysOnTop() && !launcherWin.isAlwaysOnTop());
      setAlwaysOnTop(true);
      check('always-on-top can be turned back on', win.isAlwaysOnTop() && launcherWin.isAlwaysOnTop());

      // ---- transparency: slider in the colour popover, clamped, and "all notes" from the menu
      const setRange = (value) =>
        js(
          win,
          `(() => { const el = document.querySelector('.opacity-row input');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '${value}');
            el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
        );
      await js(win, `document.querySelector('[data-palette-toggle]').click()`);
      await ready(win, '.opacity-row input');
      await setRange(60);
      await waitFor(() => note.opacity === 0.6, { label: 'opacity saved', timeout: 3000 });
      check('opacity slider saves per note', (await js(win, `document.querySelector('.opacity-row output').textContent`)) === '60%', `window opacity now ${win.getOpacity()}`);
      await shot(win, 'shot-palette');
      await js(win, `window.sticky.note.update({ opacity: 0.01 })`);
      await waitFor(() => note.opacity === 0.3, { label: 'opacity clamped', timeout: 3000 });
      check('a note can never be made fully invisible (30% floor)', true);
      setAllOpacity(0.85);
      check('"Transparency for all notes" applies to every note', store.data.notes.every((n) => n.opacity === 0.85));
      await waitFor(async () => (await js(win, `document.querySelector('.opacity-row output').textContent`)) === '85%', { label: 'slider follows', timeout: 3000 });
      setAllOpacity(1);
      await js(win, `document.querySelector('[data-palette-toggle]').click()`);

      // ---- hidden-notes manager: individual + bulk restore and delete
      const hiddenCount = () => store.data.notes.filter((n) => n.hidden).length;
      const makeHidden = async (title) => {
        const n = newNote({ title, color: 'mint', tasks: [{ id: `${title}-1`, text: `${title} task` }] });
        await waitFor(() => noteWindows.get(n.id), { label: `${title} window` });
        return n;
      };
      const hide = async (n) => {
        noteWindows.get(n.id).close();
        await waitFor(() => n.hidden && !noteWindows.has(n.id), { label: `${n.title} hidden` });
      };
      const [nA, nB, nC, nD] = [await makeHidden('Alpha'), await makeHidden('Bravo'), await makeHidden('Charlie'), await makeHidden('Delta')];
      for (const n of [nA, nB, nC, nD]) await hide(n);
      check('closing notes hides them and stamps when', hiddenCount() === 4 && [nA, nB, nC, nD].every((n) => typeof n.hiddenAt === 'number'));
      await waitFor(async () => (await js(launcherWin, `document.querySelector('.launcher-badge')?.textContent`)) === '4', { label: 'launcher badge', timeout: 3000 });
      check('launcher shows how many notes are hidden', true);

      await js(launcherWin, `document.querySelector('[data-action="hidden"]').click()`);
      const mgr = await waitFor(() => windows().managerWin, { label: 'manager window' });
      watchConsole(mgr, 'manager');
      await ready(mgr, '.manager-row');
      const rows = () => js(mgr, `[...document.querySelectorAll('.manager-row .row-title')].map((e) => e.textContent).join(',')`);
      const rowsAre = (expected, label) => waitFor(async () => (await rows()) === expected, { label, timeout: 4000 });
      check('manager lists hidden notes, most recently hidden first', (await rows()) === 'Delta,Charlie,Bravo,Alpha', await rows());
      const tickRow = (title) => js(mgr, `[...document.querySelectorAll('.manager-row')].find((r) => r.querySelector('.row-title').textContent === '${title}').querySelector('input').click()`);
      const rowButton = (title, i) => js(mgr, `[...document.querySelectorAll('.manager-row')].find((r) => r.querySelector('.row-title').textContent === '${title}').querySelectorAll('.row-actions button')[${i}].click()`);
      const press = (action) => js(mgr, `document.querySelector('[data-action="${action}"]').click()`);
      const selectLabel = () => js(mgr, `document.querySelector('.select-all span').textContent`);
      check('bulk buttons are disabled until something is selected', await js(mgr, `document.querySelector('[data-action="delete-selected"]').disabled && document.querySelector('[data-action="restore-selected"]').disabled`));

      await tickRow('Alpha');
      await waitFor(async () => (await selectLabel()) === '1 selected', { label: 'one selected' });
      await shot(mgr, 'shot-manager');
      await press('restore-selected');
      await rowsAre('Delta,Charlie,Bravo', 'Alpha restored');
      check('restore selected: note is back on the desktop', !nA.hidden && noteWindows.has(nA.id) && hiddenCount() === 3);

      const asked = [];
      testHooks.confirm = (opts) => { asked.push(opts.message); return false; };
      await rowButton('Bravo', 1);
      await waitFor(() => asked.length === 1, { label: 'confirmation asked' });
      await sleep(200);
      check('delete asks first, and Cancel keeps the note', asked[0] === 'Delete “Bravo”?' && hiddenCount() === 3 && !!store.getNote(nB.id), asked[0]);
      testHooks.confirm = (opts) => { asked.push(opts.message); return true; };
      await rowButton('Bravo', 1);
      await rowsAre('Delta,Charlie', 'Bravo deleted');
      check('delete one hidden note', !store.getNote(nB.id) && hiddenCount() === 2);

      await hide(nA);
      await rowsAre('Alpha,Delta,Charlie', 'Alpha hidden again');
      await js(mgr, `document.querySelector('.select-all input').click()`);
      await waitFor(async () => (await selectLabel()) === '3 selected', { label: 'select all' });
      check('Select all ticks every hidden note', (await js(mgr, `document.querySelectorAll('.manager-row.is-selected').length`)) === 3);
      await tickRow('Alpha');
      await waitFor(async () => (await selectLabel()) === '2 selected', { label: 'untick one' });
      await press('delete-selected');
      await rowsAre('Alpha', 'two deleted');
      check('delete selected removes exactly the ticked notes', asked.at(-1) === 'Delete 2 notes?' && !store.getNote(nC.id) && !store.getNote(nD.id) && !!store.getNote(nA.id), asked.at(-1));

      const nE = await makeHidden('Echo');
      await hide(nE);
      await rowsAre('Echo,Alpha', 'Echo hidden');
      await press('restore-all');
      await ready(mgr, '.manager-empty');
      check('restore all brings every hidden note back', hiddenCount() === 0 && noteWindows.has(nA.id) && noteWindows.has(nE.id));
      await shot(mgr, 'shot-manager-empty');

      await hide(nA);
      await hide(nE);
      await rowsAre('Echo,Alpha', 'both hidden again');
      await press('delete-all');
      await ready(mgr, '.manager-empty');
      check('delete all hidden notes, after one confirmation', asked.at(-1) === 'Delete all 2 hidden notes?' && hiddenCount() === 0 && store.data.notes.length === 2, asked.at(-1));
      testHooks.confirm = null;

      const sneaky = await js(win, `Promise.all([window.sticky.hidden.list(), window.sticky.hidden.remove(['${note.id}']), window.sticky.hidden.restore(['${note.id}'])]).then(JSON.stringify)`);
      check('only the manager window can use the hidden-notes controls', sneaky === '[[],0,0]', sneaky);
      clickToClose(mgr, '[aria-label="Close"]');
      await waitFor(() => !windows().managerWin, { label: 'manager closed' });

      // ---- Pomodoro (phases shortened by scripts/smoke.sh: 3 s focus, 1.2 s break)
      await js(launcherWin, `document.querySelector('[data-action="timer"]').click()`);
      const tw = await waitFor(() => windows().timerWin, { label: 'timer window' });
      watchConsole(tw, 'timer');
      await ready(tw, '.timer-time');
      const face = () => js(tw, `document.querySelector('.timer-phase').textContent + '|' + document.querySelector('[data-action="primary"]').textContent.trim()`);
      check('timer opens ready for a focus session', (await face()) === 'Focus|Start' && pomodoro.snapshot().status === 'idle', await face());
      await js(win, `window.sticky.timer.command('start')`);
      await sleep(150);
      check('only the timer window can control the timer', pomodoro.snapshot().status === 'idle');

      await js(tw, `document.querySelector('[data-action="primary"]').click()`);
      await waitFor(() => pomodoro.snapshot().status === 'running', { label: 'timer running' });
      // click Pause only once the button has redrawn; clicking early re-sends "start"
      await waitFor(async () => (await face()) === 'Focus|Pause', { label: 'button shows Pause', timeout: 2000 });
      await js(tw, `document.querySelector('[data-action="primary"]').click()`);
      await waitFor(() => pomodoro.snapshot().status === 'paused', { label: 'timer paused' });
      const frozen = pomodoro.snapshot().remainingMs;
      await sleep(400);
      check('pause freezes the countdown', pomodoro.snapshot().remainingMs === frozen && (await face()) === 'Focus|Resume', await face());
      await shot(tw, 'shot-timer');

      const toasts = reminderLog.length;
      await js(tw, `document.querySelector('[data-action="primary"]').click()`);
      await waitFor(() => pomodoro.snapshot().phase === 'break', { label: 'focus finished', timeout: 5000 });
      check('finishing focus announces it and starts the break', reminderLog[toasts]?.title === 'Focus session finished' && pomodoro.snapshot().status === 'running', JSON.stringify(reminderLog.slice(toasts)));
      check('finished focus sessions are counted for today', store.data.settings.pomodoro.count === 1);
      await waitFor(async () => (await face()).startsWith('Break|'), { label: 'break shown' });
      await shot(tw, 'shot-timer-break');
      step('waiting for break to finish');
      await waitFor(() => pomodoro.snapshot().phase === 'focus', { label: 'break finished', timeout: 5000 });
      check('finishing the break announces it and waits for you', reminderLog[toasts + 1]?.title === 'Break is over' && pomodoro.snapshot().status === 'idle');
      step('waiting for session count in the timer window');
      await waitFor(async () => (await js(tw, `document.querySelector('.timer-sessions').textContent`)) === '1 session today', { label: 'session count shown' });
      step('closing timer window');
      clickToClose(tw, '[aria-label="Close Pomodoro"]');
      await waitFor(() => !windows().timerWin, { label: 'timer closed' });

      {
      // ---- Settings window: opens, mirrors the app's options, writes them back
      ctx.openSettings();
      const setWin = await waitFor(() => ctx.windows().settingsWin, { label: 'settings window' });
      watchConsole(setWin, 'settings');
      await ready(setWin, '.switch');
      const sw = (label) => `document.querySelector('.switch[aria-label="${label}"]')`;
      const isOn = (label) => js(setWin, `${sw(label)}.getAttribute('aria-checked') === 'true'`);
      check(
        'Settings shows the current options',
        (await isOn('Keep notes on top')) === store.data.settings.alwaysOnTop && (await isOn('Deadline reminders')) === store.data.settings.reminders && (await isOn('Animations')) === true,
      );
      const titleBefore = await js(setWin, `document.querySelector('.panel-header h1').textContent`);
      check('Settings window is titled Settings', titleBefore === 'Settings', titleBefore);
      await shot(setWin, 'shot-settings');

      await js(setWin, `${sw('Rotating tasks in note headers')}.click()`);
      await waitFor(() => store.data.settings.ticker === false, { label: 'ticker switched off' });
      await js(setWin, `${sw('Rotating tasks in note headers')}.click()`);
      await waitFor(() => store.data.settings.ticker === true, { label: 'ticker back on' });
      check('a Settings switch changes the same option the menu uses', true);

      await js(setWin, `${sw('Collapse notes at launch')}.click()`);
      await waitFor(() => store.data.settings.startCollapsed === true, { label: 'collapse at launch saved' });
      await js(setWin, `${sw('Notification sound')}.click()`);
      await waitFor(() => store.data.settings.notifySound === false, { label: 'sound saved' });
      check('startup and notification options are saved', store.data.settings.startCollapsed && !store.data.settings.notifySound);

      // new notes in a fixed colour
      await js(setWin, `document.querySelector('.color-choice [aria-label="Mint"]').click()`);
      await waitFor(() => store.data.settings.newNoteColor === 'mint', { label: 'new-note colour saved' });
      const cursorBefore = store.data.settings.colorCursor;
      const mintNote = newNote({ mode: 'daily' });
      check('a fixed new-note colour is used and the rotation is left alone', mintNote.color === 'mint' && store.data.settings.colorCursor === cursorBefore, `${mintNote.color} ${store.data.settings.colorCursor}`);
      store.deleteNote(mintNote.id);
      noteWindows.get(mintNote.id)?.destroy();
      await js(setWin, `document.querySelector('.color-choice .auto-chip').click()`);
      await waitFor(() => store.data.settings.newNoteColor === 'rotate', { label: 'colour back to auto' });

      // newer options: the + pad's note type, reminder hour, Pomodoro extras
      await js(setWin, `[...document.querySelectorAll('.segmented[aria-label="New notes start as"] button')].find((b) => b.textContent === 'Monthly goals').click()`);
      await waitFor(() => store.data.settings.newNoteMode === 'monthly', { label: 'new note type saved' });
      const padNotes = store.data.notes.length;
      const cursorBeforePad = store.data.settings.colorCursor;
      await js(launcherWin, `document.querySelector('.pad').click()`);
      const padNote = await waitFor(() => store.data.notes.length === padNotes + 1 && store.data.notes[padNotes], { label: 'note from the pad' });
      check('the + pad follows the "new notes start as" setting', padNote.mode === 'monthly', padNote.mode);
      store.deleteNote(padNote.id);
      noteWindows.get(padNote.id)?.destroy();
      store.data.settings.colorCursor = cursorBeforePad; // the pad advanced the rotation; put it back
      await js(setWin, `[...document.querySelectorAll('.segmented[aria-label="New notes start as"] button')].find((b) => b.textContent === 'Daily list').click()`);
      await waitFor(() => store.data.settings.newNoteMode === 'daily', { label: 'back to daily' });
      await js(setWin, `document.querySelector('.stepper[aria-label="Reminder hour"] [aria-label="Increase Reminder hour"]').click()`);
      await waitFor(() => store.data.settings.reminderHour === 10, { label: 'reminder hour saved' });
      await js(setWin, `${sw('Start the next focus session by itself')}.click()`);
      await waitFor(() => pomodoro.autoFocus === true, { label: 'auto focus reaches the timer' });
      await js(setWin, `${sw('Pomodoro alerts')}.click()`);
      await waitFor(() => store.data.settings.pomodoroNotify === false, { label: 'alerts off' });
      check('reminder hour, Pomodoro auto-start and alerts are saved', store.data.settings.reminderHour === 10 && store.data.settings.pomodoroAutoFocus && !store.data.settings.pomodoroNotify);
      await js(setWin, `${sw('Start the next focus session by itself')}.click()`);
      await js(setWin, `${sw('Pomodoro alerts')}.click()`);
      await js(setWin, `document.querySelector('.stepper[aria-label="Reminder hour"] [aria-label="Decrease Reminder hour"]').click()`);
      await waitFor(() => store.data.settings.reminderHour === 9 && store.data.settings.pomodoroNotify === true && pomodoro.autoFocus === false, { label: 'extras back to defaults' });

      // custom Pomodoro lengths, typed into the field
      await js(setWin, `(() => { const i = document.querySelector('.stepper[aria-label="Focus"] input'); i.focus(); })()`);
      setWin.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' });
      await waitFor(() => store.data.settings.pomodoroLengths.focusMin === 26, { label: 'focus length stepped' });
      await js(setWin, `document.querySelector('.stepper[aria-label="Focus"] [aria-label="Increase Focus"]').click()`);
      await waitFor(() => store.data.settings.pomodoroLengths.focusMin === 27, { label: 'focus length +' });
      check('Pomodoro length is custom and reaches the timer', pomodoro.durations.focus === 27 * 60_000, pomodoro.durations.focus);
      ctx.setPomodoroLengths({ focusMin: 9999, breakMin: 0 });
      check('Pomodoro lengths are clamped to their limits', store.data.settings.pomodoroLengths.focusMin === 180 && store.data.settings.pomodoroLengths.breakMin === 1, JSON.stringify(store.data.settings.pomodoroLengths));
      ctx.setPomodoroLengths({ focusMin: 40, breakMin: 10 });
      await js(win, `window.sticky.timer.setLengths({ focusMin: 99, breakMin: 9 })`);
      await sleep(150);
      check('other windows cannot change the lengths or settings', store.data.settings.pomodoroLengths.focusMin === 40);
      const topBefore = store.data.settings.alwaysOnTop;
      await js(win, `window.sticky.settings.set('scale', 1.5); window.sticky.settings.set('alwaysOnTop', ${!topBefore})`);
      await sleep(150);
      check('a note window cannot change settings', store.data.settings.scale === 1 && store.data.settings.alwaysOnTop === topBefore);

      // scale: windows and their content grow together, then return exactly
      const before = { note: win.getBounds(), launcher: launcherWin.getBounds(), stored: { ...note.bounds } };
      await js(setWin, `[...document.querySelectorAll('.segmented[aria-label="Size"] button')].find((b) => b.textContent === '125%').click()`);
      await waitFor(() => store.data.settings.scale === 1.25, { label: 'scale saved' });
      await waitFor(() => launcherWin.getBounds().width === 145, { label: 'launcher scaled' });
      const grown = win.getBounds();
      check('scale 125% enlarges notes and the launcher', grown.width === Math.round(before.note.width * 1.25) && launcherWin.getBounds().height === 180, `${grown.width}x${grown.height}`);
      check('a scaled note keeps its stored size at 100%', note.bounds.width === before.stored.width && note.bounds.height === before.stored.height, JSON.stringify(note.bounds));
      const outer = await js(win, `window.outerWidth + 'x' + window.outerHeight + '@' + window.devicePixelRatio`);
      check('the corner grip measures in screen pixels while scaled', outer.startsWith(`${grown.width}x${grown.height}@`), `${outer} for window ${grown.width}x${grown.height}`);
      const zoom = await js(win, `window.innerWidth`);
      check('note content scales with its window', Math.abs(zoom - before.note.width) < 3, `inner ${zoom} for window ${grown.width}`);
      await js(win, `window.sticky.note.resize({ width: 500, height: 450 })`);
      await waitFor(() => win.getBounds().width === 500, { label: 'resize while scaled' });
      check('resizing while scaled stores the 100% size', note.bounds.width === 400 && note.bounds.height === 360, JSON.stringify(note.bounds));
      await js(win, `window.sticky.note.resize({ width: ${grown.width}, height: ${grown.height} })`);
      await waitFor(() => win.getBounds().width === grown.width, { label: 'resized back' });
      await js(win, `document.querySelector('[aria-label="Collapse note"]').click()`);
      await waitFor(() => win.getBounds().height === Math.round(68 * 1.25), { label: 'collapsed while scaled' });
      await js(win, `document.querySelector('[aria-label="Expand note"]').click()`);
      await waitFor(() => win.getBounds().height > Math.round(68 * 1.25), { label: 'expanded while scaled' });
      check('collapse and expand work while scaled', note.collapsed === false);
      await shot(win, 'shot-scaled');
      await js(setWin, `[...document.querySelectorAll('.segmented[aria-label="Size"] button')].find((b) => b.textContent === '100%').click()`);
      await waitFor(() => store.data.settings.scale === 1 && launcherWin.getBounds().width === 116, { label: 'scale back to 100%' });
      check('back at 100% the note returns to its original size', win.getBounds().width === before.note.width && note.bounds.width === before.stored.width, `${win.getBounds().width} vs ${before.note.width}`);
      store.data.settings.startCollapsed = false; // leave notes as they were
      store.data.settings.notifySound = true;

      // animations: one switch turns motion off in every window
      await js(setWin, `${sw('Animations')}.click()`);
      await waitFor(() => store.data.settings.animations === false, { label: 'animations off' });
      await waitFor(async () => (await js(win, `document.documentElement.dataset.motion`)) === 'off', { label: 'note follows animations setting' });
      check('turning Animations off reaches every window', (await js(launcherWin, `document.documentElement.dataset.motion`)) === 'off');
      await js(setWin, `${sw('Animations')}.click()`);
      await waitFor(async () => (await js(win, `document.documentElement.dataset.motion`)) === 'on', { label: 'animations back on' });

      // restore defaults asks first, and leaves notes alone
      testHooks.confirm = () => false;
      await js(setWin, `document.querySelector('[data-action="reset"]').click()`);
      await sleep(200);
      check('Restore defaults does nothing when cancelled', store.data.settings.pomodoroLengths.focusMin === 40);
      testHooks.confirm = () => true;
      await js(setWin, `document.querySelector('[data-action="reset"]').click()`);
      await waitFor(() => store.data.settings.pomodoroLengths.focusMin === 25 && store.data.settings.scale === 1, { label: 'defaults restored' });
      check('Restore defaults resets options but keeps every note', store.data.notes.length >= 2 && store.data.settings.animations === true && store.data.settings.newNoteColor === 'rotate');
      testHooks.confirm = null;
      // what phase 2 expects to find after a restart
      ctx.setPomodoroLengths({ focusMin: 45, breakMin: 12 });
      await js(setWin, `document.querySelector('.color-choice [aria-label="Sky"]').click()`);
      await waitFor(() => store.data.settings.newNoteColor === 'sky', { label: 'sky saved' });
      clickToClose(setWin, '[aria-label="Close"]');
      await waitFor(() => setWin.isDestroyed(), { label: 'settings closed', timeout: 3000 });
      check('Settings closes itself', true);
      }

      step('hiding welcome note');
      // ---- hide the welcome note (close button path)
      const welcome = store.data.notes[0];
      clickToClose(welcomeWin, '[aria-label="Hide note"]');
      await waitFor(() => welcome.hidden && welcomeWin.isDestroyed(), { label: 'hidden' });
      check('close hides a note without deleting it', store.getNote(welcome.id) !== null);

      step('launcher screenshot');
      await shot(launcherWin, 'shot-launcher');
      step('launcher screenshot done');
      fs.writeFileSync(path.join(outDir, 'phase1-expected.json'), JSON.stringify({ id: note.id, bounds: note.bounds }));
    } else if (phase === 'ui') {
      // ---- phase ui: layout checks for the collapsed strip (user screenshots)
      const win = [...noteWindows.values()][0];
      const note = store.data.notes[0];
      await ready(win, '.task');
      await js(win, `document.querySelector('[aria-label="Collapse note"]').click()`);
      await waitFor(() => win.getBounds().height === 68, { label: 'collapsed' });
      await sleep(200);

      // D2: is any title glyph wider than the input box that clips it?
      const clipCheck = (text) =>
        js(
          win,
          `document.fonts.ready.then(() => {
            const el = document.querySelector('.note-title');
            const cs = getComputedStyle(el);
            const ctx = document.createElement('canvas').getContext('2d');
            ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
            const m = ctx.measureText(${JSON.stringify(text)});
            const box = el.getBoundingClientRect();
            const inkRight = box.left + parseFloat(cs.paddingLeft) + m.actualBoundingBoxRight;
            const sizer = el.parentElement, header = el.closest('.note-header');
            const hs = getComputedStyle(header);
            const room = (header.clientWidth - parseFloat(hs.paddingLeft) - parseFloat(hs.paddingRight)) * (parseFloat(getComputedStyle(sizer).maxWidth) / 100 || 1);
            const atMax = sizer.getBoundingClientRect().width >= room - 1;
            return JSON.stringify({ text: ${JSON.stringify(text)}, inkRight: +inkRight.toFixed(1), boxRight: +box.right.toFixed(1), clipped: inkRight > box.right - 0.5, atMax, ellipsis: cs.textOverflow });
          })`,
        );
      for (const t of ['', 'Errands', 'Groceries for Sunday']) {
        await js(win, `(() => { const el = document.querySelector('.note-title');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(t)});
          el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await sleep(120);
        const r = JSON.parse(await clipCheck(t || 'To do'));
        check(`title "${r.text}" fits, or truncates with an ellipsis only at its maximum width`, !r.clipped || (r.atMax && r.ellipsis === 'ellipsis'), JSON.stringify(r));
      }
      await js(win, `(() => { const el = document.querySelector('.note-title');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '');
        el.dispatchEvent(new Event('input', { bubbles: true })); })()`);

      // D3: tape inside the window, and opaque enough not to show the desktop
      const tape = JSON.parse(
        await js(
          win,
          `(() => { const t = document.querySelector('.tape'); if (!t) return 'null';
            const r = t.getBoundingClientRect(); const bg = getComputedStyle(t).backgroundColor;
            return JSON.stringify({ top: +r.top.toFixed(1), bg }); })()`,
        ),
      );
      check('tape is fully inside the window', tape && tape.top >= 0, JSON.stringify(tape));
      const alpha = tape ? Number((tape.bg.match(/rgba?\(([^)]+)\)/)[1].split(',')[3] ?? '1')) : 0;
      check('tape is opaque where it overhangs the note', alpha >= 0.95, tape && tape.bg);

      // D1: palette opened on a collapsed note must be fully visible
      await js(win, `document.querySelector('[data-palette-toggle]').click()`);
      await ready(win, '.palette');
      await sleep(300);
      const pal = JSON.parse(
        await js(
          win,
          `(() => { const r = document.querySelector('.palette').getBoundingClientRect();
            const s = document.querySelector('.palette input[type=range]');
            const sr = s ? s.getBoundingClientRect() : null;
            return JSON.stringify({ bottom: Math.round(r.bottom), slider: sr && Math.round(sr.bottom), inner: innerHeight }); })()`,
        ),
      );
      check('palette on a collapsed note is fully visible', pal.bottom <= pal.inner && pal.slider && pal.slider <= pal.inner, JSON.stringify(pal));
      check('the strip keeps its height while the window grows', (await js(win, `document.querySelector('.note').getBoundingClientRect().height`)) === 44);
      await shot(win, 'shot-ui-palette');
      await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      await sleep(400);
      check('closing the palette returns the note to its strip', win.getBounds().height === 68 && note.collapsed, win.getBounds().height);
      await shot(win, 'shot-ui-strip');

      // ---- ticker: rotates through unfinished tasks, most urgent first
      const line = () => js(win, `(() => { const l = document.querySelector('.ticker-line:not(.is-leaving)');
        return l ? l.querySelector('.ticker-text').textContent + '|' + (l.querySelector('.ticker-count')?.textContent ?? '') : null })()`);
      const widths = JSON.parse(await js(win, `JSON.stringify({
        sizer: Math.round(document.querySelector('.title-sizer').getBoundingClientRect().width),
        input: Math.round(document.querySelector('.note-title').getBoundingClientRect().width),
        textNeeds: Math.round(parseFloat(getComputedStyle(document.querySelector('.title-sizer'), '::after').width) || 0),
        tickerWindow: Math.round(document.querySelector('.ticker-window').getBoundingClientRect().width) })`));
      check('ticker has room to show the task (at least 90px on a 300px note)', widths.tickerWindow >= 90, JSON.stringify(widths));
      const visible = await js(win, `(() => { const t = document.querySelector('.ticker-line .ticker-text'); return t.getBoundingClientRect().width >= 60 && getComputedStyle(t).visibility === 'visible' })()`);
      check('ticker task text is actually visible (not squeezed to nothing)', visible);
      const overlap = JSON.parse(await js(win, `(() => {
        const tape = document.querySelector('.tape').getBoundingClientRect();
        const t = document.querySelector('.ticker-line .ticker-text');
        const r = t.getBoundingClientRect(); const fs = parseFloat(getComputedStyle(t).fontSize);
        const glyphTop = r.top + (r.height - fs) / 2;
        return JSON.stringify({ tapeBottom: +tape.bottom.toFixed(1), glyphTop: +glyphTop.toFixed(1), tapeTop: +tape.top.toFixed(1) }); })()`));
      check('tape does not cover the ticker text', overlap.tapeBottom <= overlap.glyphTop, JSON.stringify(overlap));
      check('tape is not cut off by the window edge', overlap.tapeTop >= 0, JSON.stringify(overlap));
      const first = await line();
      check('ticker shows the first unfinished task', first === `${note.tasks[0].text}|1/5`, first);
      await waitFor(async () => (await line()) === `${note.tasks[1].text}|2/5`, { label: 'ticker advanced', timeout: 6500 });
      check('ticker moves on to the next task by itself', true);
      check('ticker slides (animated, not an instant swap)', await js(win, `!!document.querySelector('.ticker-line.is-leaving') || !!document.querySelector('.ticker-line.is-entering')`));
      await shot(win, 'shot-ui-ticker');

      const late = new Date(Date.now() - 2 * 3_600_000 - 30_000);
      const p2 = (n) => String(n).padStart(2, '0');
      const lateKey = `${late.getFullYear()}-${p2(late.getMonth() + 1)}-${p2(late.getDate())}T${p2(late.getHours())}:${p2(late.getMinutes())}`;
      const tasks = note.tasks.map((t, i) => (i === 3 ? { ...t, deadline: lateKey } : i === 0 ? { ...t, done: true, completedAt: Date.now() } : t));
      await js(win, `window.sticky.note.update({ tasks: ${JSON.stringify(tasks)} })`);
      await sleep(150);
      win.webContents.send('note:changed', { ...JSON.parse(JSON.stringify(note)), ticker: true });
      await sleep(250);
      const urgent = await js(win, `(() => { const l = document.querySelector('.ticker-line:not(.is-leaving)'); return l.className + '|' + l.querySelector('.ticker-text').textContent + '|' + l.querySelector('.ticker-due').textContent })()`);
      check('overdue task jumps to the front, in red, with how late it is', urgent.includes('status-overdue') && urgent.includes(note.tasks[3].text) && /\|2h( 1m)? overdue$/.test(urgent), urgent);
      const countNow = await js(win, `document.querySelector('.ticker-line:not(.is-leaving) .ticker-count').textContent`);
      check('finished tasks drop out of the ticker', countNow === '1/4', countNow);
      const fit = JSON.parse(await js(win, `(() => {
        const meta = document.querySelector('.ticker-line:not(.is-leaving) .ticker-meta').getBoundingClientRect();
        const c = document.querySelector('.ticker-line:not(.is-leaving) .ticker-count').getBoundingClientRect();
        const view = document.querySelector('.ticker-window').getBoundingClientRect();
        const edge = Math.min(meta.right, view.right);
        const shownWhole = c.right <= edge + 0.5 && c.top < meta.bottom;
        const hiddenWhole = c.top >= meta.bottom;
        return JSON.stringify({ shownWhole, hiddenWhole, c: [Math.round(c.left), Math.round(c.right)], meta: Math.round(meta.right), view: Math.round(view.right) }); })()`));
      check('position counter is shown whole or not at all (never cut off)', fit.shownWhole || fit.hiddenWhole, JSON.stringify(fit));
      await shot(win, 'shot-ui-ticker-overdue');
      await waitFor(async () => (await js(win, `document.querySelector('.ticker-line:not(.is-leaving) .ticker-count')?.textContent`)) === '2/4', { label: 'rotated to 2/4', timeout: 6500 });
      await js(win, `window.dispatchEvent(new Event('focus'))`); // makes useNow() refresh the clock
      await sleep(300);
      const afterTick = await js(win, `document.querySelector('.ticker-line:not(.is-leaving) .ticker-count').textContent`);
      check('a clock refresh does not restart the rotation', afterTick === '2/4', afterTick);

      win.webContents.send('note:changed', { ...JSON.parse(JSON.stringify(note)), ticker: false });
      await sleep(200);
      check('ticker can be switched off (count chip comes back)', await js(win, `!document.querySelector('.ticker') && !!document.querySelector('.collapsed-count')`));
      win.webContents.send('note:changed', { ...JSON.parse(JSON.stringify(note)), ticker: true });
      await sleep(200);

      await js(win, `document.querySelector('[aria-label="Expand note"]').click()`);
      await waitFor(() => win.getBounds().height > 68, { label: 'expanded' });
      await sleep(300);
      const weights = JSON.parse(await js(win, `(() => {
        const w = (sel) => { const el = document.querySelector(sel); return el ? Number(getComputedStyle(el).fontWeight) : null; };
        return JSON.stringify({ title: w('.note-title'), task: w('.task-text'), tickerTask: w('.ticker-text'), tickerMeta: w('.ticker-meta'),
          addTask: w('.task-input input'), dateLabel: w('.period-label'), footer: w('.note-footer') }); })()`));
      const want = { title: 700, task: 500, tickerTask: 600, tickerMeta: 500, addTask: 500, dateLabel: 600, footer: 500 };
      const light = Object.keys(want).filter((k) => !(weights[k] >= want[k]));
      check('text is bold enough everywhere', light.length === 0, `too light: ${light.map((k) => `${k} ${weights[k]} < ${want[k]}`).join(', ')}`);
      check('ticker also runs on an open note', await js(win, `!!document.querySelector('.ticker-line')`));
      await shot(win, 'shot-ui-open');
    } else {
      // ---- phase 2: relaunch with the same data folder
      const expected = JSON.parse(fs.readFileSync(path.join(outDir, 'phase1-expected.json'), 'utf8'));
      const note = store.getNote(expected.id);
      check('note survives restart', !!note);
      check('title, color and tasks survive restart', note && note.title === 'Errands' && note.color === 'pink' && note.tasks[0]?.text === 'Buy milk');
      check('hidden note stays hidden after restart', store.data.notes.filter((n) => n.hidden).length === 1 && noteWindows.size === 1);
      const win = noteWindows.get(expected.id);
      await ready(win, '.task');
      const b = win.getBounds();
      check('position and size restored', b.x === expected.bounds.x && b.y === expected.bounds.y && b.width === expected.bounds.width, JSON.stringify(b));
      check('restored task text renders', (await js(win, `document.querySelector('.task-text').textContent`)) === 'Buy milk');
      check('next new-note color continues the sequence', store.data.settings.colorCursor === 2, store.data.settings.colorCursor);
      check('settings survive restart', store.data.settings.newNoteColor === 'sky' && store.data.settings.pomodoroLengths.focusMin === 45 && store.data.settings.pomodoroLengths.breakMin === 12, JSON.stringify(store.data.settings.pomodoroLengths));
      check('focus-session count and history-open state survive restart', store.data.settings.pomodoro.count === 1 && note.historyOpen === true && note.opacity === 1);
      await shot(win, 'shot-restored');

      // ---- About window: opens from the menu action, shows the developers
      ctx.openAbout();
      const aboutWin = await waitFor(() => ctx.windows().aboutWin, { label: 'about window' });
      await ready(aboutWin, '.about-people li');
      const shown = JSON.parse(await js(aboutWin, `JSON.stringify({
        name: document.querySelector('.about-title h2').textContent,
        version: document.querySelector('.about-version').textContent,
        people: [...document.querySelectorAll('.about-people li')].map((li) => li.textContent),
        footer: document.querySelector('.about-footer p').innerText,
        link: !!document.querySelector('.about-footer .text-btn') })`));
      check('About shows the app name and version', shown.name === app.getName() && shown.version === `Version ${app.getVersion()}`, JSON.stringify(shown));
      check('About lists the three developers, in order', JSON.stringify(shown.people) === JSON.stringify(['Arian Samin Islam', 'Samin Yeasar Khan', 'Sk. MD. Rashid Assef Shibly']), JSON.stringify(shown.people));
      check('About shows the licence once, without repeating who developed it', /MIT License/.test(shown.footer) && !/Developed by/i.test(shown.footer), shown.footer);
      check('About has a Developed by heading above the three names', (await js(aboutWin, `document.querySelector('.about-section h3').textContent`)) === 'Developed by');
      check('no GitHub link while the repository URL is unset', shown.link === false);
      const fits = await js(aboutWin, `(() => { const b = document.querySelector('.about-body'); return b.scrollHeight <= b.clientHeight + 1 })()`);
      check('About content fits its window', fits);
      await shot(aboutWin, 'shot-about');
      ctx.openAbout();
      await sleep(300);
      check('opening About twice reuses the same window', ctx.windows().aboutWin === aboutWin);
      await js(aboutWin, `window.sticky.app.closeWindow()`);
      await waitFor(() => aboutWin.isDestroyed(), { label: 'about closed', timeout: 3000 });
      check('About closes itself', true);


      // ---- windows share one renderer process; if it dies, every window comes back
      win.webContents.forcefullyCrashRenderer();
      // executeJavaScript on a dead page never answers, so each probe gives up after a second
      const answers = (w, code) => Promise.race([js(w, code), sleep(1000).then(() => false)]);
      await waitFor(() => answers(win, `!!document.querySelector('.task')`), { label: 'note reloaded after a renderer crash', timeout: 15000 });
      await waitFor(() => answers(launcherWin, `!!document.querySelector('.pad')`), { label: 'launcher reloaded after a renderer crash', timeout: 15000 });
      check('a crashed renderer is reloaded, notes and launcher come back', true);

      // ---- single instance: a second launch must hand over to this copy
      const { spawn } = require('node:child_process');
      launcherWin.hide();
      const started = Date.now();
      const second = spawn(process.execPath, process.argv.slice(1), {
        env: { ...process.env, STICKY_SMOKE_TEST: '0' },
        stdio: 'ignore',
      });
      const exitCode = await new Promise((resolve) => {
        const t = setTimeout(() => resolve('still running after 20s'), 20000);
        second.on('exit', (code) => { clearTimeout(t); resolve(code); });
      });
      if (exitCode === 'still running after 20s') second.kill();
      check('a second launch exits on its own', exitCode === 0, `exit: ${exitCode} after ${Date.now() - started}ms`);
      await waitFor(() => launcherWin.isVisible(), { label: 'first copy brought its windows back', timeout: 5000 }).catch(() => {});
      check('the running copy brings its windows forward instead', launcherWin.isVisible());
      check('the running copy keeps running', !win.isDestroyed() && store.getNote(expected.id) !== null);
    }
  } catch (err) {
    check('smoke run completed without exceptions', false, err.stack || err);
  }

  check('no renderer console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  fs.writeFileSync(path.join(outDir, `phase${phase}-results.json`), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.pass);
  console.log(`phase ${phase}: ${results.length - failed.length}/${results.length} passed`);
  // Quit through the normal path (before-quit flush, windows closing), then
  // exit with a status code the shell script can check.
  const code = failed.length ? 1 : 0;
  app.once('will-quit', (event) => {
    event.preventDefault();
    app.exit(code);
  });
  app.quit();
}

module.exports = { run };
