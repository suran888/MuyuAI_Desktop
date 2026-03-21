// src/bridge/windowBridge.js
const { ipcMain, shell } = require('electron');

// The bridge only registers IPC handlers (no business logic)
module.exports = {
  initialize() {
    // Require windowManager during initialize to resolve circular dependency
    const windowManager = require('../window/windowManager');

    // Existing IPC handlers
    ipcMain.handle('toggle-content-protection', () => windowManager.toggleContentProtection());
    ipcMain.handle('resize-header-window', (event, args) => windowManager.resizeHeaderWindow(args));
    ipcMain.handle('get-content-protection-status', () => windowManager.getContentProtectionStatus());
    ipcMain.on('show-settings-window', () => windowManager.showSettingsWindow());
    ipcMain.on('hide-settings-window', () => windowManager.hideSettingsWindow());
    ipcMain.on('cancel-hide-settings-window', () => windowManager.cancelHideSettingsWindow());

    ipcMain.handle('open-external', (event, url) => shell.openExternal(url));
    ipcMain.handle('move-window-step', (event, direction) => windowManager.moveWindowStep(direction));

    // Newly moved handlers from windowManager
    ipcMain.on('header-state-changed', (event, state) => windowManager.handleHeaderStateChanged(state));
    ipcMain.on('header-animation-finished', (event, state) => windowManager.handleHeaderAnimationFinished(state));
    ipcMain.handle('get-header-position', () => windowManager.getHeaderPosition());
    ipcMain.handle('move-header-to', (event, newX, newY) => windowManager.moveHeaderTo(newX, newY));
    ipcMain.handle('adjust-window-height', (event, { winName, height }) => windowManager.adjustWindowHeight(winName, height));
    ipcMain.on('resize-main-window', (event, params) => windowManager.resizeMainWindow(event.sender, params));
    ipcMain.on('clear-window-resize-state', (event) => windowManager.clearWindowResizeState());
  },

  notifyFocusChange(win, isFocused) {
    win.webContents.send('window:focus-change', isFocused);
  }
};