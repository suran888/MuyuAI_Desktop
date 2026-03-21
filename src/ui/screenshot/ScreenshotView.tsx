import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useIpcListener } from '../hooks';
import { useStreamingMarkdownRenderer } from '../hooks/useStreamingMarkdown';

export function ScreenshotView() {
  const [currentResponse, setCurrentResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  
  const responseContainerRef = useRef<HTMLDivElement>(null);

  useStreamingMarkdownRenderer({
    content: currentResponse,
    isStreaming,
    isLoading,
    containerRef: responseContainerRef,
    hljs: window.hljs,
  });

  const handleStateUpdate = useCallback((event: any, state: any) => {
    if (state.isLoading !== undefined) setIsLoading(state.isLoading);
    if (state.isStreaming !== undefined) setIsStreaming(state.isStreaming);
    if (state.currentResponse !== undefined) setCurrentResponse(state.currentResponse);
  }, []);

  const handleStreamError = useCallback((event: any, payload: { error: string }) => {
    console.error('Screenshot analysis error:', payload.error);
    setIsLoading(false);
    setIsStreaming(false);
    setCurrentResponse(`Error: ${payload.error}`);
  }, []);

  useIpcListener('screenshotView:onStateUpdate', handleStateUpdate);
  useIpcListener('screenshotView:onStreamError', handleStreamError);

  // Render content
  useEffect(() => {
    const responseContainer = responseContainerRef.current;
    if (!responseContainer) return;

    if (isLoading) {
      responseContainer.innerHTML = `
        <div class="loading-dots">
          <div class="loading-dot"></div>
          <div class="loading-dot"></div>
          <div class="loading-dot"></div>
        </div>`;
      resetStreamingParser();
      return;
    }

    if (!currentResponse) {
      responseContainer.innerHTML = `<div class="empty-state">正在分析截屏...</div>`;
      resetStreamingParser();
      return;
    }

    renderStreamingMarkdown();
  }, [isLoading, currentResponse, isStreaming, renderStreamingMarkdown, resetStreamingParser]);

  return (
    <div className="flex flex-col h-full w-full bg-gradient-to-b from-muyu-dark-950 to-muyu-dark-900 rounded-muyu-lg overflow-hidden shadow-muyu-lg relative box-border font-sans text-white border border-white/10">
      <div 
        className="absolute inset-0 w-full h-full bg-black/15 rounded-muyu blur-[10px] -z-10"
        style={{ boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)' }}
      />
      
      <div 
        className="flex-1 p-5 overflow-y-auto text-md leading-relaxed bg-transparent relative select-text cursor-text"
        id="responseContainer" 
        ref={responseContainerRef}
      >
        <div className="flex items-center justify-center h-full text-white/35 text-md font-normal">
          正在分析截屏...
        </div>
      </div>
      
      {/* Custom scrollbar and code highlighting styles */}
      <style>{`
        .screenshot-container::-webkit-scrollbar {
          width: 6px;
        }
        .screenshot-container::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 3px;
        }
        .screenshot-container::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }
        .screenshot-container::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
        
        #responseContainer pre {
          background: rgba(0, 0, 0, 0.4) !important;
          border-radius: 8px !important;
          padding: 12px !important;
          margin: 8px 0 !important;
          overflow-x: auto !important;
          border: 1px solid rgba(255, 255, 255, 0.1) !important;
        }
        
        #responseContainer code {
          font-family: 'Monaco', 'Menlo', 'Consolas', monospace !important;
          font-size: 11px !important;
        }
        
        #responseContainer p code {
          background: rgba(255, 255, 255, 0.1) !important;
          padding: 2px 4px !important;
          border-radius: 3px !important;
          color: #ffd700 !important;
        }
        
        .hljs-keyword { color: #ff79c6 !important; }
        .hljs-string { color: #f1fa8c !important; }
        .hljs-comment { color: #6272a4 !important; }
        .hljs-number { color: #bd93f9 !important; }
        .hljs-function { color: #50fa7b !important; }
        .hljs-variable { color: #8be9fd !important; }
        .hljs-built_in { color: #ffb86c !important; }
        .hljs-title { color: #50fa7b !important; }
        .hljs-attr { color: #50fa7b !important; }
        .hljs-tag { color: #ff79c6 !important; }
      `}</style>
    </div>
  );
}

