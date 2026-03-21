const { BrowserWindow, globalShortcut, screen, app, shell } = require('electron');
const WindowLayoutManager = require('./windowLayoutManager');
const SmoothMovementManager = require('./smoothMovementManager');
const path = require('node:path');
const os = require('os');
const shortcutsService = require('../features/shortcuts/shortcutsService');
const internalBridge = require('../bridge/internalBridge');
const permissionRepository = require('../features/common/repositories/permission');

/* ────────────────[ GLASS BYPASS ]─────────────── */
let liquidGlass;
const isLiquidGlassSupported = () => {
    if (process.platform !== 'darwin') {
        return false;
    }
    const majorVersion = parseInt(os.release().split('.')[0], 10);
    // return majorVersion >= 25; // macOS 26+ (Darwin 25+)
    return majorVersion >= 26; // See you soon!
};
let shouldUseLiquidGlass = isLiquidGlassSupported();
if (shouldUseLiquidGlass) {
    try {
        liquidGlass = require('electron-liquid-glass');
    } catch (e) {
        console.warn('Could not load optional dependency "electron-liquid-glass". The feature will be disabled.');
        shouldUseLiquidGlass = false;
    }
}
/* ────────────────[ GLASS BYPASS ]─────────────── */

let isContentProtectionOn = process.env.MUYU_CONTENT_PROTECTION !== 'false';  // 这个字段控制整个窗口的默认显示与隐藏 true: 隐藏；false：显示
let isAlwaysOnTopOn = process.env.MUYU_ALWAYS_ON_TOP !== 'false';
let lastVisibleWindows = new Set(['header']);

let currentHeaderState = 'apikey';
const windowPool = new Map();

let settingsHideTimer = null;


let layoutManager = null;
let movementManager = null;


function updateChildWindowLayouts(animated = true) {
    // if (movementManager.isAnimating) return;

    const visibleWindows = {};
    const listenWin = windowPool.get('listen');
    const askWin = windowPool.get('ask');
    if (listenWin && !listenWin.isDestroyed() && listenWin.isVisible()) {
        visibleWindows.listen = true;
    }
    if (askWin && !askWin.isDestroyed() && askWin.isVisible()) {
        visibleWindows.ask = true;
    }

    if (Object.keys(visibleWindows).length === 0) return;

    const newLayout = layoutManager.calculateFeatureWindowLayout(visibleWindows);
    movementManager.animateLayout(newLayout, animated);
}

const showSettingsWindow = () => {
    internalBridge.emit('window:requestVisibility', { name: 'settings', visible: true });
};

const hideSettingsWindow = () => {
    internalBridge.emit('window:requestVisibility', { name: 'settings', visible: false });
};

const cancelHideSettingsWindow = () => {
    internalBridge.emit('window:requestVisibility', { name: 'settings', visible: true });
};

const moveWindowStep = (direction) => {
    internalBridge.emit('window:moveStep', { direction });
};

const resizeHeaderWindow = ({ width, height, minWidth, minHeight }) => {
    internalBridge.emit('window:resizeHeaderWindow', { width, height, minWidth, minHeight });
};

const handleHeaderAnimationFinished = (state) => {
    internalBridge.emit('window:headerAnimationFinished', state);
};

const getHeaderPosition = () => {
    return new Promise((resolve) => {
        internalBridge.emit('window:getHeaderPosition', (position) => {
            resolve(position);
        });
    });
};

const moveHeaderTo = (newX, newY) => {
    internalBridge.emit('window:moveHeaderTo', { newX, newY });
};

const adjustWindowHeight = (winName, targetHeight) => {
    internalBridge.emit('window:adjustWindowHeight', { winName, targetHeight });
};


