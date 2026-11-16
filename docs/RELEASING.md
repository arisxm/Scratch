# Releasing Scratch

Notes for maintainers. Users only need the installer from the [Releases page](../../../releases).

## Build a release locally

```
npm run dist
python3 scripts/make-install-guide.py      # needs: pip install reportlab fonttools brotli
```

The installer is kept small by `electronLanguages` (English only), `compression: maximum` and `build/afterPack.js`, which removes `dxcompiler.dll` and `dxil.dll` (WebGPU only; the app doesn't use it). `LICENSES.chromium.html` stays for licence compliance.

`npm run dist` writes `release\Scratch_Setup.exe`, the installer to give customers, and `release\win-unpacked\`, the installed app's files. The guide script writes `release\Scratch Installation Guide.pdf`. Building on Linux needs Wine for the Windows resource and installer steps.

Publisher, product name, version and copyright all come from `package.json` (`author.name`, `productName`, `version`, `build.copyright`). electron-builder writes them into the app exe's and the installer's file properties and into the Installed Apps entry. Bump `version` for every release; the installer uses it to tell an update from a fresh install.

The build never publishes anything itself: `package.json` sets `"publish": null` and the `dist` scripts pass `--publish never`. Without that, electron-builder starts publishing to GitHub on its own whenever a `GH_TOKEN` or `GITHUB_TOKEN` variable is set or a CI build runs on a tag, and with no update feed configured the build then fails with `Cannot read properties of null (reading 'channel')`. Releases are published by the release workflow (below) or by hand.

`npm run dist:portable` builds a single self-extracting exe. It is not meant for customers: it runs from a temporary copy, so "Open when I sign in" would point at a file that disappears.

### What the installer does

The installer (`build/installer.nsh` on top of electron-builder's NSIS wizard):

- installs for the current Windows user only, so it never asks for administrator rights; the default folder is `%LOCALAPPDATA%\Programs\Scratch`, and the customer can choose another;
- shows Welcome, Choose Install Location, Start with Windows (ticked by default), Installing, and Finish with "Run Scratch";
- creates Desktop and Start Menu shortcuts and an Installed Apps entry ("Scratch", Arian, Sadif & Shibly) with an Uninstall button;
- on an update, keeps the customer's notes and their startup choice (a version before 1.3.0 counts as a fresh install, because startup was opt-in then);
- on uninstall, removes the app, the shortcuts, the startup entry and Windows' Task Manager record for it, and keeps the notes in `%APPDATA%\Scratch`.

"Start with Windows" is the per-user value `com.stickynotes.desktop` under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, holding the quoted exe path. The app's Settings switch writes the same entry through `electron/startup.js`. If you ever change `APP_ID` in `electron/main.js`, change `STARTUP_VALUE` in `build/installer.nsh` too.

The shipped exe has three Electron "fuses" switched off (`runAsNode`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments`), so it can only run Scratch and can't be used to run other scripts.

### Code signing

Not done yet. The publisher name in file properties and Installed Apps is plain text. Until the installer and app are signed with an Authenticode code-signing certificate, SmartScreen and download warnings show "Unknown publisher", and the customer guide tells customers so (set `SIGNED = True` in `scripts/make-install-guide.py` once that changes).

To sign, you need a code-signing certificate issued to Arian, Sadif & Shibly as a verified organisation. Certificate authorities now require the private key to live on a hardware token or in a cloud signing service, so plan for one of those. electron-builder then signs both executables during `npm run dist` (see its Windows code-signing docs). A new certificate doesn't remove SmartScreen warnings immediately; Microsoft builds reputation for it over time and downloads.

### Before each release: one test on a real Windows PC

The automated tests can't cover these, so check them once on a real Windows 10/11 PC or a virtual machine with a fresh user account:

