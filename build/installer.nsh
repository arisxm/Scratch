; Scratch by Arian, Sadif & Shibly: installer customisations.
;
; electron-builder includes this file before its own scripts, so anything that
; needs NSIS libraries (LogicLib, nsDialogs, MUI) lives inside the macros
; below, which electron-builder expands later at the right points:
;   customInstallMode         .onInit, choosing per-user vs per-machine
;   customWelcomePage         first page of the wizard
;   customPageAfterChangeDir  after "Choose Install Location"
;   customInit                end of .onInit (installer only)
;   customInstall             after the app files are copied
;   customUnInstall           start of uninstall (also runs during upgrades)

!include WordFunc.nsh

; "Start with Windows" is a per-user Run entry. The app writes the very same
; entry from its menu (electron/startup.js), so name and format must match
; what Electron writes: value name = the app's AppUserModelId, value data =
; the quoted exe path with no arguments.
!define STARTUP_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define STARTUP_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
; Kept from when the app was called Sticky Notes: renaming it would orphan
; existing startup entries.
!define STARTUP_VALUE "com.stickynotes.desktop" ; = APP_ID in electron/main.js
; Earlier versions never turned startup on by default, so an upgrade from
; one of them is treated like a fresh install.
!define STARTUP_DEFAULT_SINCE "1.3.0"

; Install for the current Windows user only. No administrator prompt, the
; app goes to %LOCALAPPDATA%\Programs unless the customer picks a folder,
; and the uninstall entry and startup entry belong to that user.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Scratch"
  !define MUI_WELCOMEPAGE_TEXT "This will install Scratch ${VERSION}, developed by Arian, Sadif and Shibly.$\r$\n$\r$\nSticky notes that stay on your desktop, above your other windows, with daily lists, monthly goals and deadline reminders.$\r$\n$\r$\nNo administrator rights are needed.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  Var /GLOBAL StartupChoice ; "1" = start with Windows
  Var /GLOBAL StartupCheckbox
  Page custom StartupPageShow StartupPageLeave

  Function StartupPageShow
    !insertmacro MUI_HEADER_TEXT "Start with Windows" "Choose whether Scratch opens when you sign in."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 30u "Scratch can open automatically when you sign in to Windows, so your notes are on your desktop straight away. You can change this at any time in Scratch's Settings."
    Pop $0
    ${NSD_CreateCheckbox} 0 40u 100% 12u "&Start Scratch when I sign in to Windows (recommended)"
    Pop $StartupCheckbox
    ${If} $StartupChoice == "1"
      ${NSD_Check} $StartupCheckbox
    ${EndIf}
    nsDialogs::Show
  FunctionEnd

  Function StartupPageLeave
    ${NSD_GetState} $StartupCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $StartupChoice "1"
    ${Else}
      StrCpy $StartupChoice "0"
    ${EndIf}
  FunctionEnd
!macroend

; Default for the startup option, decided before any page is shown (and the
; only decision in a silent /S install): on for a fresh install, and on for
; an upgrade from a version before ${STARTUP_DEFAULT_SINCE}. Otherwise keep
; the customer's current choice, so an update never turns it back on after
; they switched it off.
!macro customInit
  StrCpy $StartupChoice "1"
  ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${If} $0 != ""
    ${VersionCompare} $0 "${STARTUP_DEFAULT_SINCE}" $1 ; 2 = installed version is older
    ${If} $1 != "2"
      ReadRegStr $2 HKCU "${STARTUP_RUN_KEY}" "${STARTUP_VALUE}"
      ${If} $2 == ""
        StrCpy $StartupChoice "0"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  ${If} $StartupChoice == "1"
    WriteRegStr HKCU "${STARTUP_RUN_KEY}" "${STARTUP_VALUE}" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  ${Else}
    DeleteRegValue HKCU "${STARTUP_RUN_KEY}" "${STARTUP_VALUE}"
  ${EndIf}
!macroend

; An upgrade runs the previous version's uninstaller with --updated before
; installing; the startup entry must survive that. A real uninstall removes
; it, along with Windows' "disabled in Task Manager" mark for it. Shortcuts
; and the uninstall entry are removed by electron-builder itself. Notes live
; in %APPDATA%\Scratch (and %APPDATA%\Sticky Notes for users of versions
; before 1.4.0) and are deliberately kept.
!macro customUnInstall
  ${IfNot} ${isUpdated}
    DeleteRegValue HKCU "${STARTUP_RUN_KEY}" "${STARTUP_VALUE}"
    DeleteRegValue HKCU "${STARTUP_APPROVED_KEY}" "${STARTUP_VALUE}"
  ${EndIf}
!macroend