function setupWindowController(windowPool, layoutManager, movementManager) {
    internalBridge.on('window:requestVisibility', ({ name, visible }) => {
        handleWindowVisibilityRequest(windowPool, layoutManager, movementManager, name, visible);
    });
    internalBridge.on('window:requestToggleAllWindowsVisibility', ({ targetVisibility }) => {
        changeAllWindowsVisibility(windowPool, targetVisibility);
    });
    internalBridge.on('window:moveToDisplay', ({ displayId }) => {
        // movementManager.moveToDisplay(displayId);
        const header = windowPool.get('header');
        if (header) {
            const newPosition = layoutManager.calculateNewPositionForDisplay(header, displayId);
            if (newPosition) {
                movementManager.animateWindowPosition(header, newPosition, {
                    onComplete: () => updateChildWindowLayouts(true)
                });
            }
        }
    });
    internalBridge.on('window:moveToEdge', ({ direction }) => {
        const header = windowPool.get('header');
        if (header) {
            const newPosition = layoutManager.calculateEdgePosition(header, direction);
            movementManager.animateWindowPosition(header, newPosition, {
                onComplete: () => updateChildWindowLayouts(true)
            });
        }
    });

    internalBridge.on('window:moveStep', ({ direction }) => {
        const header = windowPool.get('header');
        if (header) {
            const newHeaderPosition = layoutManager.calculateStepMovePosition(header, direction);
            if (!newHeaderPosition) return;

            const futureHeaderBounds = { ...header.getBounds(), ...newHeaderPosition };
            const visibleWindows = {};
            const listenWin = windowPool.get('listen');
            const askWin = windowPool.get('ask');
            if (listenWin && !listenWin.isDestroyed() && listenWin.isVisible()) {
                visibleWindows.listen = true;
            }
            if (askWin && !askWin.isDestroyed() && askWin.isVisible()) {
                visibleWindows.ask = true;
            }

            const newChildLayout = layoutManager.calculateFeatureWindowLayout(visibleWindows, futureHeaderBounds);

            movementManager.animateWindowPosition(header, newHeaderPosition);
            movementManager.animateLayout(newChildLayout);
        }
    });

    internalBridge.on('window:resizeHeaderWindow', ({ width, height, minWidth, minHeight }) => {
        // 最小尺寸限制
        const MIN_WIDTH = typeof minWidth === 'number' ? minWidth : 524;
        const MIN_HEIGHT = typeof minHeight === 'number' ? minHeight : 393;
        const safeWidth = Math.max(MIN_WIDTH, width);
        const safeHeight = Math.max(MIN_HEIGHT, height);

        // Support resizing main window if it's active
        const mainWin = windowPool.get('main');
        if (mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) {
            // 对系统原生缩放生效：动态设置主窗口最小尺寸
            try {
                mainWin.setMinimumSize(MIN_WIDTH, MIN_HEIGHT);
            } catch (e) {
                console.error('[WindowManager] setMinimumSize failed:', e);
            }

            const bounds = mainWin.getBounds();
            let newX = bounds.x;

            // Try to keep the left edge constant (expand to right) so the main interface doesn't move visually
            const display = getCurrentDisplay(mainWin);
            const workArea = display.workArea;

            // If extending right goes beyond right edge, shift left to fit
            if (newX + safeWidth > workArea.x + workArea.width) {
                const overflow = (newX + safeWidth) - (workArea.x + workArea.width);
                newX -= overflow;

                // Ensure we don't go past left edge
                if (newX < workArea.x) {
                    newX = workArea.x;
                }
            }

            // 直接设置窗口大小，不使用动画，避免面板切换时的跳动
            mainWin.setBounds({
                x: newX,
                y: bounds.y,
                width: safeWidth,
                height: safeHeight
            });

            // 通知渲染进程窗口大小已变化
            mainWin.webContents.send('window:size-changed', {
                width: safeWidth,
                height: safeHeight
            });
            return;
        }

        const header = windowPool.get('header');
        if (!header || movementManager.isAnimating) return;

        const newHeaderBounds = layoutManager.calculateHeaderResize(header, { width, height });

        const wasResizable = header.isResizable();
        if (!wasResizable) header.setResizable(true);

        movementManager.animateWindowBounds(header, newHeaderBounds, {
            onComplete: () => {
                if (!wasResizable) header.setResizable(false);
                updateChildWindowLayouts(true);
            }
        });
    });
    internalBridge.on('window:headerAnimationFinished', (state) => {
        const header = windowPool.get('header');
        if (!header || header.isDestroyed()) return;

        if (state === 'hidden') {
            header.hide();
        } else if (state === 'visible') {
            updateChildWindowLayouts(false);
        }
    });
    internalBridge.on('window:getHeaderPosition', (reply) => {
        const header = windowPool.get('header');
        if (header && !header.isDestroyed()) {
            reply(header.getBounds());
        } else {
            reply({ x: 0, y: 0, width: 0, height: 0 });
        }
    });
    internalBridge.on('window:moveHeaderTo', ({ newX, newY }) => {
        const header = windowPool.get('header');
        if (header) {
            const newPosition = layoutManager.calculateClampedPosition(header, { x: newX, y: newY });
            header.setPosition(newPosition.x, newPosition.y);
        }
    });
    internalBridge.on('window:adjustWindowHeight', ({ winName, targetHeight }) => {
        // console.log(`[Layout Debug] adjustWindowHeight: targetHeight=${targetHeight}`);
        const senderWindow = windowPool.get(winName);
        if (senderWindow) {
            const newBounds = layoutManager.calculateWindowHeightAdjustment(senderWindow, targetHeight);

            const wasResizable = senderWindow.isResizable();
            if (!wasResizable) senderWindow.setResizable(true);

            movementManager.animateWindowBounds(senderWindow, newBounds, {
                onComplete: () => {
                    if (!wasResizable) senderWindow.setResizable(false);
                    updateChildWindowLayouts(true);
                }
            });
        }
    });
}

function changeAllWindowsVisibility(windowPool, targetVisibility) {
    const header = windowPool.get('header');
    if (!header) return;

    if (typeof targetVisibility === 'boolean' &&
        header.isVisible() === targetVisibility) {
        return;
    }

    if (header.isVisible()) {
        lastVisibleWindows.clear();

        windowPool.forEach((win, name) => {
            if (win && !win.isDestroyed() && win.isVisible()) {
                lastVisibleWindows.add(name);
            }
        });

        lastVisibleWindows.forEach(name => {
            if (name === 'header') return;
            const win = windowPool.get(name);
            if (win && !win.isDestroyed()) win.hide();
        });
        header.hide();

        return;
    }

    lastVisibleWindows.forEach(name => {
        const win = windowPool.get(name);
        if (win && !win.isDestroyed())
            win.show();
    });
}

