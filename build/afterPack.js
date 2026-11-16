'use strict';
// Runs after electron-builder has laid out the app, before the installer is
// made. Drops the two DirectX shader-compiler DLLs (about 26 MB) that Chromium
// loads only for WebGPU, which Scratch never uses. Everything else stays.

const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack({ appOutDir }) {
  for (const name of ['dxcompiler.dll', 'dxil.dll']) fs.rmSync(path.join(appOutDir, name), { force: true });
};
