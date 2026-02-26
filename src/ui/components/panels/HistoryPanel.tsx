import React, { useEffect, useRef } from "react";
import { Turn } from "../../types";

interface HistoryPanelProps {
  turns?: Turn[];
}

export function HistoryPanel({ turns = [] }: HistoryPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);
  const prevTurnsLengthRef = useRef(0);

  // 监听用户滚动
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      // 判断是否接近底部 (20px 容差)
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
      isUserScrollingRef.current = !isNearBottom;
      console.log('[HistoryPanel] Scroll event - isNearBottom:', isNearBottom, 'scrollTop:', el.scrollTop, 'scrollHeight:', el.scrollHeight);
    };

    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    console.log('[HistoryPanel] Turns updated - length:', turns.length, 'prev:', prevTurnsLengthRef.current);
    console.log('[HistoryPanel] Turns data:', turns.map(t => ({ id: t.id, speaker: t.speaker, q: t.question?.slice(0, 30), a: t.answer?.slice(0, 30) })));
    
    // 只有在以下情况才自动滚动到底部：
    // 1. 新增了一个 turn（length 增加）
    // 2. 用户当前已经在底部（不是在主动浏览历史）
    const isNewTurnAdded = turns.length > prevTurnsLengthRef.current;
    prevTurnsLengthRef.current = turns.length;
    
    if (scrollRef.current && (isNewTurnAdded || !isUserScrollingRef.current)) {
      console.log('[HistoryPanel] Auto scrolling to bottom - isNewTurnAdded:', isNewTurnAdded);
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    } else {
      console.log('[HistoryPanel] Skipping auto scroll - isUserScrolling:', isUserScrollingRef.current);
    }
  }, [turns]);

  return (
    <div
      ref={scrollRef}
      className="w-full h-full overflow-y-auto px-4"
      style={{ scrollbarWidth: 'none' }}
    >
      {turns.length === 0 && (
        <p className="font-['PingFang_SC:Regular',sans-serif] leading-[20px] text-[14px] text-[rgba(255,255,255,0.6)] mt-4">
          暂无历史对话记录...
        </p>
      )}

      {turns.map((turn, index) => (
        <div key={`${turn.id}-${index}`} className={`flex flex-col gap-1 mb-4 ${turn.speaker === 'Me' ? 'items-end' : 'items-start'}`}>
          {/* 说话人标签 */}
          <div className={`text-[#999999] text-[12px] font-['PingFang_SC:Medium',sans-serif] ${turn.speaker === 'Me' ? 'mr-2' : 'ml-2'}`}>
            {turn.speaker === 'Me' ? '我' : '对方'}
          </div>
          
          {/* 发言内容 */}
          {turn.question && (
            <div className={`relative max-w-[90%] ${turn.speaker === 'Me' ? 'items-end' : 'items-start'}`}>
              <div className={`${turn.speaker === 'Me'
                ? 'bg-[rgba(193,127,255,0.4)] rounded-tr-none rounded-tl-[10px] rounded-br-[10px] rounded-bl-[10px]'
                : 'bg-[rgba(255,255,255,0.15)] rounded-tl-none rounded-tr-[10px] rounded-br-[10px] rounded-bl-[10px]'} 
                   px-3 py-2.5 min-w-[60px]`}>
                <p className="font-['PingFang_SC:Regular',sans-serif] text-[14px] text-white leading-relaxed whitespace-pre-wrap break-words">
                  {turn.question}
                </p>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

