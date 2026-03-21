import React from 'react';
import { createRoot } from 'react-dom/client';
import { StartupFlow } from './StartupFlow';

// 扩展 Window 接口
declare global {
    interface Window {
        __interviewStartTimestamp?: number;
    }
}

console.log('[HeaderApp] Script loaded');

function App() {
    return <StartupFlow />;
}

// 初始化 React 应用
console.log('[HeaderApp] Setting up DOMContentLoaded listener');
window.addEventListener('DOMContentLoaded', () => {
    console.log('[HeaderApp] DOMContentLoaded fired');
    const container = document.getElementById('header-container');
    if (!container) {
        console.error('[HeaderApp] Container not found');
        return;
    }

    console.log('[HeaderApp] Container found, creating React root');
    const root = createRoot(container);
    console.log('[HeaderApp] Rendering App component');
    root.render(React.createElement(App));

    // 处理 glass 参数
    const params = new URLSearchParams(window.location.search);
    if (params.get('glass') === 'true') {
        document.body.classList.add('has-glass');
    }
    
    console.log('[HeaderApp] React app initialized');
});

