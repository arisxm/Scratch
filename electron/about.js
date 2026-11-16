'use strict';
// Everything the About window shows. The developer list is the single source
// of truth; package.json "contributors" must match it (a unit test checks).

const DEVELOPERS = Object.freeze(['Arian Samin Islam', 'Samin Yeasar Khan', 'Sk. MD. Rashid Assef Shibly']);

const PUBLISHER = 'Arian, Sadif & Shibly';
const LICENSE = 'MIT License';

// The project's public page, shown as a link in About. Leave empty until the
// repository exists; the link is hidden while it's empty. Only an https URL
// on github.com is accepted, so a typo can't turn into an arbitrary link.
const REPOSITORY_URL = '';

function isAllowedLink(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'github.com' || u.hostname.endsWith('.github.com'));
  } catch {
    return false;
  }
}

function aboutInfo({ name, version, electron, chrome }) {
  return {
    name,
    version,
    publisher: PUBLISHER,
    developers: [...DEVELOPERS],
    license: LICENSE,
    repository: isAllowedLink(REPOSITORY_URL) ? REPOSITORY_URL : null,
    year: 2026,
    runtime: `Electron ${electron} · Chromium ${String(chrome).split('.')[0]}`,
  };
}

module.exports = { DEVELOPERS, PUBLISHER, REPOSITORY_URL, aboutInfo, isAllowedLink };
