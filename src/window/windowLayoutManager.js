const { screen } = require('electron');

/**
 * 
 * @param {BrowserWindow} window 
 * @returns {Display}
 */
function getCurrentDisplay(window) {
    if (!window || window.isDestroyed()) return screen.getPrimaryDisplay();

    const windowBounds = window.getBounds();
    const windowCenter = {
        x: windowBounds.x + windowBounds.width / 2,
        y: windowBounds.y + windowBounds.height / 2,
    };

    return screen.getDisplayNearestPoint(windowCenter);
}

class WindowLayoutManager {
    /**
* @param {Map<string, BrowserWindow>} windowPool - Map of windows to manage
     */
    constructor(windowPool) {
        this.windowPool = windowPool;
        this.isUpdating = false;
        this.PADDING = 80;
    }

    getHeaderPosition = () => {
        const header = this.windowPool.get('header');
        if (header) {
            const [x, y] = header.getPosition();
            return { x, y };
        }
        return { x: 0, y: 0 };
    };


    /**
     * @returns {{x: number, y: number} | null}
     */
    calculateSettingsWindowPosition() {
        const header = this.windowPool.get('header');
        const settings = this.windowPool.get('settings');

        if (!header || header.isDestroyed() || !settings || settings.isDestroyed()) {
            return null;
        }

        const headerBounds = header.getBounds();
        const settingsBounds = settings.getBounds();
        const display = getCurrentDisplay(header);
        const { x: workAreaX, y: workAreaY, width: screenWidth, height: screenHeight } = display.workArea;

        const PAD = 5;
        const headerCenterX = headerBounds.x + headerBounds.width / 2;

        const x = headerCenterX - settingsBounds.width / 2;
        const y = headerBounds.y + headerBounds.height + PAD;

        const clampedX = Math.max(workAreaX + 10, Math.min(workAreaX + screenWidth - settingsBounds.width - 10, x));
        const clampedY = Math.max(workAreaY + 10, Math.min(workAreaY + screenHeight - settingsBounds.height - 10, y));

        return { x: Math.round(clampedX), y: Math.round(clampedY) };
    }

    /**
     * @returns {{x: number, y: number, width: number, height: number} | null}
     */
    calculateMainWindowPosition() {
        const header = this.windowPool.get('header');
        const mainWin = this.windowPool.get('main');

        if (!header || header.isDestroyed() || !mainWin || mainWin.isDestroyed()) {
            return null;
        }

        const headerBounds = header.getBounds();
        const mainBounds = mainWin.getBounds();
        const display = getCurrentDisplay(header);
        const { x: workAreaX, y: workAreaY, width: screenWidth, height: screenHeight } = display.workArea;

        const PAD = 10;
        const headerCenterX = headerBounds.x + headerBounds.width / 2;

        const x = headerBounds.x + (headerBounds.width - mainBounds.width) / 2;
        const y = headerBounds.y + (headerBounds.height - mainBounds.height) / 2;

        const clampedX = Math.max(workAreaX + 10, Math.min(workAreaX + screenWidth - mainBounds.width - 10, x));
        const clampedY = Math.max(workAreaY + 10, Math.min(workAreaY + screenHeight - mainBounds.height - 10, y));

        return { x: Math.round(clampedX), y: Math.round(clampedY), width: mainBounds.width, height: mainBounds.height };
    }


    calculateHeaderResize(header, { width, height }) {
        if (!header) return null;
        const currentBounds = header.getBounds();
        const centerX = currentBounds.x + currentBounds.width / 2;
        const newX = Math.round(centerX - width / 2);
        const display = getCurrentDisplay(header);
        const { x: workAreaX, width: workAreaWidth } = display.workArea;
        const clampedX = Math.max(workAreaX, Math.min(workAreaX + workAreaWidth - width, newX));
        return { x: clampedX, y: currentBounds.y, width, height };
    }

    calculateClampedPosition(header, { x: newX, y: newY }) {
        if (!header) return null;
        const targetDisplay = screen.getDisplayNearestPoint({ x: newX, y: newY });
        const { x: workAreaX, y: workAreaY, width, height } = targetDisplay.workArea;
        const headerBounds = header.getBounds();
        const clampedX = Math.max(workAreaX, Math.min(newX, workAreaX + width - headerBounds.width));
        const clampedY = Math.max(workAreaY, Math.min(newY, workAreaY + height - headerBounds.height));
        return { x: clampedX, y: clampedY };
    }

