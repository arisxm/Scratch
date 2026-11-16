#!/usr/bin/env bash
# Installs, launches, upgrades and uninstalls release/Scratch_Setup.exe in
# a brand-new Wine profile and checks every result. Wine is a stand-in for a
# clean Windows PC: it exercises the real installer, registry and file layout,
# but it is not Windows (see the README for what still needs a real PC).
#   needs: wine (with 32-bit support), Xvfb
#   usage: ./scripts/test-installer-wine.sh [path/to/Scratch_Setup.exe]
set -uo pipefail
cd "$(dirname "$0")/.."
SETUP="$(realpath "${1:-release/Scratch_Setup.exe}")"
VERSION="$(node -p "require('./package.json').version")"
# Optional: the Sticky Notes 1.3.0 installer, to test upgrading from the old name.
OLD_SETUP="${OLD_SETUP:-}"
export WINEDEBUG=-all WINEPREFIX="${WINEPREFIX_TEST:-/tmp/wp-clean}" WINEDLLOVERRIDES="mscoree,mshtml="
# One virtual display for the whole run. Starting a separate one per command
# (xvfb-run -a) occasionally collided on the same display number, which made
# the app lose its display and exit, and once left an installer hanging.
export DISPLAY=:57
Xvfb :57 -screen 0 1600x900x24 -nolisten tcp >/dev/null 2>&1 & XVFB_PID=$!
trap 'wineserver -k >/dev/null 2>&1; kill $XVFB_PID 2>/dev/null' EXIT
sleep 2
rm -rf "$WINEPREFIX"; timeout 180 wineboot -i >/dev/null 2>&1
# Wine's powershell.exe is a stub that returns success for every command, so
# the installer would believe the app is always running and abort a silent
# install (exit code 2). Removing the stub makes it use its tasklist check,
# the same route it takes on Windows PCs without PowerShell.
find "$WINEPREFIX/drive_c/windows" -ipath '*WindowsPowerShell*' -iname powershell.exe -delete

PASS=0; FAIL=0
check() { if [ "$2" = "0" ]; then echo "PASS  $1"; PASS=$((PASS+1)); else echo "FAIL  $1  ${3:-}"; FAIL=$((FAIL+1)); fi; }
is() { [ "$1" = "$2" ] && echo 0 || echo 1; }
w() { timeout 240 wine "$@" >/dev/null 2>&1; }
reg_get() { wine reg query "$1" /v "$2" 2>/dev/null | tr -d '\r' | awk -v v="$2" '$1==v { $1=""; $2=""; sub(/^  /, ""); print }'; }
reg_has() { wine reg query "$1" /v "$2" >/dev/null 2>&1 && echo 0 || echo 1; }
upath() { winepath -u "$1" 2>/dev/null; }
RUN='HKCU\Software\Microsoft\Windows\CurrentVersion\Run'
APPROVED='HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
VALUE='com.stickynotes.desktop'
APPDATA_U="$(upath "$(wine cmd /c echo %APPDATA% 2>/dev/null | tr -d '\r')")"
DATA="$APPDATA_U/Scratch/sticky-notes.json"
uninstall_key() { wine reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall' 2>/dev/null | tr -d '\r' | grep -i 'Uninstall\\' | while read -r k; do [ "$(reg_get "$k" DisplayName)" = "Scratch" ] && echo "$k"; done | head -1; }
app_procs() { ps -eo args | grep -i 'Scratch.exe' | grep -v -- '--type=' | grep -v grep | wc -l; }
stop_app() { wineserver -k >/dev/null 2>&1; sleep 2; }
install_silent() { w "$SETUP" /S; sleep 3; }

echo "== 1. Fresh install (silent, as a customer's IT might run it)"
install_silent
KEY="$(uninstall_key)"
check "listed in Installed Apps (per-user uninstall entry)" "$([ -n "$KEY" ] && echo 0 || echo 1)"
# electron-builder doesn't put InstallLocation in the uninstall entry; take the
# folder from the uninstall command, as Windows itself does.
UNINST_W="$(reg_get "$KEY" UninstallString | sed -E 's/^"([^"]+)".*/\1/')"
INSTDIR_W="${UNINST_W%\\*}"; INSTDIR="$(upath "$INSTDIR_W")"
EXE_W="$INSTDIR_W\\Scratch.exe"
check "app installed" "$([ -f "$INSTDIR/Scratch.exe" ] && echo 0 || echo 1)" "$INSTDIR"
check "installed under the user's own profile (no admin needed)" "$(echo "$INSTDIR_W" | grep -qi 'AppData\\Local\\Programs' && echo 0 || echo 1)" "$INSTDIR_W"
check "nothing written machine-wide (HKLM)" "$(wine reg query 'HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall' /s 2>/dev/null | grep -qiE 'Scratch|Sticky Notes' && echo 1 || echo 0)"
check "Publisher = Arian, Sadif & Shibly" "$(is "$(reg_get "$KEY" Publisher)" 'Arian, Sadif & Shibly')" "$(reg_get "$KEY" Publisher)"
check "DisplayName = Scratch" "$(is "$(reg_get "$KEY" DisplayName)" 'Scratch')"
check "DisplayVersion = $VERSION" "$(is "$(reg_get "$KEY" DisplayVersion)" "$VERSION")" "$(reg_get "$KEY" DisplayVersion)"
check "has an icon and a working uninstall command" "$([ -n "$(reg_get "$KEY" DisplayIcon)" ] && [ -f "$INSTDIR/Uninstall Scratch.exe" ] && echo 0 || echo 1)"
check "startup enabled by default, pointing at the installed exe" "$(is "$(reg_get "$RUN" "$VALUE")" "\"$EXE_W\"")" "$(reg_get "$RUN" "$VALUE")"
DESKTOP="$(upath "$(wine cmd /c echo %USERPROFILE% 2>/dev/null | tr -d '\r')\\Desktop")"
STARTMENU="$APPDATA_U/Microsoft/Windows/Start Menu/Programs"
check "Desktop shortcut" "$([ -f "$DESKTOP/Scratch.lnk" ] && echo 0 || echo 1)" "$DESKTOP"
check "Start Menu shortcut" "$([ -f "$STARTMENU/Scratch.lnk" ] && echo 0 || echo 1)"

echo "== 2. Launch exactly as Windows does at sign-in"
CMD="$(reg_get "$RUN" "$VALUE")"; CMD="${CMD#\"}"; CMD="${CMD%\"}"
(cd /tmp && timeout 300 wine "$CMD" --disable-gpu >/dev/null 2>&1 &)
for i in $(seq 1 60); do [ -f "$DATA" ] && break; sleep 1; done
sleep 4
check "app starts and saves its data" "$([ -f "$DATA" ] && echo 0 || echo 1)"
check "first run shows the welcome note" "$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d['notes'] and d['notes'][0]['title']=='Start here' else 1)" "$DATA" && echo 0 || echo 1)"
check "the app sees startup as on" "$(python3 -c "import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))['settings']['openAtLogin'] is True else 1)" "$DATA" && echo 0 || echo 1)"
# Not tested here: staying open and single-instance. Electron 44 itself
# (stock, without this app) crashes under Wine a few seconds after starting,
# so a running first copy can't be kept alive. The smoke test covers
# single-instance on the Linux build; see the README for the real-PC check.
stop_app
NOTES_SUM="$(sha256sum "$DATA" | cut -c1-16)"

