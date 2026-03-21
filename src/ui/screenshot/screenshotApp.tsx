import React from 'react';
import { createRoot } from 'react-dom/client';
import { ScreenshotView } from './ScreenshotView';

window.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('screenshot-container');
    if (!container) {
        console.error('[ScreenshotApp] Container not found');
        return;
    }

    const root = createRoot(container);
    root.render(React.createElement(ScreenshotView));
});

