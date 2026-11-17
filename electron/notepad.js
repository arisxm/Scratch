'use strict';
// Storage for Notepads: paint-style drawing pads on notepad paper.
//
// There can be any number of notepads. Each one's drawing is a PNG (it can be
// megabytes, so it does not belong in the notes JSON) in the `notepads`
// folder, and notepads.json lists them with their title, page size, paper
// style, window position and whether they are hidden. Everything lives next
// to sticky-notes.json and is written atomically (tmp file + rename), so a
// crash mid-save never leaves half a file. The renderer is untrusted:
// everything it sends is checked here.
//
// Scratch 1.5.3 had a single notepad (notepad.json + notepad.png). The first
// time this version runs it becomes the first notepad, hidden, so it waits
// under Hidden notes instead of popping up.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PAPERS = Object.freeze(['lined', 'grid', 'dotted', 'plain']);
const MAX_PNG_BYTES = 64 * 1024 * 1024;
const PAGE_LIMIT = Object.freeze({ min: 100, max: 12000 }); // CSS pixels per side
const TITLE_MAX = 80;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/; // also safe as a file name
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);

function defaultMeta() {
  return { paper: 'lined', width: 0, height: 0, bounds: null };
}

function cleanPageSide(v) {
  if (!isFiniteNumber(v)) return null;
  return Math.round(Math.min(PAGE_LIMIT.max, Math.max(PAGE_LIMIT.min, v)));
}

