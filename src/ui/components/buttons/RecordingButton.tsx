import React, { useState } from "react";
import svgPathsTooltip from "../../imports/svg-9mojr1x5i6";

interface RecordingButtonProps {
  isRecording: boolean;
  onClick: () => void;
}

export function RecordingButton({ isRecording, onClick }: RecordingButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        onClick={onClick}
        className="size-[36px] rounded-[19.5px] cursor-pointer transition-colors flex items-center justify-center"
        style={{
          backgroundColor: isRecording ? 'rgba(222,145,255,0.2)' : 'rgba(193,127,255,0.15)',
          border: '1px solid #c17fff'
        }}
      >
        {isRecording ? (
          // 等待状态 - 方块
          <div className="bg-[#c17fff] rounded-[3px] size-[12px]" />
        ) : (
          // 回答状态 - 三条竖线
          <div className="relative w-[12px] h-[15.273px]">
            <div className="bg-[#c17fff] h-[15.273px] absolute left-[4.8px] rounded-[2px] top-0 w-[2.4px]" />
            <div className="bg-[#c17fff] h-[10.573px] absolute left-0 rounded-[2px] top-[2.35px] w-[2.4px]" />
            <div className="bg-[#c17fff] h-[10.573px] absolute left-[9.6px] rounded-[2px] top-[2.35px] w-[2.4px]" />
          </div>
        )}
      </button>

      {/* Tooltip - 在按钮左侧显示 */}
      {showTooltip && (
        <div className="absolute right-[46px] top-[3px] z-[99999]">
          <div className="absolute bg-[rgba(3,0,16,0.9)] h-[30px] right-[6.65px] rounded-[9px] top-0 w-[75.351px]" />
          <div className="absolute flex h-[15.556px] items-center justify-center right-0 top-[6.67px] w-[15.514px]">
            <div className="flex-none rotate-[90deg]">
              <div className="h-[15.514px] relative w-[15.556px]">
                <div className="absolute bottom-1/4 left-[11.41%] right-[11.41%] top-[6.42%]">
                  <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 12 11">
                    <path d={svgPathsTooltip.p9bc04f0} fill="var(--fill-0, #110F28)" id="Polygon 1" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
          <p className="absolute font-['PingFang_SC:Medium',sans-serif] h-[20px] leading-[normal] right-[17px] not-italic text-[14px] text-white top-[5px] whitespace-nowrap">{isRecording ? '停止收音' : '开始收音'}</p>
        </div>
      )}
    </div>
  );
}

