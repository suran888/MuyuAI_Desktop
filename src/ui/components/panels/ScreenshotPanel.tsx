import React, { useEffect, useRef } from "react";

interface ScreenshotPanelProps {
  showAnswer: boolean;
  onAnswer: () => void;
  answer?: string;
  isLoading?: boolean;
  remainingMinutes?: number | null;
}

export function ScreenshotPanel({ showAnswer, onAnswer, answer = "", isLoading = false, remainingMinutes }: ScreenshotPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 当有新内容或加载状态改变时，自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [answer, isLoading, showAnswer]);

  return (
    <>
      {/* 截图按钮区域 - 固定在顶部 */}
      <button
        onClick={onAnswer}
        disabled={isLoading}
        style={{
          marginLeft: '50%',
          transform: 'translateX(-50%)'
        }}
        className="bg-[rgba(193,127,255,0.15)] h-[39px] rounded-[22px] w-[98px] flex items-center justify-center border border-[#c17fff] border-solid cursor-pointer hover:bg-[rgba(193,127,255,0.25)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="font-['PingFang_SC:Semibold',sans-serif] not-italic text-[#c17fff] text-[16px]">
          {isLoading ? '分析中...' : '截屏回答'}
        </span>
      </button>

      {/* 结果展示区域 - 参考 InputPanel 的滚动区域 */}
      <div
        ref={scrollRef}
        className="w-full h-full overflow-y-auto mt-[16px]"
        style={{ scrollbarWidth: 'none' }}
      >
        {/* 初始状态显示占位符 */}
        {!showAnswer && !isLoading && !answer && (
          <p className="font-['PingFang_SC:Semibold',sans-serif] leading-[1.5] not-italic text-[#999999] text-[14px] whitespace-pre-wrap">
            {!remainingMinutes || remainingMinutes <= 0
              ? '剩余时长不足，请兑换后继续使用'
              : '点击上方按钮开始截屏分析...'
            }
          </p>
        )}

        {/* 显示内容 */}
        {(showAnswer || isLoading || answer) && (
          <div className="flex flex-col gap-4 mb-6">
            {/* 操作/提问部分 */}
            <div className="flex flex-col gap-1">
              <div className="text-[#999999] text-[12px] font-['PingFang_SC:Medium',sans-serif]">
                操作
              </div>
              <div className="text-white text-[14px] font-['PingFang_SC:Regular',sans-serif] leading-relaxed whitespace-pre-wrap">
                {isLoading ? "正在截取屏幕并分析..." : "屏幕截图分析完成"}
              </div>
            </div>

            {/* AI回答部分 */}
            <div className="flex flex-col gap-1">
              <div className="text-[#999999] text-[12px] font-['PingFang_SC:Medium',sans-serif]">
                AI回答
              </div>
              <div className="text-white text-[14px] font-['PingFang_SC:Regular',sans-serif] leading-relaxed whitespace-pre-wrap">
                {answer || (isLoading ? "AI正在思考中..." : "等待回答...")}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