    calculateWindowHeightAdjustment(senderWindow, targetHeight) {
        if (!senderWindow) return null;
        const currentBounds = senderWindow.getBounds();
        const minHeight = senderWindow.getMinimumSize()[1];
        const maxHeight = senderWindow.getMaximumSize()[1];
        let adjustedHeight = Math.max(minHeight, targetHeight);
        if (maxHeight > 0) {
            adjustedHeight = Math.min(maxHeight, adjustedHeight);
        }
        // console.log(`[Layout Debug] calculateWindowHeightAdjustment: targetHeight=${targetHeight}`);
        return { ...currentBounds, height: adjustedHeight };
    }

    // Replace the original getTargetBoundsForFeatureWindows with this function.
    calculateFeatureWindowLayout(visibility, headerBoundsOverride = null) {
        const header = this.windowPool.get('header');
        const headerBounds = headerBoundsOverride || (header ? header.getBounds() : null);

        if (!headerBounds) return {};

        let display;
        if (headerBoundsOverride) {
            const boundsCenter = {
                x: headerBounds.x + headerBounds.width / 2,
                y: headerBounds.y + headerBounds.height / 2,
            };
            display = screen.getDisplayNearestPoint(boundsCenter);
        } else {
            display = getCurrentDisplay(header);
        }

        const { width: screenWidth, height: screenHeight, x: workAreaX, y: workAreaY } = display.workArea;

        const ask = this.windowPool.get('ask');
        const listen = this.windowPool.get('listen');

        const askVis = visibility.ask && ask && !ask.isDestroyed();
        const listenVis = visibility.listen && listen && !listen.isDestroyed();
        const transcript = this.windowPool.get('transcript');
        const transcriptVis = visibility.transcript && transcript && !transcript.isDestroyed();

        if (!askVis && !listenVis && !transcriptVis) return {};

        const clampX = (targetX, winWidth) => {
            const maxX = workAreaX + screenWidth - winWidth;
            return Math.max(workAreaX, Math.min(targetX, maxX));
        };

        const clampY = (targetY, winHeight) => {
            const maxY = workAreaY + screenHeight - winHeight;
            return Math.max(workAreaY, Math.min(targetY, maxY));
        };

        const headerLeft = headerBounds.x;
        const headerRight = headerBounds.x + headerBounds.width;
        const targetTop = headerBounds.y;
        const layout = {};

        if (listenVis) {
            const listenBounds = listen.getBounds();
            // Force height to match header, with a minimum of 640px to match MainHeader's min-height
            const targetHeight = Math.max(headerBounds.height, 640);
            const alignedY = clampY(targetTop, targetHeight);
            const alignedX = clampX(headerLeft - listenBounds.width, listenBounds.width);
            layout.listen = {
                x: Math.round(alignedX),
                y: Math.round(alignedY),
                width: listenBounds.width,
                height: targetHeight,
            };
        }

        if (askVis) {
            const mainWin = this.windowPool.get('main');
            const askBounds = ask.getBounds();

            if (mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) {
                // Position Ask window to the right of MainView
                const mainBounds = mainWin.getBounds();
                const alignedY = clampY(mainBounds.y, askBounds.height);
                const alignedX = clampX(mainBounds.x + mainBounds.width, askBounds.width);
                layout.ask = {
                    x: Math.round(alignedX),
                    y: Math.round(alignedY),
                    width: askBounds.width,
                    height: askBounds.height,
                };
            } else {
                // Fallback to header positioning if MainView not available
                const alignedY = clampY(targetTop, askBounds.height);
                const alignedX = clampX(headerRight, askBounds.width);
                layout.ask = {
                    x: Math.round(alignedX),
                    y: Math.round(alignedY),
                    width: askBounds.width,
                    height: askBounds.height,
                };
            }
        }

        // const transcript = this.windowPool.get('transcript'); // Already declared
        // const transcriptVis = visibility.transcript && transcript && !transcript.isDestroyed(); // Already declared

        if (transcriptVis) {
            const mainWin = this.windowPool.get('main');
            const transcriptBounds = transcript.getBounds();

            if (mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) {
                // Position Transcript window to the right of MainView
                const mainBounds = mainWin.getBounds();
                const alignedY = clampY(mainBounds.y, transcriptBounds.height);
                const alignedX = clampX(mainBounds.x + mainBounds.width, transcriptBounds.width);
                layout.transcript = {
                    x: Math.round(alignedX),
                    y: Math.round(alignedY),
                    width: transcriptBounds.width,
                    height: transcriptBounds.height,
                };
            } else {
                // Fallback to header positioning if MainView not available
                const alignedY = clampY(targetTop, transcriptBounds.height);
                const alignedX = clampX(headerRight, transcriptBounds.width);
                layout.transcript = {
                    x: Math.round(alignedX),
                    y: Math.round(alignedY),
                    width: transcriptBounds.width,
                    height: transcriptBounds.height,
                };
            }
        }

        return layout;
    }

