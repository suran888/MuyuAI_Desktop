import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useIpcListener } from '../hooks';

interface Turn {
  id: string;
  speaker: string;
  text?: string;
  finalText?: string;
  partialText?: string;
  status?: string;
  isFinal?: boolean;
}

interface TurnState {
  turnHistory?: Turn[];
  activeTurns?: Turn[];
}

export function TranscriptView() {
  const [messages, setMessages] = useState<Map<string, Turn>>(new Map());
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, []);

  const handleTurnUpdate = useCallback((turn: Turn) => {
    let text = turn.text;
    if (!text && (turn.finalText || turn.partialText)) {
      text = turn.finalText || turn.partialText;
    }

    if (!text || text.trim() === '') return;

    setMessages(prev => {
      const updated = new Map(prev);
      updated.set(turn.id, turn);
      return updated;
    });

    // Scroll after state update
    requestAnimationFrame(() => scrollToBottom());
  }, [scrollToBottom]);

  const handleTurnUpdateFromIpc = useCallback((event: any, turn: Turn) => {
    handleTurnUpdate(turn);
  }, [handleTurnUpdate]);

  useIpcListener('liveInsights:onTurnUpdate', handleTurnUpdateFromIpc);

  // Load initial state
  useEffect(() => {
    console.log('[TranscriptView] Requesting initial state...');
    if (!window.api || !window.api.liveInsights) return;

    window.api.liveInsights.getTurnState().then((state: TurnState) => {
      console.log('[TranscriptView] Received initial state:', state);
      
      if (state && state.turnHistory) {
        console.log('[TranscriptView] Rendering history:', state.turnHistory.length, 'items');
        state.turnHistory.forEach(turn => handleTurnUpdate(turn));
      }
      
      if (state && state.activeTurns) {
        console.log('[TranscriptView] Rendering active turns:', state.activeTurns.length, 'items');
        state.activeTurns.forEach(turn => handleTurnUpdate(turn));
      }
    }).catch(err => {
      console.error('[TranscriptView] Error getting initial state:', err);
    });
  }, [handleTurnUpdate]);

  // Convert Map to sorted array
  const sortedMessages = Array.from(messages.values());

  return (
    <div className="w-full h-full flex flex-col bg-muyu-dark-850 text-white font-sans">
      <div 
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 flex flex-col gap-2"
        style={{
          scrollbarWidth: 'thin',
        }}
      >
        {sortedMessages.map(turn => {
          const text = turn.text || turn.finalText || turn.partialText || '';
          const isMe = turn.speaker === 'Me';
          const isFinalized = turn.status === 'completed' || turn.isFinal;

          return (
            <div
              key={turn.id}
              id={`msg-${turn.id}`}
              className={`
                px-3 py-2 rounded-muyu max-w-[80%] 
                break-words leading-relaxed text-base
                transition-opacity duration-200
                ${isMe 
                  ? 'bg-muyu-blue-500 text-white self-end ml-auto rounded-br-sm' 
                  : 'bg-muyu-dark-100 text-white/90 self-start mr-auto rounded-bl-sm'
                }
                ${isFinalized ? 'opacity-100' : 'opacity-70'}
              `}
            >
              {text}
            </div>
          );
        })}
      </div>
      
      {/* Custom scrollbar styles */}
      <style>{`
        .transcript-container::-webkit-scrollbar {
          width: 8px;
        }
        .transcript-container::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
        }
        .transcript-container::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
        }
        .transcript-container::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      `}</style>
    </div>
  );
}

