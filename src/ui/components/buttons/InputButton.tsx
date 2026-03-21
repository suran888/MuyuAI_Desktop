import { useState } from "react";
import svgPaths from "../../imports/svg-apdjujtony";
import svgPathsTooltip from "../../imports/svg-9mojr1x5i6";
import React from "react";

interface InputButtonProps {
  onClick: () => void;
  isActive: boolean;
}

export function InputButton({ onClick, isActive }: InputButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="h-[22px] relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        onClick={onClick}
        className="size-[22px] bg-transparent border-none p-0 cursor-pointer"
        data-name="Frame"
      >
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 22 22">
          <g id="Frame">
            <path d={svgPaths.p25319480} fill={isActive ? "#C17FFF" : "white"} id="Vector" />
            <path d={svgPaths.p7ad9680} fill={isActive ? "#C17FFF" : "white"} id="Vector_2" />
          </g>
        </svg>
      </button>

      {/* Tooltip - 在按钮左侧显示 */}
      {showTooltip && (
        <div className="absolute right-[32px] top-[-4px] z-[99999]">
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
          <p className="absolute font-['PingFang_SC:Medium',sans-serif] h-[20px] leading-[normal] right-[17px] not-italic text-[14px] text-white top-[5px] whitespace-nowrap">打字提问</p>
        </div>
      )}
    </div>
  );
}

