'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NotepadStore, cleanMeta, cleanPad, cleanPng, PAGE_LIMIT, TITLE_MAX } = require('../electron/notepad');

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-notepad-'));
}

test('Notepad only accepts PNG bytes', () => {
  assert.ok(cleanPng(new Uint8Array(PNG)));
  assert.equal(cleanPng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), null);
  assert.equal(cleanPng('not bytes'), null);
  assert.equal(cleanPng(null), null);
});

test('Notepad metadata is repaired, not trusted', () => {
  assert.deepEqual(cleanMeta(null), { paper: 'lined', width: 0, height: 0, bounds: null });
  const m = cleanMeta({ paper: 'evil', width: 1e9, height: 5, bounds: { x: 1, y: 2, width: 'x', height: 4 } });
  assert.equal(m.paper, 'lined');
  assert.equal(m.width, PAGE_LIMIT.max);
  assert.equal(m.height, PAGE_LIMIT.min);
  assert.equal(m.bounds, null);
  assert.equal(cleanMeta({ paper: 'grid' }).paper, 'grid');
});

test('Notepad ids must be safe file names; titles are one short line', () => {
  assert.equal(cleanPad({ id: '../../evil' }), null);
  assert.equal(cleanPad({ id: '' }), null);
  const pad = cleanPad({ id: 'abc-123', title: 'Line one\nline two'.padEnd(200, '!') });
  assert.equal(pad.title.includes('\n'), false);
  assert.equal(pad.title.length, TITLE_MAX);
  assert.equal(pad.hidden, false);
});

test('Notepads save, rename, hide and reload', async () => {
  const dir = tempDir();
  try {
    const store = new NotepadStore(dir, { debounceMs: 1 });
    store.load();
    const a = store.create();
    const b = store.create();
    assert.notEqual(a.id, b.id);
    assert.equal(store.readImage(a.id), null);
    assert.equal(await store.saveDrawing(a.id, { image: new Uint8Array([0, 1, 2]), width: 800, height: 600 }), false);
    assert.equal(await store.saveDrawing(a.id, { image: new Uint8Array(PNG), width: 800, height: 600, paper: 'dotted' }), true);
    assert.equal(await store.saveDrawing('missing', { image: new Uint8Array(PNG) }), false);
    assert.equal(store.rename(a.id, 'Ideas'), true);
    b.hidden = true;
    b.hiddenAt = 123;
    await store.saveIndex();

    const again = new NotepadStore(dir);
    again.load();
    assert.equal(again.pads.length, 2);
    const a2 = again.get(a.id);
    assert.deepEqual({ title: a2.title, paper: a2.paper, width: a2.width, height: a2.height }, { title: 'Ideas', paper: 'dotted', width: 800, height: 600 });
    assert.ok(again.readImage(a.id).equals(PNG));
    assert.equal(again.get(b.id).hidden, true);

    assert.equal(await again.remove(a.id), true);
    assert.equal(fs.existsSync(again.imagePath(a.id)), false);
    const third = new NotepadStore(dir);
    third.load();
    assert.deepEqual(third.pads.map((p) => p.id), [b.id]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('The single notepad from Scratch 1.5.3 becomes a hidden notepad', () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, 'notepad.json'), JSON.stringify({ paper: 'grid', width: 900, height: 700 }));
    fs.writeFileSync(path.join(dir, 'notepad.png'), PNG);
    const store = new NotepadStore(dir);
    store.load();
    assert.equal(store.pads.length, 1);
    const [pad] = store.pads;
    assert.equal(pad.hidden, true);
    assert.equal(pad.paper, 'grid');
    assert.ok(store.readImage(pad.id).equals(PNG));
    assert.ok(fs.existsSync(path.join(dir, 'notepad.png')), 'the old file is copied, not moved');

    // Only once: after that, notepads.json is the source of truth.
    const again = new NotepadStore(dir);
    again.load();
    assert.equal(again.pads.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
