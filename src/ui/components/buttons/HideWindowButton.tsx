import { useState, useMemo } from "react";
import { Group3 } from "../icons/Group3";
import svgPathsTooltip from "../../imports/svg-9mojr1x5i6";
import React from "react";

interface HideWindowButtonProps {
  onClick?: () => void;
}

export function HideWindowButton({ onClick }: HideWindowButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  // 检测操作系统，Mac 显示 ⌘+\，Windows/Linux 显示 Ctrl+\
  const shortcutKey = useMemo(() => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
                  navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
    return isMac ? '⌘+\\' : 'Ctrl+\\';
  }, []);

  return (
    <div
      className="relative cursor-pointer"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={onClick}
    >
      <div className="overflow-clip size-[22px]" data-name="Frame">
        <Group3 />
      </div>

      {/* Tooltip - 在按钮左侧显示，避免超出窗口边界 */}
      {showTooltip && (
        <div className="absolute right-[32px] top-[-10px] z-[99999]">
          <div className="absolute bg-[rgba(3,0,16,0.9)] h-[50px] right-[6.65px] rounded-[9px] top-0 w-[90px]" />
          {/* 箭头指向右侧 */}
          <div className="absolute flex h-[15.556px] items-center justify-center right-0 top-[12px] w-[15.514px]">
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
          <div className="absolute right-[17px] top-[5px] flex flex-col gap-[2px] items-end">
            <p className="font-['PingFang_SC:Medium',sans-serif] leading-[normal] not-italic text-[14px] text-white whitespace-nowrap">隐藏窗口</p>
            <p className="font-['PingFang_SC:Regular',sans-serif] leading-[normal] not-italic text-[11px] text-[rgba(255,255,255,0.6)] whitespace-nowrap">{shortcutKey} 恢复</p>
          </div>
        </div>
      )}
    </div>
  );
}

