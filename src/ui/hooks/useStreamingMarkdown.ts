import { useEffect, useRef, useCallback } from 'react';

declare global {
  interface Window {
    smd: {
      parser: (renderer: any) => any;
      parser_write: (parser: any, text: string) => void;
      parser_end: (parser: any) => void;
      default_renderer: (container: HTMLElement) => any;
    };
  }
}

interface StreamingMarkdownRendererProps {
  content: string;
  isStreaming: boolean;
  isLoading: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  hljs?: any;
}

export function useStreamingMarkdownRenderer({
  content,
  isStreaming,
  isLoading,
  containerRef,
  hljs
}: StreamingMarkdownRendererProps) {
  const smdParserRef = useRef<any>(null);
  const lastProcessedLengthRef = useRef(0);
  const previousContainerRef = useRef<HTMLElement | null>(null);

  const resetParser = useCallback(() => {
    smdParserRef.current = null;
    lastProcessedLengthRef.current = 0;
    previousContainerRef.current = null;
  }, []);

  const renderStreamingMarkdown = useCallback(() => {
    if (!containerRef.current) return;

    try {
      // Check if SMD library is loaded
      if (!window.smd || typeof window.smd.parser !== 'function') {
        console.warn('[StreamingMarkdown] SMD library not loaded, falling back to plain text');
        if (content) {
          containerRef.current.textContent = content;
        }
        return;
      }

      // Create a new parser if none exists or the container changed
      if (!smdParserRef.current || previousContainerRef.current !== containerRef.current) {
        previousContainerRef.current = containerRef.current;
        containerRef.current.innerHTML = '';

        // Use smd.js default_renderer
        const renderer = window.smd.default_renderer(containerRef.current);
        smdParserRef.current = window.smd.parser(renderer);
        lastProcessedLengthRef.current = 0;
      }

      // Process only new text (streaming optimization)
      const newText = content.slice(lastProcessedLengthRef.current);

      if (newText.length > 0) {
        // Send the new text chunk to the parser
        window.smd.parser_write(smdParserRef.current, newText);
        lastProcessedLengthRef.current = content.length;
      }

      // End the parser when streaming is complete
      if (!isStreaming && !isLoading) {
        window.smd.parser_end(smdParserRef.current);
      }

      // Apply code highlighting
      if (hljs && containerRef.current) {
        containerRef.current.querySelectorAll('pre code').forEach(block => {
          if (!block.hasAttribute('data-highlighted')) {
            hljs.highlightElement(block);
            block.setAttribute('data-highlighted', 'true');
          }
        });
      }

      // Scroll to the bottom
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }

    } catch (error) {
      console.error('Error rendering streaming markdown:', error);
      // Fallback to plain text
      if (containerRef.current && content) {
        containerRef.current.textContent = content;
      }
    }
  }, [content, isStreaming, isLoading, containerRef, hljs]);

  useEffect(() => {
    if (isLoading) {
      resetParser();
      if (containerRef.current) {
        containerRef.current.innerHTML = `
          <div class="loading-dots">
            <div class="loading-dot"></div>
            <div class="loading-dot"></div>
            <div class="loading-dot"></div>
          </div>`;
      }
      return;
    }

    if (!content) {
      resetParser();
      if (containerRef.current) {
        containerRef.current.innerHTML = `<div class="empty-state">此处将展示生成的回答...</div>`;
      }
      return;
    }

    renderStreamingMarkdown();
  }, [content, isLoading, isStreaming, containerRef, resetParser, renderStreamingMarkdown]);

  return { resetParser };
}

