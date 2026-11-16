# Contributing to Scratch

Thanks for helping. Scratch is small on purpose: a few notes on the desktop that stay out of the way. Changes that keep it simple, fast and reliable are the easiest to accept.

## Reporting a bug

Open an issue with the **Bug report** form. The most useful reports include:

- what you did, step by step, and what happened instead
- a screenshot if it's about how something looks
- your Windows version and the Scratch version (menu › About Scratch)

If your notes file is involved, describe it rather than attaching it: it contains your notes.

## Suggesting a feature

Open an issue with the **Feature request** form and describe the problem you want solved before the solution. For anything larger than a small fix, please open an issue before writing code, so we can agree on the approach first.

## Working on the code

You need Node.js 20 or newer.

```
npm install
npm run dev     # the app with live reload
npm test        # unit tests, run these before every commit
```

The end-to-end tests drive the real app: `./scripts/smoke.sh` (Linux needs `xvfb-run`; on Windows, use Git Bash). See [docs/RELEASING.md](docs/RELEASING.md) for building the installer.

Ground rules:

- **Keep the security model.** Every window runs with context isolation and the sandbox, and can only use the small API in `electron/preload.js`. The main process validates everything a window sends (`electron/schema.js`). New features go through the same path.
- **Never lose notes.** Anything that touches `electron/store.js` or the data format needs tests, including reading files written by older versions.
- **Test what you change.** Add or update unit tests in `tests/`, and end-to-end checks in `electron/smoke.js` for anything visible.
- **Match the look.** Reuse the colour tokens and components in `src/styles/` rather than adding new ones.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change, with tests.
3. Run `npm test` and `npm run build`.
4. Open a pull request and fill in the template. Screenshots help for anything visual.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE), like the rest of the project.

## Conduct

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