/**
 * 
 * @param {Map<string, BrowserWindow>} windowPool
 * @param {WindowLayoutManager} layoutManager 
 * @param {SmoothMovementManager} movementManager
 * @param {'listen' | 'ask' | 'settings' | 'shortcut-settings'} name 
 * @param {boolean} shouldBeVisible 
 */
async function handleWindowVisibilityRequest(windowPool, layoutManager, movementManager, name, shouldBeVisible) {
    console.log(`[WindowManager] Request: set '${name}' visibility to ${shouldBeVisible}`);
    const win = windowPool.get(name);

    if (!win || win.isDestroyed()) {
        console.warn(`[WindowManager] Window '${name}' not found or destroyed.`);
        return;
    }

    if (name !== 'settings') {
        const isCurrentlyVisible = win.isVisible();
        if (isCurrentlyVisible === shouldBeVisible) {
            console.log(`[WindowManager] Window '${name}' is already in the desired state.`);
            return;
        }
    }

    const disableClicks = (selectedWindow) => {
        for (const [name, win] of windowPool) {
            if (win !== selectedWindow && !win.isDestroyed()) {
                win.setIgnoreMouseEvents(true, { forward: true });
            }
        }
    };

    const restoreClicks = () => {
        for (const [, win] of windowPool) {
            if (!win.isDestroyed()) win.setIgnoreMouseEvents(false);
        }
    };

    if (name === 'settings') {
        if (shouldBeVisible) {
            // Cancel any pending hide operations
            if (settingsHideTimer) {
                clearTimeout(settingsHideTimer);
                settingsHideTimer = null;
            }
            const position = layoutManager.calculateSettingsWindowPosition();
            if (position) {
                win.setBounds(position);
                win.__lockedByButton = true;
                win.show();
                win.moveTop();
                win.setAlwaysOnTop(isAlwaysOnTopOn);
            } else {
                console.warn('[WindowManager] Could not calculate settings window position.');
            }
        } else {
            // Hide after a delay
            if (settingsHideTimer) {
                clearTimeout(settingsHideTimer);
            }
            settingsHideTimer = setTimeout(() => {
                if (win && !win.isDestroyed()) {
                    win.setAlwaysOnTop(false);
                    win.hide();
                }
                settingsHideTimer = null;
            }, 200);

            win.__lockedByButton = false;
        }
        return;
    }


    if (name === 'shortcut-settings') {
        if (shouldBeVisible) {
            // layoutManager.positionShortcutSettingsWindow();
            const newBounds = layoutManager.calculateShortcutSettingsWindowPosition();
            if (newBounds) win.setBounds(newBounds);

            if (process.platform === 'darwin') {
                win.setAlwaysOnTop(isAlwaysOnTopOn, 'screen-saver');
            } else {
                win.setAlwaysOnTop(isAlwaysOnTopOn);
            }
            // globalShortcut.unregisterAll();
            disableClicks(win);
            win.show();
        } else {
            if (process.platform === 'darwin') {
                win.setAlwaysOnTop(false, 'screen-saver');
            } else {
                win.setAlwaysOnTop(false);
            }
            restoreClicks();
            win.hide();
        }
        return;
    }

    if (name === 'listen' || name === 'ask') {
        const win = windowPool.get(name);
        const otherName = name === 'listen' ? 'ask' : 'listen';
        const otherWin = windowPool.get(otherName);
        const isOtherWinVisible = otherWin && !otherWin.isDestroyed() && otherWin.isVisible();

        const ANIM_OFFSET_X = 50;
        const ANIM_OFFSET_Y = 20;

        const finalVisibility = {
            listen: (name === 'listen' && shouldBeVisible) || (otherName === 'listen' && isOtherWinVisible),
            ask: (name === 'ask' && shouldBeVisible) || (otherName === 'ask' && isOtherWinVisible),
        };
        if (!shouldBeVisible) {
            finalVisibility[name] = false;
        }

        const targetLayout = layoutManager.calculateFeatureWindowLayout(finalVisibility);

        if (shouldBeVisible) {
            if (!win) return;
            const targetBounds = targetLayout[name];
            if (!targetBounds) return;

            const startPos = { ...targetBounds };
            if (name === 'listen') startPos.x -= ANIM_OFFSET_X;
            else if (name === 'ask') startPos.y -= ANIM_OFFSET_Y;

            win.setOpacity(0);
            win.setBounds(startPos);
            win.show();

            movementManager.fade(win, { to: 1 });
            movementManager.animateLayout(targetLayout);

        } else {
            if (!win || !win.isVisible()) return;

            const currentBounds = win.getBounds();
            const targetPos = { ...currentBounds };
            if (name === 'listen') targetPos.x -= ANIM_OFFSET_X;
            else if (name === 'ask') targetPos.y -= ANIM_OFFSET_Y;

            movementManager.fade(win, { to: 0, onComplete: () => win.hide() });
            movementManager.animateWindowPosition(win, targetPos);

            // Animate other windows to the new layout
            const otherWindowsLayout = { ...targetLayout };
            delete otherWindowsLayout[name];
            movementManager.animateLayout(otherWindowsLayout);
        }
        return;
    }

    // Handle screenshot window
    if (name === 'screenshot') {
        if (shouldBeVisible) {
            const targetLayout = layoutManager.calculateFeatureWindowLayout({ ask: true });
            const targetBounds = targetLayout.ask; // Use same position as ask window

            if (targetBounds) {
                win.setOpacity(0);
                win.setBounds(targetBounds);
                win.show();
                movementManager.fade(win, { to: 1 });
            }
        } else {
            if (win && win.isVisible()) {
                movementManager.fade(win, { to: 0, onComplete: () => win.hide() });
            }
        }
        return;
    }

    if (name === 'transcript') {
        if (shouldBeVisible) {
            const targetLayout = layoutManager.calculateFeatureWindowLayout({ transcript: true });
            const targetBounds = targetLayout.transcript; // Use calculated position

            if (targetBounds) {
                win.setOpacity(0);
                win.setBounds(targetBounds);
                win.show();
                movementManager.fade(win, { to: 1 });
            }
        } else {
            if (win && win.isVisible()) {
                movementManager.fade(win, { to: 0, onComplete: () => win.hide() });
            }
        }
        return;
    }
}

