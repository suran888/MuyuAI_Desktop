import { useState, useEffect, useRef, useCallback } from 'react';

interface MarkdownLibraries {
  marked: any;
  hljs: any;
  DOMPurify: any;
  isLoaded: boolean;
}

export function useMarkdownLibraries() {
  const [libraries, setLibraries] = useState<MarkdownLibraries>({
    marked: null,
    hljs: null,
    DOMPurify: null,
    isLoaded: false,
  });

  const loadScript = useCallback((src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }, []);

  useEffect(() => {
    const loadLibraries = async () => {
      try {
        // 以 content.html 为基准，静态资源位于 ../assets 目录下
        if (!(window as any).marked) {
          await loadScript('../assets/marked-4.3.0.min.js');
        }

        if (!(window as any).hljs) {
          await loadScript('../assets/highlight-11.9.0.min.js');
        }

        if (!(window as any).DOMPurify) {
          await loadScript('../assets/dompurify-3.0.7.min.js');
        }

        const marked = (window as any).marked;
        const hljs = (window as any).hljs;
        const DOMPurify = (window as any).DOMPurify;

        if (marked && hljs) {
          marked.setOptions({
            highlight: (code: string, lang: string) => {
              if (lang && hljs.getLanguage(lang)) {
                try {
                  return hljs.highlight(code, { language: lang }).value;
                } catch (err) {
                  console.warn('Highlight error:', err);
                }
              }
              try {
                return hljs.highlightAuto(code).value;
              } catch (err) {
                console.warn('Auto highlight error:', err);
              }
              return code;
            },
            breaks: true,
            gfm: true,
            pedantic: false,
            smartypants: false,
            xhtml: false,
          });

          setLibraries({
            marked,
            hljs,
            DOMPurify,
            isLoaded: true,
          });

          console.log('Markdown libraries loaded successfully in AskView');
        }
      } catch (error) {
        console.error('Failed to load libraries in AskView:', error);
      }
    };

    loadLibraries();
  }, [loadScript]);

  return libraries;
}

