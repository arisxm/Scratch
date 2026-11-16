'use strict';
// One-time move of notes from the app's previous name.
//
// Electron keeps app data in %APPDATA%\<productName>. Version 1.4.0 renamed
// the app from "Sticky Notes" to "Scratch", so without this an updated app
// would start with an empty folder and the user's notes would seem lost.
//
// Rules: copy (never move), only when the new folder has no notes yet, and
// never overwrite. The old folder is left untouched as a backup.

const fs = require('node:fs');
const path = require('node:path');

const DATA_FILES = ['sticky-notes.json', 'sticky-notes.json.bak'];

/**
 * @returns {'migrated'|'already-has-data'|'nothing-to-migrate'|'failed'}
 */
function migrateLegacyData({ fromDir, toDir, files = DATA_FILES, log = console }) {
  try {
    if (!fromDir || !toDir || path.resolve(fromDir) === path.resolve(toDir)) return 'nothing-to-migrate';
    if (files.some((f) => fs.existsSync(path.join(toDir, f)))) return 'already-has-data';
    const present = files.filter((f) => fs.existsSync(path.join(fromDir, f)));
    if (!present.length) return 'nothing-to-migrate';
    fs.mkdirSync(toDir, { recursive: true });
    for (const f of present) {
      // COPYFILE_EXCL: if something appeared meanwhile, don't overwrite it
      fs.copyFileSync(path.join(fromDir, f), path.join(toDir, f), fs.constants.COPYFILE_EXCL);
    }
    log.info?.(`[migrate] copied ${present.join(', ')} from ${fromDir}`);
    return 'migrated';
  } catch (err) {
    log.warn?.('[migrate] could not copy notes from the old folder:', err.code ?? err);
    return 'failed';
  }
}

module.exports = { migrateLegacyData, DATA_FILES };