const setContentProtection = (status) => {
    isContentProtectionOn = status;
    console.log(`[Protection] Content protection toggled to: ${isContentProtectionOn} `);
    windowPool.forEach(win => {
        if (win && !win.isDestroyed()) {
            win.setContentProtection(isContentProtectionOn);
        }
    });
};

const getContentProtectionStatus = () => isContentProtectionOn;

const toggleContentProtection = () => {
    const newStatus = !getContentProtectionStatus();
    setContentProtection(newStatus);
    return newStatus;
};





function createFeatureWindows(header, namesToCreate) {
    // if (windowPool.has('listen')) return;

    const commonChildOptions = {
        parent: header,
        show: false,
        frame: false,
        transparent: true,
        vibrancy: false,
        hasShadow: false,
        skipTaskbar: true,
        hiddenInMissionControl: true,
        resizable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '../preload.js'),
        },
    };

    const createFeatureWindow = (name) => {
        if (windowPool.has(name)) return;

        switch (name) {
            case 'main': {
                const mainWin = new BrowserWindow({
                    ...commonChildOptions,
                    width: 524,
                    height: 393,
                    maxHeight: 900,
                    resizable: true,
                    minWidth: 524,
                    minHeight: 393,
                });
                mainWin.setContentProtection(isContentProtectionOn);
                mainWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                if (process.platform === 'darwin') {
                    mainWin.setWindowButtonVisibility(false);
                }
                const loadOptions = { query: { view: 'main' } };
                if (!shouldUseLiquidGlass) {
                    mainWin.loadFile(path.join(__dirname, '../ui/app/content.html'), loadOptions);
                } else {
                    loadOptions.query.glass = 'true';
                    mainWin.loadFile(path.join(__dirname, '../ui/app/content.html'), loadOptions);
                    mainWin.webContents.once('did-finish-load', () => {
                        const viewId = liquidGlass.addView(mainWin.getNativeWindowHandle());
                        if (viewId !== -1) {
                            liquidGlass.unstable_setVariant(viewId, liquidGlass.GlassMaterialVariant.bubbles);
                        }
                    });
                }
                // DevTools disabled to avoid too many console panels
                // if (!app.isPackaged) {
                //     mainWin.webContents.openDevTools({ mode: 'detach' });
                // }
                windowPool.set('main', mainWin);
                const position = layoutManager && layoutManager.calculateMainWindowPosition ? layoutManager.calculateMainWindowPosition() : null;
                if (position) {
                    mainWin.setBounds(position);
                }
                mainWin.show();
                break;
            }
            case 'listen': {
                const listen = new BrowserWindow({
                    ...commonChildOptions, width: 400, minWidth: 400, maxWidth: 900,
                    maxHeight: 900,
                });
                listen.setContentProtection(isContentProtectionOn);
                listen.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                if (process.platform === 'darwin') {
                    listen.setWindowButtonVisibility(false);
                }
                const listenLoadOptions = { query: { view: 'listen' } };
                if (!shouldUseLiquidGlass) {
                    listen.loadFile(path.join(__dirname, '../ui/app/content.html'), listenLoadOptions);
                }
                else {
                    listenLoadOptions.query.glass = 'true';
                    listen.loadFile(path.join(__dirname, '../ui/app/content.html'), listenLoadOptions);
                    listen.webContents.once('did-finish-load', () => {
                        const viewId = liquidGlass.addView(listen.getNativeWindowHandle());
                        if (viewId !== -1) {
                            liquidGlass.unstable_setVariant(viewId, liquidGlass.GlassMaterialVariant.bubbles);
                            // liquidGlass.unstable_setScrim(viewId, 1);
                            // liquidGlass.unstable_setSubdued(viewId, 1);
                        }
                    });
                }
                // DevTools disabled in development to avoid auto-opening
                // if (!app.isPackaged) {
                //     listen.webContents.openDevTools({ mode: 'detach' });
                // }
                windowPool.set('listen', listen);
                break;
            }

            // ask
            case 'ask': {
                const ask = new BrowserWindow({
                    ...commonChildOptions,
                    width: 524,
                    height: 393,
                    maxHeight: 393,
                    minHeight: 393
                });
                ask.setContentProtection(isContentProtectionOn);
                ask.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                if (process.platform === 'darwin') {
                    ask.setWindowButtonVisibility(false);
                }
                const askLoadOptions = { query: { view: 'ask' } };
                if (!shouldUseLiquidGlass) {
                    ask.loadFile(path.join(__dirname, '../ui/app/content.html'), askLoadOptions);
                }
                else {
                    askLoadOptions.query.glass = 'true';
                    ask.loadFile(path.join(__dirname, '../ui/app/content.html'), askLoadOptions);
                    ask.webContents.once('did-finish-load', () => {
                        const viewId = liquidGlass.addView(ask.getNativeWindowHandle());
                        if (viewId !== -1) {
                            liquidGlass.unstable_setVariant(viewId, liquidGlass.GlassMaterialVariant.bubbles);
                            // liquidGlass.unstable_setScrim(viewId, 1);
                            // liquidGlass.unstable_setSubdued(viewId, 1);
                        }
                    });
                }

                // DevTools disabled in development to avoid auto-opening
                // if (!app.isPackaged) {
                //     ask.webContents.openDevTools({ mode: 'detach' });
                // }
                windowPool.set('ask', ask);
                break;
            }

            // screenshot
            case 'screenshot': {
                const screenshot = new BrowserWindow({
                    ...commonChildOptions,
                    width: 524,
                    height: 393,
                    maxHeight: 393,
                    minHeight: 393
                });
                screenshot.setContentProtection(isContentProtectionOn);
                screenshot.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                if (process.platform === 'darwin') {
                    screenshot.setWindowButtonVisibility(false);
                }
                screenshot.loadFile(path.join(__dirname, '../ui/screenshot/screenshot.html'));

                // DevTools in development
                // if (!app.isPackaged) {
                //     screenshot.webContents.openDevTools({ mode: 'detach' });
                // }
                windowPool.set('screenshot', screenshot);
                break;
            }

            // transcript
            case 'transcript': {
                const transcript = new BrowserWindow({
                    ...commonChildOptions,
                    width: 400,
                    height: 393,
                    maxHeight: 900,
                    minHeight: 300
                });
                transcript.setContentProtection(isContentProtectionOn);
                transcript.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                if (process.platform === 'darwin') {
                    transcript.setWindowButtonVisibility(false);
                }
                transcript.loadFile(path.join(__dirname, '../ui/transcript/transcript.html'));

                // DevTools in development
                // if (!app.isPackaged) {
                //     transcript.webContents.openDevTools({ mode: 'detach' });
                // }
                windowPool.set('transcript', transcript);
                break;
            }


            // settings
            case 'settings': {
                const settings = new BrowserWindow({ ...commonChildOptions, width: 240, maxHeight: 400, parent: undefined });
                settings.setContentProtection(isContentProtectionOn);
                settings.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                if (process.platform === 'darwin') {
                    settings.setWindowButtonVisibility(false);
                }
                const settingsLoadOptions = { query: { view: 'settings' } };
                if (!shouldUseLiquidGlass) {
                    settings.loadFile(path.join(__dirname, '../ui/app/content.html'), settingsLoadOptions)
                        .catch(console.error);
                }
                else {
                    settingsLoadOptions.query.glass = 'true';
                    settings.loadFile(path.join(__dirname, '../ui/app/content.html'), settingsLoadOptions)
                        .catch(console.error);
                    settings.webContents.once('did-finish-load', () => {
                        const viewId = liquidGlass.addView(settings.getNativeWindowHandle());
                        if (viewId !== -1) {
                            liquidGlass.unstable_setVariant(viewId, liquidGlass.GlassMaterialVariant.bubbles);
                            // liquidGlass.unstable_setScrim(viewId, 1);
                            // liquidGlass.unstable_setSubdued(viewId, 1);
                        }
                    });
                }
                windowPool.set('settings', settings);

                // DevTools disabled in development to avoid auto-opening
                // if (!app.isPackaged) {
                //     settings.webContents.openDevTools({ mode: 'detach' });
                // }
                break;
            }

            case 'shortcut-settings': {
                const shortcutEditor = new BrowserWindow({
                    ...commonChildOptions,
                    width: 353,
                    height: 720,
                    modal: false,
                    parent: undefined,
                    alwaysOnTop: isAlwaysOnTopOn,
                    titleBarOverlay: false,
                });

                shortcutEditor.setContentProtection(isContentProtectionOn);
                shortcutEditor.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                if (process.platform === 'darwin') {
                    shortcutEditor.setWindowButtonVisibility(false);
                }

                const loadOptions = { query: { view: 'shortcut-settings' } };
                if (!shouldUseLiquidGlass) {
                    shortcutEditor.loadFile(path.join(__dirname, '../ui/app/content.html'), loadOptions);
                } else {
                    loadOptions.query.glass = 'true';
                    shortcutEditor.loadFile(path.join(__dirname, '../ui/app/content.html'), loadOptions);
                    shortcutEditor.webContents.once('did-finish-load', () => {
                        const viewId = liquidGlass.addView(shortcutEditor.getNativeWindowHandle());
                        if (viewId !== -1) {
                            liquidGlass.unstable_setVariant(viewId, liquidGlass.GlassMaterialVariant.bubbles);
                        }
                    });
                }

                windowPool.set('shortcut-settings', shortcutEditor);
                // DevTools disabled in development to avoid auto-opening
                // if (!app.isPackaged) {
                //     shortcutEditor.webContents.openDevTools({ mode: 'detach' });
                // }
                break;
            }
        }
    };

    if (Array.isArray(namesToCreate)) {
        namesToCreate.forEach(name => createFeatureWindow(name));
    } else if (typeof namesToCreate === 'string') {
        createFeatureWindow(namesToCreate);
    } else {
        createFeatureWindow('listen');
        createFeatureWindow('ask');
        createFeatureWindow('settings');
        createFeatureWindow('shortcut-settings');
    }
}

