/**
 * React 应用入口文件
 * 替代原来的 Lit Element MuyuApp
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// 等待 DOM 加载完成
window.addEventListener('DOMContentLoaded', () => {
  console.log('[ContentApp] Initializing React App...');
  
  const container = document.getElementById('app');
  
  if (!container) {
    console.error('[ContentApp] App container not found!');
    return;
  }

  // 处理 glass 参数
  const params = new URLSearchParams(window.location.search);
  if (params.get('glass') === 'true') {
    document.body.classList.add('has-glass');
  }

  // 创建 React root 并渲染应用
  const root = createRoot(container);
  root.render(React.createElement(App));
  
  console.log('[ContentApp] React App initialized successfully');
});

