'use strict';
// Runs sandboxed with contextIsolation. Exposes a small, explicit API instead
// of ipcRenderer itself, so page code can't send arbitrary channels. Note
// windows never pass a note id: the main process works out which note a
// window owns from the sender, so one note can't read or edit another.

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('sticky', {
  note: {
    get: () => ipcRenderer.invoke('note:get'),
    update: (patch) => ipcRenderer.send('note:update', patch),
    setCollapsed: (collapsed) => ipcRenderer.invoke('note:set-collapsed', collapsed),
    setPopoverHeight: (height) => ipcRenderer.send('note:popover-height', height),
    resize: (size) => ipcRenderer.send('note:resize', size),
    hide: () => ipcRenderer.send('note:hide'),
    openMenu: () => ipcRenderer.send('note:context-menu'),
    onChanged: (callback) => subscribe('note:changed', callback),
  },
  app: {
    newNote: (mode) => ipcRenderer.send('app:new-note', { mode }), // no mode: the Settings default
    openMenu: () => ipcRenderer.send('app:menu'),
    openManager: () => ipcRenderer.send('app:open-manager'),
    openTimer: () => ipcRenderer.send('app:open-timer'),
    openSettings: () => ipcRenderer.send('app:open-settings'),
    hiddenCount: () => ipcRenderer.invoke('app:hidden-count'),
    onHiddenCount: (callback) => subscribe('launcher:hidden-count', callback),
    closeWindow: () => ipcRenderer.send('window:close'),
  },
  // Hidden-notes manager. The main process ignores these from other windows.
  hidden: {
    list: () => ipcRenderer.invoke('hidden:list'),
    restore: (ids) => ipcRenderer.invoke('hidden:restore', ids),
    remove: (ids) => ipcRenderer.invoke('hidden:delete', ids), // asks for confirmation; resolves to the number deleted
    onChanged: (callback) => subscribe('hidden:changed', callback),
  },
  // About window.
  about: {
    get: () => ipcRenderer.invoke('about:get'),
    openRepository: () => ipcRenderer.send('about:open-repository'),
  },
  // Settings. Every window can read them (to follow the animation setting);
  // the main process only accepts changes from the Settings window.
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key, value) => ipcRenderer.send('settings:set', key, value),
    action: (name) => ipcRenderer.send('settings:action', name),
    onChanged: (callback) => subscribe('settings:changed', callback),
  },
  // Pomodoro. The countdown lives in the main process.
  timer: {
    get: () => ipcRenderer.invoke('timer:get'),
    command: (name) => ipcRenderer.send('timer:command', name),
    setLengths: (lengths) => ipcRenderer.send('timer:set-lengths', lengths),
    onChanged: (callback) => subscribe('timer:changed', callback),
  },
});