function destroyFeatureWindows() {
    const featureWindows = ['listen', 'ask', 'settings', 'shortcut-settings'];
    if (settingsHideTimer) {
        clearTimeout(settingsHideTimer);
        settingsHideTimer = null;
    }
    featureWindows.forEach(name => {
        const win = windowPool.get(name);
        if (win && !win.isDestroyed()) win.destroy();
        windowPool.delete(name);
    });
}



function getCurrentDisplay(window) {
    if (!window || window.isDestroyed()) return screen.getPrimaryDisplay();

    const windowBounds = window.getBounds();
    const windowCenter = {
        x: windowBounds.x + windowBounds.width / 2,
        y: windowBounds.y + windowBounds.height / 2,
    };

    return screen.getDisplayNearestPoint(windowCenter);
}



function createWindows() {
    const HEADER_HEIGHT = 47;
    const DEFAULT_WINDOW_WIDTH = 353;

    const primaryDisplay = screen.getPrimaryDisplay();
    const { y: workAreaY, width: screenWidth } = primaryDisplay.workArea;

    const initialX = Math.round((screenWidth - DEFAULT_WINDOW_WIDTH) / 2);
    const initialY = workAreaY + 21;

    const header = new BrowserWindow({
        width: DEFAULT_WINDOW_WIDTH,
        height: HEADER_HEIGHT,
        x: initialX,
        y: initialY,
        frame: false,
        transparent: true,
        vibrancy: false,
        hasShadow: false,
        alwaysOnTop: isAlwaysOnTopOn, // 确保窗口始终置顶
        skipTaskbar: true,
        hiddenInMissionControl: true,
        resizable: false,
        focusable: true,
        acceptFirstMouse: true,
        show: true, // 确保窗口默认显示
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '../preload.js'),
            backgroundThrottling: false,
            webSecurity: false,
            enableRemoteModule: false,
            // Ensure proper rendering and prevent pixelation
            experimentalFeatures: false,
        },
        // Prevent pixelation and ensure proper rendering
        useContentSize: true,
        disableAutoHideCursor: true,
    });
    if (process.platform === 'darwin') {
        header.setWindowButtonVisibility(false);
    }
    const headerLoadOptions = {};
    if (!shouldUseLiquidGlass) {
        header.loadFile(path.join(__dirname, '../ui/app/header.html'), headerLoadOptions);
    }
    else {
        headerLoadOptions.query = { glass: 'true' };
        header.loadFile(path.join(__dirname, '../ui/app/header.html'), headerLoadOptions);
        header.webContents.once('did-finish-load', () => {
            const viewId = liquidGlass.addView(header.getNativeWindowHandle());
            if (viewId !== -1) {
                liquidGlass.unstable_setVariant(viewId, liquidGlass.GlassMaterialVariant.bubbles);
                // liquidGlass.unstable_setScrim(viewId, 1); 
                // liquidGlass.unstable_setSubdued(viewId, 1);
            }
        });
    }
    windowPool.set('header', header);
    layoutManager = new WindowLayoutManager(windowPool);
    movementManager = new SmoothMovementManager(windowPool);


    header.on('moved', () => {
        if (movementManager.isAnimating) {
            return;
        }
        updateChildWindowLayouts(false);
    });

    header.webContents.once('dom-ready', () => {
        shortcutsService.initialize(windowPool);
        shortcutsService.registerShortcuts();
    });

    setupIpcHandlers(windowPool, layoutManager);
    setupWindowController(windowPool, layoutManager, movementManager);

    if (currentHeaderState === 'main') {
        createFeatureWindows(header, ['main', 'listen', 'ask', 'screenshot', 'transcript', 'settings', 'shortcut-settings']);
    }

    header.setContentProtection(isContentProtectionOn);
    header.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // 确保窗口显示
    header.show();
    console.log('[WindowManager] Header window created and shown');

    // DevTools in development - redirect console to main process
    if (!app.isPackaged) {
        header.webContents.openDevTools({ mode: 'detach' });

        // 转发渲染进程的 console 到主进程
        header.webContents.on('console-message', (event, level, message, line, sourceId) => {
            const prefix = level === 0 ? '[Renderer]' : level === 1 ? '[Renderer WARN]' : '[Renderer ERROR]';
            console.log(`${prefix} ${message}`);
        });
    }

    header.on('focus', () => {
        console.log('[WindowManager] Header gained focus');
    });

    header.on('blur', () => {
        console.log('[WindowManager] Header lost focus');
    });

    header.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'mouseDown') {
            const target = input.target;
            if (target && (target.includes('input') || target.includes('apikey'))) {
                header.focus();
            }
        }
    });

    header.on('resize', () => updateChildWindowLayouts(false));

    return windowPool;
}


