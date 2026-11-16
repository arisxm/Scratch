'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('About lists exactly the three developers, matching package.json', () => {
  const { DEVELOPERS, aboutInfo } = require('../electron/about');
  assert.deepEqual([...DEVELOPERS], ['Arian Samin Islam', 'Samin Yeasar Khan', 'Sk. MD. Rashid Assef Shibly']);
  const pkg = require('../package.json');
  assert.deepEqual(pkg.contributors.map((c) => c.name), [...DEVELOPERS]);
  const info = aboutInfo({ name: 'Scratch', version: '1.5.0', electron: '44.9.3', chrome: '140.0.1.2' });
  assert.equal(info.publisher, 'Arian, Sadif & Shibly');
  assert.equal(info.runtime, 'Electron 44.9.3 · Chromium 140');
});

test('About only links to github.com over https', () => {
  const { isAllowedLink } = require('../electron/about');
  assert.equal(isAllowedLink('https://github.com/example/scratch'), true);
  assert.equal(isAllowedLink('http://github.com/x/y'), false);
  assert.equal(isAllowedLink('https://github.com.evil.example/x'), false);
  assert.equal(isAllowedLink('javascript:alert(1)'), false);
  assert.equal(isAllowedLink(''), false);
});