echo "== 3. Update over the top (startup on)"
install_silent
check "startup still on after updating" "$(is "$(reg_get "$RUN" "$VALUE")" "\"$EXE_W\"")"
check "notes untouched by the update" "$(is "$(sha256sum "$DATA" | cut -c1-16)" "$NOTES_SUM")"
check "still exactly one Installed Apps entry" "$(is "$(wine reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall' /s 2>/dev/null | tr -d '\r' | grep -c 'DisplayName.*Scratch$')" 1)"

echo "== 4. Customer switched startup off, then updates"
wine reg delete "$RUN" /v "$VALUE" /f >/dev/null 2>&1
install_silent
check "update respects the customer's choice (stays off)" "$(reg_has "$RUN" "$VALUE" | sed 's/0/X/;s/1/0/;s/X/1/')"
check "notes untouched" "$(is "$(sha256sum "$DATA" | cut -c1-16)" "$NOTES_SUM")"

echo "== 5. Upgrade from a version before 1.3.0 (startup was opt-in then)"
wine reg add "$KEY" /v DisplayVersion /t REG_SZ /d 1.2.1 /f >/dev/null 2>&1
install_silent
check "startup turned on, as the new default" "$(is "$(reg_get "$RUN" "$VALUE")" "\"$EXE_W\"")"

