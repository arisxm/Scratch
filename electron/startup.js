'use strict';
// "Start with Windows": an entry under HKCU\Software\Microsoft\Windows\
// CurrentVersion\Run. Both this app and the installer (build/installer.nsh)
// write it, so they must agree on the format. Measured with Electron 44 on
// Windows, setLoginItemSettings() writes:
//   value name: the app's AppUserModelId (APP_ID in main.js)
//   value data: the quoted path to the exe, with no arguments
// Per-user (HKCU), so it never needs administrator rights.
//
// Reading it back takes care, for two measured reasons:
//  1. When someone switches the app off in Task Manager (or Settings > Apps >
//     Startup), Windows keeps the Run entry and records "disabled" under
//     ...\Explorer\StartupApproved\Run. `openAtLogin` stays true then.
//  2. Electron 44 builds its `launchItems` list (which carries that enabled
//     flag) only when the exe path has no spaces. For "...\Sticky Notes\
//     Sticky Notes.exe" the list is empty, even for an entry Electron wrote
//     itself. Then we read the StartupApproved record directly.

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APPROVED_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';

/**
 * Parse `reg query` output for a REG_BINARY StartupApproved value. The first
 * byte is 02 (or 06) when the entry is enabled and 03 (or 07) when the user
 * disabled it, so an odd first byte means disabled. Returns null when there
 * is no record, which Windows treats as enabled.
 */
function parseApproved(output, name) {
  const line = String(output)
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(name) && /REG_BINARY/.test(l));
  if (!line) return null;
  const hex = line.split(/REG_BINARY/)[1].trim();
  const first = parseInt(hex.slice(0, 2), 16);
  if (Number.isNaN(first)) return null;
  return (first & 1) === 0;
}

/** Is the Run entry `name` enabled in Task Manager? null = no record (enabled). */
function readApproved(name) {
  const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  try {
    const out = execFileSync(reg, ['query', APPROVED_KEY, '/v', name], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    return parseApproved(out, name);
  } catch {
    return null; // reg.exe exits with an error when the value doesn't exist
  }
}

const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/**
 * Startup control for one app. `valueName` is the Run entry's name, which is
 * also the key of its Task Manager record: the app's AppUserModelId.
 * `platform`, `execPath` and `readApproved` are only overridden by tests.
 */
function createStartup({ app, valueName, platform = process.platform, execPath = process.execPath, readApproved: read = readApproved }) {
  const isSupported = () => platform === 'win32' && app.isPackaged === true;

  /** Will Windows actually start the app at the next sign-in? */
  function willStartAtLogin() {
    if (!isSupported()) return false;
    const settings = app.getLoginItemSettings();
    if (!settings.openAtLogin) return false; // no Run entry pointing at this exe
    const own = (settings.launchItems || []).find((item) => samePath(item.path, execPath));
    if (own) return own.enabled !== false;
    return read(valueName) !== false; // Electron couldn't list it (spaces in the path)
  }

  /**
   * Turn starting at sign-in on or off. `enabled: true` also clears a Task
   * Manager "Disabled" mark, so ticking the box in the app always works.
   * Returns the resulting state as Windows reports it.
   */
  function setStartAtLogin(on) {
    if (!isSupported()) return false;
    app.setLoginItemSettings(on ? { openAtLogin: true, enabled: true } : { openAtLogin: false });
    return willStartAtLogin();
  }

  return { isSupported, willStartAtLogin, setStartAtLogin };
}

module.exports = { createStartup, parseApproved };
