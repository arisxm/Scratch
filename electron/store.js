'use strict';
// Local persistence: one JSON file in the user's app-data folder.
//
// Why not SQLite? The data is a few kilobytes and is always read whole, so a
// native database module would only add a rebuild step to every Electron
// upgrade and installer build. Durability comes from:
//   1. atomic replace: write to <file>.tmp, then rename over <file>
//   2. a rolling <file>.bak copy of the last good file
//   3. recovery on load: <file>  ->  <file>.bak  ->  empty data
//   4. a synchronous flush on quit, so a pending debounced save is never lost
//
// Saves during normal use are written asynchronously (the fsync is the slow
// part and used to freeze every window for a moment after, say, deleting a
// task); only quitting and signing out write synchronously.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { normalizeData, emptyData } = require('./schema');

class Store {
  constructor(filePath, { debounceMs = 300, onSaveError = null } = {}) {
    this.filePath = filePath;
    this.tmpPath = `${filePath}.tmp`;
    this.bakPath = `${filePath}.bak`;
    this.debounceMs = debounceMs;
    this.data = emptyData();
    this.isFirstRun = false;
    this.loadedFrom = null;
    this.unreadableFile = null; // where a damaged data file was moved aside, if it was
    this.onSaveError = onSaveError; // told about every failed save, so the user can be warned
    this._timer = null;
    this._dirty = false;
    this._writing = false; // an asynchronous save is in flight
    this._gen = 0; // bumped by every synchronous flush, so a stale async save can't overwrite it
  }

  load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    let sawUnreadable = false;
    for (const candidate of [this.filePath, this.bakPath]) {
      const parsed = readJson(candidate);
      if (parsed.ok) {
        this.data = normalizeData(parsed.value);
        this.loadedFrom = candidate;
        if (candidate !== this.filePath) this.save(); // rewrite the main file from the backup
        return this.data;
      }
      if (parsed.error !== 'ENOENT') {
        console.warn(`[store] could not read ${candidate}: ${parsed.error}`);
        sawUnreadable = true;
        if (candidate === this.filePath) this.unreadableFile = quarantine(candidate);
      }
    }
    this.isFirstRun = !sawUnreadable;
    this.data = emptyData();
    this.loadedFrom = null;
    return this.data;
  }

  /** Mark data as changed; it is written after a short quiet period. */
  save() {
    this._dirty = true;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._saveInBackground(), this.debounceMs);
  }

  async _saveInBackground() {
    this._timer = null;
    if (!this._dirty) return;
    if (this._writing) {
      this._timer = setTimeout(() => this._saveInBackground(), 20); // try again when the current write ends
      return;
    }
    this._writing = true;
    const gen = this._gen;
    const contents = JSON.stringify(this.data, null, 2);
    this._dirty = false;
    try {
      await writeAtomicAsync(this.filePath, this.tmpPath, this.bakPath, contents, () => gen === this._gen);
    } catch (err) {
      console.error('[store] save failed:', err);
      this._dirty = true; // keep it pending; the next save or the quit flush retries
      this.onSaveError?.(err);
    } finally {
      this._writing = false;
    }
  }

  /** Write immediately if anything is pending. Safe to call on quit. */
  flush() {
    clearTimeout(this._timer);
    this._timer = null;
    if (this._writing) this._dirty = true; // a background save may not finish before we quit: write again, now
    if (!this._dirty) return true;
    this._gen += 1; // any background save already under way is now older than this one
    try {
      writeAtomic(this.filePath, this.tmpPath, this.bakPath, JSON.stringify(this.data, null, 2));
      this._dirty = false;
      return true;
    } catch (err) {
      console.error('[store] save failed:', err);
      this.onSaveError?.(err);
      return false;
    }
  }

  getNote(id) {
    return this.data.notes.find((n) => n.id === id) ?? null;
  }

  addNote(note) {
    this.data.notes.push(note);
    this.save();
    return note;
  }

  deleteNote(id) {
    const before = this.data.notes.length;
    this.data.notes = this.data.notes.filter((n) => n.id !== id);
    if (this.data.notes.length !== before) this.save();
  }
}

function quarantine(file) {
  const target = `${file}.unreadable-${Date.now()}`;
  try {
    fs.renameSync(file, target);
    console.warn(`[store] moved unreadable file to ${target}`);
    return target;
  } catch (err) {
    console.warn('[store] could not move unreadable file aside:', err.code ?? err);
    return file;
  }
}

function readJson(file) {
  try {
    // Some Windows editors save with a byte-order mark, which JSON.parse rejects.
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err.code ?? err.message };
  }
}

/**
 * Same steps as writeAtomic, but the slow ones (write + fsync) run off the main
 * thread. If a synchronous flush happened meanwhile (`stillCurrent()` is false)
 * the newer file stays and this older one is dropped. Only the rename is
 * synchronous, with no await between the check and the rename.
 */
async function writeAtomicAsync(file, tmp, bak, contents, stillCurrent) {
  const own = `${tmp}.bg`;
  const handle = await fsp.open(own, 'w');
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fsp.copyFile(file, bak); // refresh the backup off the main thread too (absent on the very first save)
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[store] could not refresh backup:', err.code ?? err);
  }
  if (!stillCurrent()) {
    fs.rmSync(own, { force: true });
    return;
  }
  try {
    fs.renameSync(own, file);
  } catch (err) {
    if (err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'EACCES') throw err;
    fs.writeFileSync(file, contents, 'utf8'); // see writeAtomic
    fs.rmSync(own, { force: true });
  }
}

function writeAtomic(file, tmp, bak, contents) {
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, contents, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, bak);
    } catch (err) {
      console.warn('[store] could not refresh backup:', err.code ?? err);
    }
  }
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    // Antivirus or indexers on Windows sometimes hold a brief lock on the
    // target (EPERM/EBUSY). Fall back to an in-place write; the .bak copy
    // made above still protects against a torn write.
    if (err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'EACCES') throw err;
    fs.writeFileSync(file, contents, 'utf8');
    fs.rmSync(tmp, { force: true });
  }
}

module.exports = { Store };
