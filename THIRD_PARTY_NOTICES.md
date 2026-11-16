# Third-party notices

Scratch is MIT-licensed (see [LICENSE](LICENSE)). The Windows app it builds also contains the following third-party software. Their licence texts are in the [`licenses/`](licenses/) folder, which is copied into every installed copy of Scratch (`resources\licenses`).

| Component | Version | Licence | Used for |
| --- | --- | --- | --- |
| [Electron](https://www.electronjs.org/) | 44.9.3 | MIT | The desktop runtime. Electron includes Chromium and Node.js; their notices ship next to the app as `LICENSE.electron.txt` and `LICENSES.chromium.html`. |
| [React](https://react.dev/) and React DOM | 19.2.9 | MIT | The user interface |
| [Caveat](https://github.com/googlefonts/caveat) (via Fontsource) | 5.3.0 | SIL Open Font License 1.1 | Handwritten titles |
| [Figtree](https://github.com/erikdkennedy/figtree) (via Fontsource) | 5.3.0 | SIL Open Font License 1.1 | Body text |

Tools used only to build and test Scratch (Vite, electron-builder and the rest of `devDependencies` in `package.json`) are not included in the app. Each keeps its own licence in `node_modules` after `npm install`.