function cleanBounds(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { x, y, width, height } = raw;
  if (![x, y, width, height].every(isFiniteNumber) || width <= 0 || height <= 0) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function cleanTitle(title) {
  if (typeof title !== 'string') return null;
  return title.replace(/[\r\n\t]+/g, ' ').slice(0, TITLE_MAX);
}

/** Repair page metadata (paper, page size, window bounds) read from disk or sent by a window. */
function cleanMeta(raw) {
  const d = defaultMeta();
  if (!raw || typeof raw !== 'object') return d;
  return {
    paper: PAPERS.includes(raw.paper) ? raw.paper : d.paper,
    width: cleanPageSide(raw.width) ?? d.width,
    height: cleanPageSide(raw.height) ?? d.height,
    bounds: cleanBounds(raw.bounds),
  };
}

/** A new notepad, or one read from disk repaired. Returns null if it can't be saved. */
function cleanPad(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null;
  if (!id) return null;
  const now = Date.now();
  const hidden = raw.hidden === true;
  return {
    id,
    title: cleanTitle(raw.title) ?? '',
    ...cleanMeta(raw),
    hidden,
    hiddenAt: hidden && isFiniteNumber(raw.hiddenAt) ? raw.hiddenAt : hidden ? now : null,
    createdAt: isFiniteNumber(raw.createdAt) ? raw.createdAt : now,
    updatedAt: isFiniteNumber(raw.updatedAt) ? raw.updatedAt : now,
  };
}

/** Accept a Uint8Array/Buffer only if it is a PNG of a sensible size. Returns a Buffer or null. */
function cleanPng(data) {
  if (!(data instanceof Uint8Array)) return null;
  if (data.byteLength < PNG_SIGNATURE.length || data.byteLength > MAX_PNG_BYTES) return null;
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ? buf : null;
}

// Each write gets its own temporary file, so a write at quit time can never
// trip over one still in flight.
let tmpCounter = 0;
const tmpName = (file) => `${file}.${process.pid}-${++tmpCounter}.tmp`;

async function writeAtomic(file, contents) {
  const tmp = tmpName(file);
  await fsp.writeFile(tmp, contents);
  await fsp.rename(tmp, file);
}

class NotepadStore {
  constructor(dir, { debounceMs = 300, onError = null } = {}) {
    this.dir = dir;
    this.indexPath = path.join(dir, 'notepads.json');
    this.imageDir = path.join(dir, 'notepads');
    this.legacyMetaPath = path.join(dir, 'notepad.json'); // Scratch 1.5.3
    this.legacyImagePath = path.join(dir, 'notepad.png');
    this.pads = [];
    this.debounceMs = debounceMs;
    this.onError = onError;
    this._timer = null;
    this._queue = Promise.resolve(); // writes run one after another, in order
  }

  load() {
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return this._migrateLegacy();
    }
    const seen = new Set();
    this.pads = [];
    for (const item of Array.isArray(raw?.notepads) ? raw.notepads : []) {
      const pad = cleanPad(item);
      if (pad && !seen.has(pad.id)) {
        seen.add(pad.id);
        this.pads.push(pad);
      }
    }
    return this.pads;
  }

  /** Bring the single notepad of Scratch 1.5.3 across (copy, never move or overwrite). */
  _migrateLegacy() {
    this.pads = [];
    let meta = null;
    try {
      meta = cleanMeta(JSON.parse(fs.readFileSync(this.legacyMetaPath, 'utf8')));
    } catch {
      // no earlier notepad
    }
    const image = this._readPng(this.legacyImagePath);
    if (!meta && !image) return this.pads;
    const pad = cleanPad({ id: randomUUID(), ...(meta ?? {}), hidden: true, hiddenAt: Date.now() });
    try {
      if (image) {
        fs.mkdirSync(this.imageDir, { recursive: true });
        fs.writeFileSync(this.imagePath(pad.id), image);
      }
      this.pads.push(pad);
      this.saveIndexSync();
    } catch (err) {
      this.onError?.(err);
    }
    return this.pads;
  }

  get(id) {
    return this.pads.find((p) => p.id === id) ?? null;
  }

  create({ bounds = null } = {}) {
    const pad = cleanPad({ id: randomUUID(), bounds });
    this.pads.push(pad);
    this.save();
    return pad;
  }

  imagePath(id) {
    if (!ID_RE.test(id)) throw new Error('bad notepad id');
    return path.join(this.imageDir, `${id}.png`);
  }

  _readPng(file) {
    try {
      return cleanPng(fs.readFileSync(file));
    } catch {
      return null;
    }
  }

  /** A notepad's saved drawing, or null if there is none (or it is unreadable). */
  readImage(id) {
    return this.get(id) ? this._readPng(this.imagePath(id)) : null;
  }

  _enqueue(job) {
    const run = this._queue.then(job, job);
    this._queue = run.catch(() => {});
    return run;
  }

  _indexJson() {
    return JSON.stringify({ version: 1, notepads: this.pads }, null, 2);
  }

  /** Write the list soon (several changes in a row become one write). */
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this.saveIndex().catch((err) => this.onError?.(err));
    }, this.debounceMs);
  }

  saveIndex() {
    const contents = this._indexJson();
    return this._enqueue(async () => {
      await fsp.mkdir(this.dir, { recursive: true });
      await writeAtomic(this.indexPath, contents);
    });
  }

  /** Synchronous write, for quitting. */
  saveIndexSync() {
    clearTimeout(this._timer);
    this._timer = null;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = tmpName(this.indexPath);
      fs.writeFileSync(tmp, this._indexJson());
      fs.renameSync(tmp, this.indexPath);
    } catch (err) {
      this.onError?.(err);
    }
  }

  /** Save a drawing sent by a Notepad window. Resolves to true if it was valid and written. */
  saveDrawing(id, { image, width, height, paper } = {}) {
    const pad = this.get(id);
    if (!pad) return Promise.resolve(false);
    const png = cleanPng(image);
    if (!png) return Promise.resolve(false);
    const w = cleanPageSide(width);
    const h = cleanPageSide(height);
    if (w !== null) pad.width = w;
    if (h !== null) pad.height = h;
    if (PAPERS.includes(paper)) pad.paper = paper;
    pad.updatedAt = Date.now();
    const file = this.imagePath(id);
    const index = this._indexJson();
    return this._enqueue(async () => {
      await fsp.mkdir(this.imageDir, { recursive: true });
      await writeAtomic(file, png);
      await writeAtomic(this.indexPath, index);
      return true;
    });
  }

  rename(id, title) {
    const pad = this.get(id);
    const clean = cleanTitle(title);
    if (!pad || clean === null || clean === pad.title) return false;
    pad.title = clean;
    pad.updatedAt = Date.now();
    this.save();
    return true;
  }

  /** Delete a notepad and its drawing. */
  remove(id) {
    const i = this.pads.findIndex((p) => p.id === id);
    if (i < 0) return Promise.resolve(false);
    this.pads.splice(i, 1);
    const file = this.imagePath(id);
    const index = this._indexJson();
    return this._enqueue(async () => {
      await fsp.rm(file, { force: true });
      await writeAtomic(this.indexPath, index);
      return true;
    });
  }
}

module.exports = {
  NotepadStore,
  PAPERS,
  PAGE_LIMIT,
  MAX_PNG_BYTES,
  TITLE_MAX,
  cleanMeta,
  cleanPad,
  cleanPng,
  cleanBounds,
  cleanTitle,
  defaultMeta,
};