    calculateShortcutSettingsWindowPosition() {
        const header = this.windowPool.get('header');
        const shortcutSettings = this.windowPool.get('shortcut-settings');
        if (!header || !shortcutSettings) return null;

        const headerBounds = header.getBounds();
        const shortcutBounds = shortcutSettings.getBounds();
        const { workArea } = getCurrentDisplay(header);

        let newX = Math.round(headerBounds.x + (headerBounds.width / 2) - (shortcutBounds.width / 2));
        let newY = Math.round(headerBounds.y);

        newX = Math.max(workArea.x, Math.min(newX, workArea.x + workArea.width - shortcutBounds.width));
        newY = Math.max(workArea.y, Math.min(newY, workArea.y + workArea.height - shortcutBounds.height));

        return { x: newX, y: newY, width: shortcutBounds.width, height: shortcutBounds.height };
    }

    calculateStepMovePosition(header, direction) {
        if (!header) return null;
        const currentBounds = header.getBounds();
        const stepSize = 80; // Movement step size
        let targetX = currentBounds.x;
        let targetY = currentBounds.y;

        switch (direction) {
            case 'left': targetX -= stepSize; break;
            case 'right': targetX += stepSize; break;
            case 'up': targetY -= stepSize; break;
            case 'down': targetY += stepSize; break;
        }

        return this.calculateClampedPosition(header, { x: targetX, y: targetY });
    }

    calculateEdgePosition(header, direction) {
        if (!header) return null;
        const display = getCurrentDisplay(header);
        const { workArea } = display;
        const currentBounds = header.getBounds();

        let targetX = currentBounds.x;
        let targetY = currentBounds.y;

        switch (direction) {
            case 'left': targetX = workArea.x; break;
            case 'right': targetX = workArea.x + workArea.width - currentBounds.width; break;
            case 'up': targetY = workArea.y; break;
            case 'down': targetY = workArea.y + workArea.height - currentBounds.height; break;
        }
        return { x: targetX, y: targetY };
    }

    calculateNewPositionForDisplay(window, targetDisplayId) {
        if (!window) return null;

        const targetDisplay = screen.getAllDisplays().find(d => d.id === targetDisplayId);
        if (!targetDisplay) return null;

        const currentBounds = window.getBounds();
        const currentDisplay = getCurrentDisplay(window);

        if (currentDisplay.id === targetDisplay.id) return { x: currentBounds.x, y: currentBounds.y };

        const relativeX = (currentBounds.x - currentDisplay.workArea.x) / currentDisplay.workArea.width;
        const relativeY = (currentBounds.y - currentDisplay.workArea.y) / currentDisplay.workArea.height;

        const targetX = targetDisplay.workArea.x + targetDisplay.workArea.width * relativeX;
        const targetY = targetDisplay.workArea.y + targetDisplay.workArea.height * relativeY;

        const clampedX = Math.max(targetDisplay.workArea.x, Math.min(targetX, targetDisplay.workArea.x + targetDisplay.workArea.width - currentBounds.width));
        const clampedY = Math.max(targetDisplay.workArea.y, Math.min(targetY, targetDisplay.workArea.y + targetDisplay.workArea.height - currentBounds.height));

        return { x: Math.round(clampedX), y: Math.round(clampedY) };
    }

    /**
     * @param {Rectangle} bounds1
     * @param {Rectangle} bounds2
     * @returns {boolean}
     */
    boundsOverlap(bounds1, bounds2) {
        const margin = 10;
        return !(
            bounds1.x + bounds1.width + margin < bounds2.x ||
            bounds2.x + bounds2.width + margin < bounds1.x ||
            bounds1.y + bounds1.height + margin < bounds2.y ||
            bounds2.y + bounds2.height + margin < bounds1.y
        );
    }
}

module.exports = WindowLayoutManager;
