# Changelog

All notable changes to Scratch. Versions follow [semantic versioning](https://semver.org/).

## [1.5.4] - 2026-11-17

### Added
- Hover over the + pad to choose **Sticky note** or **Notepad**. Clicking the pad itself still makes a sticky note.
- As many notepads as you like (the menu item is now "New notepad"). Click a notepad's title to rename it; the name is also used when saving it as a picture.
- Closing a notepad hides it instead of keeping one pad: it waits under Hidden notes with your notes, where it can be restored or deleted (with the same confirmation). The hidden count on the launcher includes notepads, and notepads that were open when Scratch quit open again at launch.

### Changed
- The notepad from 1.5.3 becomes your first notepad, under Hidden notes. Notepads are now kept in `notepads.json` and a `notepads` folder in the data folder.

## [1.5.3] - 2026-11-17

### Added
- **Notepad** ("Notepad…" in the menu): a paint-style drawing pad on notepad paper (lined, grid, dotted or plain). Pen, highlighter, eraser, fill, colour picker, text, line, arrow, rectangle and ellipse tools, in any colour and size. Paste pictures with Ctrl+V, drop them in or insert them, then move and resize them. Select part of the drawing to move, copy, cut or delete it. Undo and redo, full screen (F11), and save the page as a PNG picture (Ctrl+S). The drawing is saved automatically.

## [1.5.2] - 2026-11-16

### Added
- A macOS installer, `Scratch.dmg`, for Intel and Apple silicon Macs. Open it and drag Scratch into Applications.

## [1.5.1] - 2026-11-16

### Added
- Clear error messages instead of silent failures: when Scratch can't start, hits an unexpected problem, can't save your notes (for example a full disk), or a window keeps crashing, it says so in plain words and offers to restart where that helps.
- Problems are recorded in `errors.log` in the data folder (Open data folder in the menu), so it can be attached to a bug report.

### Fixed
- If the notes file was damaged, Scratch opened the backup or started empty without saying anything. It now tells you, and shows where the damaged file was kept.
- A notes file saved with a byte-order mark (some Windows editors add one) was treated as damaged. It now loads normally.
- A window whose page crashed over and over was reloaded forever. After three crashes in a minute Scratch now stops and offers to restart.
- If something failed while Scratch was starting, it could stay running in the background with no windows. It now explains and closes.

### Changed
- The installer no longer includes `elevate.exe`, which only all-users installs need; Scratch always installs for the current user.

## [1.5.0] - 2026-11-15

### Added
- **Settings** window ("Settings…" in the menu): window size (80% to 150%), animations, transparency for all notes, keep on top, rotating headlines, color of new notes, deadline reminders, notification sound, open at sign-in, collapse notes at launch, Pomodoro lengths, and restore defaults. The menu's switches are unchanged.
- Custom Pomodoro lengths (focus 1 to 180 minutes, break 1 to 60) with presets, set in the Pomodoro window or in Settings.
- Short, soft animations throughout (windows opening and closing, notes expanding, lists, switches, the timer). Settings › Animations turns them off, and Windows' reduce-motion setting is respected.
- More settings: what the + pad creates, the hour for deadlines without a time, starting the next Pomodoro focus session by itself, and Pomodoro alerts.
- The **+** in the add-a-task field is a button: once you have typed something it turns blue and adds the task.

### Changed
- The focus timer is now called **Pomodoro**.
- The white pill under Day / Month rolls across to the tab you pick, and the date or month label slides in. Completing, un-completing and deleting a task are smoother: the ring pops, the finished task fades and drifts off before the gap closes, and tasks slide into and out of Completed.
- The three-dot menu is shorter: Collapse all, Expand all, Settings, Open data folder, About, Quit. Everything it lost is in Settings or on the launcher's own buttons.
- Twelve note colors (six new: Coral, Lime, Aqua, Orchid, Sand, Stone).
- The launcher's buttons are a little bigger. The About window no longer repeats who developed the app. Settings has a plain sans-serif title.
- The installer's welcome page says it was developed by Arian, Sadif and Shibly.
- Removed the company name from the installer's side image and from the About screenshot.
- Smaller installer: about 14% smaller (English-only Chromium language files, the unused WebGPU shader-compiler DLLs dropped, maximum compression). A crashed window is reloaded automatically.

### Fixed
- Ticking a task, unticking it from Completed and deleting a task could feel laggy. Rows now move with compositor-only animations (a task flies into Completed and back, the rows below slide up to close the gap), nothing re-lays out the list on every frame, the paper texture is a small image instead of a live filter, and saving to disk happens off the main thread.

## [1.4.0] - 2026-11-15

### Changed
- The app is now called **Scratch** (it was Sticky Notes). Updating replaces Sticky Notes in place, keeps your "start with Windows" choice, and copies your notes from `%APPDATA%\Sticky Notes` the first time Scratch starts. The old folder is left as a backup.
- Released as open source under the MIT License.

### Added
- **About Scratch** in the menu: version, the developers, the publisher and the licence.
- Licence texts for Electron, React and the bundled fonts, installed with the app.

### Fixed
- Building the installer failed when a `GH_TOKEN` or `GITHUB_TOKEN` environment variable was set, because electron-builder tried to publish on its own.

## [1.3.0] - 2026-11-14

### Added
- Windows installer with a setup wizard: choose the folder, Desktop and Start Menu shortcuts, and an option to start with Windows (on by default). Installs per user, with no administrator rights.
- Publisher shown as Arian, Sadif & Shibly in file properties and Installed Apps.
- Customer installation guide (PDF).

### Fixed
- "Open when I sign in" showed as off when it was on, because Electron misreads the startup entry for paths containing spaces. It also now reflects changes made in Task Manager.

### Security
- The shipped executable can no longer be used to run other scripts (Electron fuses).

## [1.2.1] - 2026-11-12

### Changed
- Bolder text throughout for readability.

## [1.2.0] - 2026-11-12

### Added
- Rotating headline: each note's strip cycles through its unfinished tasks, most urgent first.

### Fixed
- The colour palette was cut off on a collapsed note.
- The tape on today's note let the desktop show through.
- Note titles could be clipped.

## [1.1.0] - 2026-11-12

### Added
- Deadlines on any task, with countdowns, overdue markers and Windows notifications.
- Per-note transparency, a manager for hidden notes, a focus timer, and a "Completed" section on each note.

## [1.0.0] - 2026-11-06

### Added
- First release: floating, always-on-top sticky notes with daily lists and monthly goals, animated check-off, six colours, collapse and hide, and automatic saving.