function createMainOnlyWindow() {
    const commonOptions = {
        show: false,
        frame: false,
        transparent: true,
        vibrancy: false,
        hasShadow: false,
        skipTaskbar: true,
        hiddenInMissionControl: true,
        resizable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '../preload.js'),
        },
    };

    const mainWin = new BrowserWindow({
        ...commonOptions,
        width: 524,
        height: 393,
        minWidth: 524,
        minHeight: 393,
        maxHeight: 900,
        resizable: true,
        parent: undefined,
    });
    mainWin.setContentProtection(isContentProtectionOn);
    mainWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (process.platform === 'darwin') {
        mainWin.setWindowButtonVisibility(false);
    }

    const loadOptions = { query: { view: 'main' } };
    if (!shouldUseLiquidGlass) {
        mainWin.loadFile(path.join(__dirname, '../ui/app/content.html'), loadOptions);
    } else {
        loadOptions.query.glass = 'true';
        mainWin.loadFile(path.join(__dirname, '../ui/app/content.html'), loadOptions);
        mainWin.webContents.once('did-finish-load', () => {
            const viewId = liquidGlass.addView(mainWin.getNativeWindowHandle());
            if (viewId !== -1) {
                liquidGlass.unstable_setVariant(viewId, liquidGlass.GlassMaterialVariant.bubbles);
            }
        });
    }

    // DevTools disabled in development to avoid auto-opening
    // if (!app.isPackaged) {
    //     mainWin.webContents.openDevTools({ mode: 'detach' });
    // }

    console.log('[WindowManager] Main window created successfully');
    windowPool.set('main', mainWin);
    mainWin.show();
    console.log('[WindowManager] Main window shown');
    return windowPool;
}


