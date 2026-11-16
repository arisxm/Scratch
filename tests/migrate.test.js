'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrateLegacyData } = require('../electron/migrate');

const quiet = { info() {}, warn() {} };
function dirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-migrate-'));
  return { fromDir: path.join(root, 'Sticky Notes'), toDir: path.join(root, 'Scratch') };
}
const write = (dir, file, text) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};

test('copies the notes and their backup from the old folder', () => {
  const d = dirs();
  write(d.fromDir, 'sticky-notes.json', '{"notes":["mine"]}');
  write(d.fromDir, 'sticky-notes.json.bak', '{"notes":["older"]}');
  assert.equal(migrateLegacyData({ ...d, log: quiet }), 'migrated');
  assert.equal(fs.readFileSync(path.join(d.toDir, 'sticky-notes.json'), 'utf8'), '{"notes":["mine"]}');
  assert.equal(fs.readFileSync(path.join(d.toDir, 'sticky-notes.json.bak'), 'utf8'), '{"notes":["older"]}');
  assert.ok(fs.existsSync(path.join(d.fromDir, 'sticky-notes.json')), 'old copy is kept');
});

test('never overwrites notes already in the new folder', () => {
  const d = dirs();
  write(d.fromDir, 'sticky-notes.json', 'old');
  write(d.toDir, 'sticky-notes.json', 'new');
  assert.equal(migrateLegacyData({ ...d, log: quiet }), 'already-has-data');
  assert.equal(fs.readFileSync(path.join(d.toDir, 'sticky-notes.json'), 'utf8'), 'new');
});

test('a backup alone in the new folder also counts as existing data', () => {
  const d = dirs();
  write(d.fromDir, 'sticky-notes.json', 'old');
  write(d.toDir, 'sticky-notes.json.bak', 'new-bak');
  assert.equal(migrateLegacyData({ ...d, log: quiet }), 'already-has-data');
  assert.ok(!fs.existsSync(path.join(d.toDir, 'sticky-notes.json')));
});

test('fresh install: nothing to do, no folders created', () => {
  const d = dirs();
  assert.equal(migrateLegacyData({ ...d, log: quiet }), 'nothing-to-migrate');
  assert.ok(!fs.existsSync(d.toDir));
});

test('runs only once: the second launch finds the copied notes', () => {
  const d = dirs();
  write(d.fromDir, 'sticky-notes.json', 'old');
  assert.equal(migrateLegacyData({ ...d, log: quiet }), 'migrated');
  assert.equal(migrateLegacyData({ ...d, log: quiet }), 'already-has-data');
});

test('same folder or a failure never throws', () => {
  const d = dirs();
  assert.equal(migrateLegacyData({ fromDir: d.toDir, toDir: d.toDir, log: quiet }), 'nothing-to-migrate');
  write(d.fromDir, 'sticky-notes.json', 'old');
  const blocker = path.join(path.dirname(d.toDir), 'blocked');
  fs.writeFileSync(blocker, 'a file where a folder should be');
  assert.equal(migrateLegacyData({ fromDir: d.fromDir, toDir: path.join(blocker, 'x'), log: quiet }), 'failed');
});