1. Run `Scratch_Setup.exe` without administrator rights. Check the five wizard pages, then that the app opens with the "Start here" note.
2. Settings › Apps › Installed apps shows "Scratch", Arian, Sadif & Shibly, version as expected.
3. Sign out and back in (or restart): Scratch opens by itself.
4. Open it again from the Start menu while it's running: no second copy, the notes come to the front.
5. In Task Manager › Startup apps, disable Scratch, then open Scratch's Settings: "Open when I sign in" is off. Tick it: Task Manager shows it enabled again.
6. Make a note, run the installer again (update): the note is still there.
7. Uninstall from Settings: the app, both shortcuts and the Task Manager startup entry are gone; `%APPDATA%\Scratch` is still there.


## What has been verified, and where

Last full run, for 1.5.0 (2026-11-15), on Windows 10 with Electron 44:

- **54 unit tests** (`npm test`): validation, storage and corruption recovery (including the background save), reminders (and the reminder hour), countdowns, the Pomodoro timer (custom lengths, auto-start), settings validation, startup detection, the About details and the Sticky Notes data migration.
- **139 end-to-end checks** (`scripts/smoke.sh`, run by hand with the same environment variables on Windows), in three phases: using the app, including Settings, scaling, the + button and the Day/Month pill; restarting it, opening About, recovering from a crashed renderer and launching a second copy; layout checks on the collapsed strip.
- **Installer, on real Windows:** an interactive upgrade from an installed 1.4.0 over its running app: the wizard pages (welcome, folder, start with Windows, finish), the "Scratch is running" prompt, the old files replaced, Installed Apps showing 1.5.0, the startup choice kept, and the existing notes unchanged afterwards.
- **34 installer checks** in a brand-new Wine profile (`OLD_SETUP=<Sticky Notes 1.3.0 installer> ./scripts/test-installer-wine.sh`) were last run for 1.4.0 and not repeated for 1.5.0: per-user install with no administrator rights; the Installed Apps entry; shortcuts; startup on by default; updates keeping notes and the startup choice; uninstall removing the app, shortcuts, startup entry and Task Manager record while keeping notes; and an upgrade from the real Sticky Notes 1.3.0 installer.

Wine is not Windows. Two things it can't show: Electron 44 itself (stock, without this app) crashes under Wine a few seconds after starting, so "keeps running" and single-instance are only verified on Linux; and Wine's PowerShell is a stub (the test removes it), so the installer's PowerShell route for detecting a running app is only exercised on real Windows. Hence the real-PC checklist above.

While testing, Electron 44 turned out to report startup as off whenever the exe path contains a space, even for entries it wrote itself (measured under Wine; it may differ on real Windows). `electron/startup.js` therefore also reads the Task Manager record directly, so the menu is right either way.

## Renamed from Sticky Notes (1.4.0)

Version 1.4.0 renamed the app from Sticky Notes to Scratch. Three things deliberately keep the old name, so that updating from 1.3.0 works:

- `build.appId` and `APP_ID` stay `com.stickynotes.desktop`. The installer derives its Installed Apps ID from it, so an update replaces Sticky Notes instead of installing a second app, and existing "start with Windows" entries keep working.
- The data file stays `sticky-notes.json`.
- On first launch, `electron/migrate.js` copies the notes from `%APPDATA%\Sticky Notes` into `%APPDATA%\Scratch`, only if Scratch has none yet. It never overwrites or deletes; the old folder stays as a backup.

People who update keep their install folder (`...\Programs\Sticky Notes`); new installs go to `...\Programs\Scratch`. Shortcuts are renamed by the installer.

## Publishing a release on GitHub

The workflow in `.github/workflows/release.yml` builds the installer on a Windows machine and attaches it to a draft release whenever a version tag is pushed:

1. Set the new `version` in `package.json` (and the top-level and `packages[""]` versions in `package-lock.json`), add a section to `CHANGELOG.md`, commit.
2. Tag and push: `git tag v1.5.0` then `git push origin v1.5.0`.
3. When the workflow finishes, open the draft under **Releases**, check the notes and the attached `Scratch_Setup.exe`, and publish it.
