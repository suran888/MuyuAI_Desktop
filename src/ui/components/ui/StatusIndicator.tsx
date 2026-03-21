import React from "react";

interface StatusIndicatorProps {
  isRecording: boolean;
}

export function StatusIndicator({ isRecording }: StatusIndicatorProps) {
  return (
    <div className="flex items-center gap-[9px]">
      <div className="size-[4px]">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 4 4">
          <circle cx="2" cy="2" fill={isRecording ? "var(--fill-0, #23F261)" : "var(--fill-0, #FF0004)"} id="Ellipse 1" r="2" />
        </svg>
      </div>
      <p className="font-['PingFang_SC:Medium',sans-serif] leading-[normal] not-italic text-[12px] text-[rgba(255,255,255,0.6)] text-nowrap whitespace-pre">
        {isRecording ? '回答中...' : '等待中'}
      </p>
    </div>
  );
}