function setupIpcHandlers(windowPool, layoutManager) {
    screen.on('display-added', (event, newDisplay) => {
        console.log('[Display] New display added:', newDisplay.id);
    });

    screen.on('display-removed', (event, oldDisplay) => {
        console.log('[Display] Display removed:', oldDisplay.id);
        const header = windowPool.get('header');

        if (header && getCurrentDisplay(header).id === oldDisplay.id) {
            const primaryDisplay = screen.getPrimaryDisplay();
            const newPosition = layoutManager.calculateNewPositionForDisplay(header, primaryDisplay.id);
            if (newPosition) {
                // In recovery mode, move immediately without animation
                header.setPosition(newPosition.x, newPosition.y, false);
                updateChildWindowLayouts(false);
            }
        }
    });

    screen.on('display-metrics-changed', (event, display, changedMetrics) => {
        // Call the new version of the layout update function
        updateChildWindowLayouts(false);
    });
}


const handleHeaderStateChanged = (state) => {
    console.log(`[WindowManager] Header state changed to: ${state} `);
    currentHeaderState = state;
    const header = windowPool.get('header');

    if (state === 'main') {
        console.log('[WindowManager] Transitioning to main state - creating feature windows');

        // 先创建功能窗口（包括 main 窗口）
        createFeatureWindows(header, ['main', 'listen', 'ask', 'screenshot', 'transcript', 'settings', 'shortcut-settings']);

        // 确保 main 窗口可见并在前台
        const mainWin = windowPool.get('main');
        if (mainWin && !mainWin.isDestroyed()) {
            mainWin.show();
            mainWin.focus();
            console.log('[WindowManager] Main window shown and focused');
        }

        // 然后隐藏 Header 窗口（设置为透明并点击穿透）
        if (header && !header.isDestroyed()) {
            header.setOpacity(0);
            header.setIgnoreMouseEvents(true, { forward: true });
            console.log('[WindowManager] Header window hidden (transparent + click-through)');
        }
    } else {         // 'apikey' | 'permission' | 'welcome'
        console.log(`[WindowManager] Transitioning to ${state} state - showing header, destroying feature windows`);

        // 先销毁功能窗口（包括 main 窗口）
        destroyFeatureWindows();

        // 恢复 Header 窗口可见性
        if (header && !header.isDestroyed()) {
            header.setOpacity(1);
            header.setIgnoreMouseEvents(false);
            header.show();
            header.focus();
            console.log('[WindowManager] Header window restored and focused');
        }
    }
    internalBridge.emit('reregister-shortcuts');
};


