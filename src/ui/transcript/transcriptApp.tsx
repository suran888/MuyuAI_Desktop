import React from 'react';
import { createRoot } from 'react-dom/client';
import { TranscriptView } from './TranscriptView';

window.addEventListener('DOMContentLoaded', () => {
    console.log('[TranscriptApp] Initializing React App...');
    
    const container = document.getElementById('transcript-container');
    if (!container) {
        console.error('[TranscriptApp] Container not found');
        return;
    }

    const root = createRoot(container);
    root.render(React.createElement(TranscriptView));
    
    console.log('[TranscriptApp] React App initialized successfully');
});

