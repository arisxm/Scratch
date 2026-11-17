# Scratch for Android

Version 1.6.0 (set in `app/build.gradle`, separately from the desktop app's version in `package.json`).

The Scratch desktop app, on Android. The **Scratch logo floats over every app** (just the logo, no background): drag it anywhere on the screen and it docks to the nearest side when you let go. While you drag it, a round **×** appears at the bottom of the screen: drop the logo on it to close Scratch (the same as Quit Scratch in the menu). Tap the logo for the features:

- **Sticky note**: a new note floating over your other apps, just like on the desktop
- **Notepad**: the drawing pad, full screen
- **Pomodoro**: the focus timer
- **Hidden notes**: restore or delete closed notes and notepads (shows how many there are)
- **Hide notes for now / Show notes**: get every note out of the way for a moment, and back
- **Collapse all / Expand all**
- **Settings**, **About Scratch**, **Quit Scratch**

Everything else works as on the desktop: drag a note by its coloured top strip, resize it from the bottom-right corner, **long-press** the top strip for the note menu (daily/monthly, collapse, clear completed, hide, delete), deadlines with countdowns and reminders, colours and transparency, the rotating headline, and Settings. Notes are saved on the phone only, in Scratch's private storage.

## Install the test build

1. Copy `Scratch-debug.apk` (in this folder after a build; see below) to the phone and open it. Allow installing from that source if Android asks.
2. Open **Scratch**. It asks for **Display over other apps**: turn it on for Scratch and go back. Then allow notifications (for deadline reminders and Pomodoro alerts).
3. The Scratch button appears, with a "Start here" note on the first run.

With a USB cable and USB debugging on: `adb install -r android/Scratch-debug.apk`.

Android 8.0 (API 26) or newer. The notes and panels run in the phone's Android System WebView, which updates through the Play Store.

## Build

Needs Node.js with `npm install` already run in the repository root, a JDK 17, and the Android SDK (platform 35, build-tools 35). Then, from the repository root:

```
powershell -ExecutionPolicy Bypass -File android\build-apk.ps1
```

This builds the web UI into `app/src/main/assets/web` and then `app/build/outputs/apk/debug/app-debug.apk`. The script looks for `JAVA_HOME` and `ANDROID_HOME` and falls back to `%LOCALAPPDATA%\Android\jdk-17*` and `%LOCALAPPDATA%\Android\Sdk`. Opening this folder in Android Studio works too, once the web UI has been built once (the first step of the script).

## How it works

The desktop app is unchanged; this folder only adds to it.

- **The UI is the desktop UI.** `vite.config.mjs` builds `../src` as it is, with one extra script loaded first, `web/bridge.js`. That script provides `window.sticky`, the API that `electron/preload.js` gives the desktop pages, on top of a Java object the app adds to each WebView (`Bridge.java`). The channel names are the desktop IPC channels, so the Java side reads like `electron/main.js`.
- **`ScratchService` is `electron/main.js`.** A foreground service owns the data and the windows. `Schema`, `Store`, `NotepadStore`, `Pomodoro` and `Reminders` are ports of the matching `electron/*.js` files: the same data file layout (`sticky-notes.json`, with note positions in dp instead of desktop pixels), the same validation of everything a page sends, and the same atomic saves with a `.bak` copy.
- **Each note is a floating window** (`Panel.java`, a WebView in a `TYPE_APPLICATION_OVERLAY` window), like the desktop's one frameless window per note. The page reports when a press starts on a header or the corner grip, and Java moves or resizes the window with the finger. A window takes keyboard focus only after it is touched and gives it back on any touch elsewhere, so Back and the keyboard keep working in the app underneath.
- **The bubble and its menu** (`Bubble.java`) are native views, standing in for the desktop launcher pad, its ⋯ menu and the tray menu.
- **Notepads open full screen** in `NotepadActivity`. One is open at a time on a phone, and leaving it (× or Back) saves the drawing and puts it under Hidden notes, as closing a notepad window does on the desktop. "Save as picture" saves into Pictures/Scratch.
- **Phone-only adjustments**, all in `web/bridge.js`: date and time fields in floating notes open Android's pickers (a WebView floating over other apps can't open its own); per-task buttons stay faintly visible, since there is no hover; the corner grip is bigger; "Keep notes on top" is hidden, because notes always float on Android; and the notepad has no Minimize or Maximize.
- **Reminders and Pomodoro** keep running in the service and also set an alarm, so they arrive on time while the phone sleeps.

## Slower phones

Every note is its own web page, so Scratch keeps that cheap everywhere and does less on a slower phone (low-RAM, 3 GB of memory or less, or 4 cores or fewer; `ScratchService.detectLowEnd`):

- Saved notes open one after another when Scratch starts, not all at once (all phones; more spaced out on slower ones).
- A page that isn't on screen is paused: notes hidden with "Hide notes for now", every page while the screen is off, and the notepad in the background.
- Dragging a note or the button moves its window at most once per screen frame.
- The alarm for reminders and Pomodoro is only set again when its time changes.
- On a slower phone: animations start switched off (Settings > Animations turns them back on), notes have no paper texture and one shadow instead of three, and the pulsing overdue dot and the breathing Pomodoro ring stand still.

## Known limits of this first version

- Only the web side has been tested automatically: the Android pages loaded in a browser with a stand-in for the Java side, checking notes, tasks, deadlines, the pickers, settings, all the panels and the notepad's save and close. The Java side has been built and checked with Android Lint, but **not yet run on a phone or emulator**. Please report anything odd.
- One notepad screen at a time (the desktop allows several windows).
- Pasting a picture into a notepad from the clipboard isn't supported; use the picture button.
- "Open when I sign in" in Settings means "when the phone starts".
