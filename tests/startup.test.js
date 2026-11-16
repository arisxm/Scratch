'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStartup, parseApproved } = require('../electron/startup');

const EXE = 'C:\\Users\\Ana\\AppData\\Local\\Programs\\Sticky Notes\\Sticky Notes.exe';
const NAME = 'com.stickynotes.desktop';

// Models Windows + Electron 44 as measured: a Run entry, a separate Task
// Manager record, and a launchItems list that Electron leaves empty when the
// exe path contains spaces.
function setup({ packaged = true, platform = 'win32', run = false, approved = null, listsItems = false } = {}) {
  const state = { run, approved }; // approved: null = no record, true/false = enabled/disabled
  const calls = [];
  const app = {
    isPackaged: packaged,
    getLoginItemSettings() {
      const items = state.run && listsItems ? [{ name: NAME, path: EXE.toLowerCase(), enabled: state.approved !== false }] : [];
      return { openAtLogin: state.run, launchItems: items, executableWillLaunchAtLogin: items.some((i) => i.enabled) };
    },
    setLoginItemSettings(opts) {
      calls.push(opts);
      state.run = opts.openAtLogin;
      if (opts.openAtLogin && opts.enabled !== false) state.approved = true;
    },
  };
  const reads = [];
  const startup = createStartup({
    app, valueName: NAME, platform, execPath: EXE,
    readApproved: (name) => { reads.push(name); return state.approved; },
  });
  return { startup, calls, reads, state };
}

test('only available in the installed Windows app', () => {
  assert.equal(setup().startup.isSupported(), true);
  assert.equal(setup({ packaged: false }).startup.isSupported(), false);
  assert.equal(setup({ platform: 'linux' }).startup.isSupported(), false);
  const dev = setup({ packaged: false });
  assert.equal(dev.startup.setStartAtLogin(true), false);
  assert.equal(dev.calls.length, 0, 'never touches the registry from a dev build');
});

for (const listsItems of [true, false]) {
  const how = listsItems ? 'Electron lists the entry' : 'path has spaces, Electron lists nothing';
  test(`${how}: reports what Windows will actually do`, () => {
    assert.equal(setup({ listsItems, run: true }).startup.willStartAtLogin(), true, 'entry, no Task Manager record');
    assert.equal(setup({ listsItems, run: true, approved: true }).startup.willStartAtLogin(), true);
    assert.equal(setup({ listsItems, run: true, approved: false }).startup.willStartAtLogin(), false, 'disabled in Task Manager');
    assert.equal(setup({ listsItems, run: false }).startup.willStartAtLogin(), false, 'no entry');
  });
  test(`${how}: turning it on clears a Task Manager "Disabled" mark`, () => {
    const s = setup({ listsItems, run: true, approved: false });
    assert.equal(s.startup.setStartAtLogin(true), true);
    assert.deepEqual(s.calls.at(-1), { openAtLogin: true, enabled: true });
  });
}

test('the Task Manager record is looked up by the entry name, only when needed', () => {
  const listed = setup({ listsItems: true, run: true });
  listed.startup.willStartAtLogin();
  assert.deepEqual(listed.reads, [], 'Electron already told us');
  const spaced = setup({ listsItems: false, run: true });
  spaced.startup.willStartAtLogin();
  assert.deepEqual(spaced.reads, [NAME]);
});

test('turning it off removes the entry', () => {
  const s = setup({ run: true });
  assert.equal(s.startup.setStartAtLogin(false), false);
  assert.deepEqual(s.calls.at(-1), { openAtLogin: false });
});

test('parses reg.exe output for the Task Manager record', () => {
  const out = (hex) => `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run\r\n    ${NAME}    REG_BINARY    ${hex}\r\n\r\n`;
  assert.equal(parseApproved(out('020000000000000000000000'), NAME), true);
  assert.equal(parseApproved(out('060000000000000000000000'), NAME), true);
  assert.equal(parseApproved(out('03000000F0A1B2C3D4E5F601'), NAME), false);
  assert.equal(parseApproved(out('070000000000000000000000'), NAME), false);
  assert.equal(parseApproved('', NAME), null);
  assert.equal(parseApproved(out('zz'), NAME), null);
});
