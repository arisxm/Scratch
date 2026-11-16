# Security policy

## Supported versions

Security fixes are made for the latest release of Scratch. Please update before reporting.

## Reporting a vulnerability

**Please do not report security problems in public issues.**

Use GitHub's private reporting instead: open the repository's **Security** tab and choose **Report a vulnerability**. Only the maintainers can see what you send.

Please include what the problem is, how to reproduce it, and what an attacker could do with it. We'll acknowledge the report, keep you updated, and credit you in the release notes unless you'd rather stay anonymous.

## What Scratch does to stay safe

- Every window runs with Electron's context isolation and sandbox, without Node.js access. Windows can only use the small API in `electron/preload.js`, and the main process validates everything they send.
- Navigation, new windows and web permission requests are blocked, and the app loads nothing from the internet.
- The shipped executable has the `runAsNode`, `NODE_OPTIONS` and inspector fuses switched off, so it can only run Scratch.
- Notes are stored only on the user's PC, in `%APPDATA%\Scratch`.