echo "== 6. Uninstall from Windows Settings (quiet uninstall command)"
wine reg add "$APPROVED" /v "$VALUE" /t REG_BINARY /d 030000000000000000000000 /f >/dev/null 2>&1
QUIET="$(reg_get "$KEY" QuietUninstallString)"
UNEXE="$(echo "$QUIET" | sed -E 's/^"([^"]+)".*/\1/')"; UNARGS="$(echo "$QUIET" | sed -E 's/^"[^"]+" ?//')"
w "$UNEXE" $UNARGS
for i in $(seq 1 60); do [ ! -f "$INSTDIR/Scratch.exe" ] && break; sleep 1; done; sleep 3
check "app files removed" "$([ ! -e "$INSTDIR/Scratch.exe" ] && echo 0 || echo 1)"
check "Installed Apps entry removed" "$([ -z "$(uninstall_key)" ] && echo 0 || echo 1)"
check "startup entry removed" "$(reg_has "$RUN" "$VALUE" | sed 's/0/X/;s/1/0/;s/X/1/')"
check "Task Manager startup record removed" "$(reg_has "$APPROVED" "$VALUE" | sed 's/0/X/;s/1/0/;s/X/1/')"
check "Desktop shortcut removed" "$([ ! -e "$DESKTOP/Scratch.lnk" ] && echo 0 || echo 1)"
check "Start Menu shortcut removed" "$([ ! -e "$STARTMENU/Scratch.lnk" ] && echo 0 || echo 1)"
check "the customer's notes are kept (reinstalling brings them back)" "$(is "$(sha256sum "$DATA" 2>/dev/null | cut -c1-16)" "$NOTES_SUM")"

if [ -n "$OLD_SETUP" ]; then
echo "== 7. Upgrade from Sticky Notes 1.3.0 (the app's old name)"
OLD_DATA="$APPDATA_U/Sticky Notes/sticky-notes.json"
rm -rf "$APPDATA_U/Scratch" "$APPDATA_U/Sticky Notes"
w "$(realpath "$OLD_SETUP")" /S; sleep 3
OLDKEY="$(wine reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall' 2>/dev/null | tr -d '\r' | grep -i 'Uninstall\\' | while read -r k; do [ "$(reg_get "$k" DisplayName)" = "Sticky Notes" ] && echo "$k"; done | head -1)"
OLD_UNINST="$(reg_get "$OLDKEY" UninstallString | sed -E 's/^"([^"]+)".*/\1/')"; OLD_DIR_W="${OLD_UNINST%\\*}"; OLD_DIR="$(upath "$OLD_DIR_W")"
check "Sticky Notes 1.3.0 installed" "$([ -f "$OLD_DIR/Sticky Notes.exe" ] && [ -f "$DESKTOP/Sticky Notes.lnk" ] && echo 0 || echo 1)" "$OLD_DIR_W"
mkdir -p "$APPDATA_U/Sticky Notes"
python3 - "$OLD_DATA" <<'PY'
import json, sys
note = {"id": "old-note-1", "title": "From Sticky Notes", "color": "mint", "mode": "daily", "date": "2026-11-14", "month": "2026-11",
        "tasks": [{"id": "t1", "text": "Bring me along", "done": False, "createdAt": 1, "completedAt": None, "deadline": None}],
        "collapsed": False, "hidden": False, "bounds": {"x": 120, "y": 140, "width": 300, "height": 360}, "createdAt": 1, "updatedAt": 1}
json.dump({"version": 1, "settings": {"alwaysOnTop": True}, "notes": [note]}, open(sys.argv[1], "w"))
PY
OLD_SUM="$(sha256sum "$OLD_DATA" | cut -c1-16)"
install_silent
KEY="$(uninstall_key)"
NEWDIR_W="$(reg_get "$KEY" UninstallString | sed -E 's/^"([^"]+)".*/\1/')"; NEWDIR_W="${NEWDIR_W%\\*}"; NEWDIR="$(upath "$NEWDIR_W")"
ENTRIES="$(wine reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall' /s 2>/dev/null | tr -d '\r' | grep -cE 'DisplayName +REG_SZ +(Scratch|Sticky Notes)$')"
check "one Installed Apps entry, now called Scratch" "$([ -n "$KEY" ] && [ "$ENTRIES" = 1 ] && echo 0 || echo 1)" "entries=$ENTRIES"
check "Scratch.exe installed, old exe gone" "$([ -f "$NEWDIR/Scratch.exe" ] && [ ! -e "$NEWDIR/Sticky Notes.exe" ] && [ ! -e "$OLD_DIR/Sticky Notes.exe" ] && echo 0 || echo 1)" "new: $NEWDIR_W  old: $OLD_DIR_W"
check "shortcuts renamed (no broken Sticky Notes shortcuts left)" "$([ -f "$DESKTOP/Scratch.lnk" ] && [ -f "$STARTMENU/Scratch.lnk" ] && [ ! -e "$DESKTOP/Sticky Notes.lnk" ] && [ ! -e "$STARTMENU/Sticky Notes.lnk" ] && echo 0 || echo 1)" "$(ls "$DESKTOP" "$STARTMENU" 2>/dev/null | grep -i lnk | tr '\n' ' ')"
check "startup entry points at Scratch.exe" "$(is "$(reg_get "$RUN" "$VALUE")" "\"$NEWDIR_W\\Scratch.exe\"")" "$(reg_get "$RUN" "$VALUE")"
CMD="$(reg_get "$RUN" "$VALUE")"; CMD="${CMD#\"}"; CMD="${CMD%\"}"
(cd /tmp && timeout 300 wine "$CMD" --disable-gpu >/dev/null 2>&1 &)
for i in $(seq 1 60); do [ -f "$DATA" ] && break; sleep 1; done; sleep 4
check "first launch brings the old notes into Scratch" "$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); n=[x for x in d['notes'] if x['id']=='old-note-1']; sys.exit(0 if n and n[0]['tasks'][0]['text']=='Bring me along' else 1)" "$DATA" 2>/dev/null && echo 0 || echo 1)"
check "the old notes folder is left untouched as a backup" "$(is "$(sha256sum "$OLD_DATA" | cut -c1-16)" "$OLD_SUM")"
stop_app
fi

echo; echo "installer tests: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