// 存储每个窗口的 resize 起始状态
const windowResizeState = new Map();

function resizeMainWindow(senderWebContents, { edge, deltaX, deltaY, startWidth, startHeight, minWidth }) {
    const win = BrowserWindow.fromWebContents(senderWebContents);
    if (!win || win.isDestroyed()) return;

    console.log('[resizeMainWindow] Received minWidth:', minWidth);

    const currentBounds = win.getBounds();
    const display = getCurrentDisplay(win);
    const workArea = display.workArea;

    // 如果是第一次 resize，保存起始状态
    const winId = win.id;
    if (!windowResizeState.has(winId)) {
        windowResizeState.set(winId, {
            startBounds: { ...currentBounds },
            startWidth,
            startHeight,
        });
    }

    const resizeState = windowResizeState.get(winId);
    const startBounds = resizeState.startBounds;

    let newBounds = { ...startBounds };

    // 最小尺寸限制 - 使用传递的动态最小宽度（面板打开时 988px，关闭时 524px）
    const MIN_WIDTH = minWidth || 524;
    const MIN_HEIGHT = 393;

    // 根据边沿方向调整窗口大小
    switch (edge) {
        case 'top':
            newBounds.y = Math.max(workArea.y, startBounds.y + deltaY);
            newBounds.height = startHeight - deltaY;
            break;
        case 'bottom':
            newBounds.height = startHeight + deltaY;
            break;
        case 'left':
            newBounds.x = Math.max(workArea.x, startBounds.x + deltaX);
            newBounds.width = startWidth - deltaX;
            break;
        case 'right':
            newBounds.width = startWidth + deltaX;
            break;
        case 'top-left':
            newBounds.x = Math.max(workArea.x, startBounds.x + deltaX);
            newBounds.y = Math.max(workArea.y, startBounds.y + deltaY);
            newBounds.width = startWidth - deltaX;
            newBounds.height = startHeight - deltaY;
            break;
        case 'top-right':
            newBounds.y = Math.max(workArea.y, startBounds.y + deltaY);
            newBounds.width = startWidth + deltaX;
            newBounds.height = startHeight - deltaY;
            break;
        case 'bottom-left':
            newBounds.x = Math.max(workArea.x, startBounds.x + deltaX);
            newBounds.width = startWidth - deltaX;
            newBounds.height = startHeight + deltaY;
            break;
        case 'bottom-right':
            newBounds.width = startWidth + deltaX;
            newBounds.height = startHeight + deltaY;
            break;
    }

    // 强制执行最小尺寸限制
    if (newBounds.width < MIN_WIDTH) {
        // 如果是从左边拖拽，需要调整 x 坐标
        if (edge.includes('left')) {
            newBounds.x = startBounds.x + startBounds.width - MIN_WIDTH;
        }
        newBounds.width = MIN_WIDTH;
    }
    if (newBounds.height < MIN_HEIGHT) {
        // 如果是从上边拖拽，需要调整 y 坐标
        if (edge.includes('top')) {
            newBounds.y = startBounds.y + startBounds.height - MIN_HEIGHT;
        }
        newBounds.height = MIN_HEIGHT;
    }

    // 限制在工作区内
    if (newBounds.x + newBounds.width > workArea.x + workArea.width) {
        newBounds.width = workArea.x + workArea.width - newBounds.x;
    }
    if (newBounds.y + newBounds.height > workArea.y + workArea.height) {
        newBounds.height = workArea.y + workArea.height - newBounds.y;
    }

    // 再次确保最小尺寸（工作区限制后可能变小）
    newBounds.width = Math.max(MIN_WIDTH, newBounds.width);
    newBounds.height = Math.max(MIN_HEIGHT, newBounds.height);

    win.setBounds(newBounds);

    // 通知渲染进程窗口大小已变化
    senderWebContents.send('window:size-changed', {
        width: newBounds.width,
        height: newBounds.height
    });
}

// 清理 resize 状态（当窗口关闭或 resize 结束时）
function clearWindowResizeState(winId) {
    if (winId) {
        windowResizeState.delete(winId);
    } else {
        // 清理所有窗口的 resize 状态
        windowResizeState.clear();
    }
}

module.exports = {
    createWindows,
    createMainOnlyWindow,
    windowPool,
    toggleContentProtection,
    resizeHeaderWindow,
    getContentProtectionStatus,
    showSettingsWindow,
    hideSettingsWindow,
    cancelHideSettingsWindow,
    moveWindowStep,
    handleHeaderStateChanged,
    handleHeaderAnimationFinished,
    getHeaderPosition,
    moveHeaderTo,
    adjustWindowHeight,
    resizeMainWindow,
    clearWindowResizeState,
};
