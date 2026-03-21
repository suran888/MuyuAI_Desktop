import React, { useState } from "react";
import svgPaths from "../../imports/svg-apdjujtony";
import svgPathsTooltip from "../../imports/svg-9mojr1x5i6";

interface Frame12Props {
  onClick: () => void;
}

export function Frame12({ onClick }: Frame12Props) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="relative size-[20px]"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        onClick={onClick}
        className="block relative overflow-clip size-[20px] cursor-pointer bg-transparent border-none p-0 focus:outline-none"
        data-name="Frame"
      >
        <div className="absolute left-0 size-[16px] top-0">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 16 16">
            <g id="Frame">
              <path d={svgPaths.p35006f00} fill="var(--fill-0, white)" id="Vector" />
            </g>
          </svg>
        </div>
        <div className="absolute left-[-1px] overflow-clip size-[22px] top-[-3px]">
          <div className="absolute left-0 size-[16px] top-0" />
        </div>
      </button>

      {/* Tooltip - 在按钮左侧显示，垂直居中 */}
      {showTooltip && (
        <div className="absolute right-[30px] top-[2px] z-[99999]">
          <div className="absolute bg-[rgba(3,0,16,0.9)] h-[30px] right-[6.65px] rounded-[9px] top-0 w-[50px]" />
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
          <p className="absolute font-['PingFang_SC:Medium',sans-serif] h-[20px] leading-[normal] right-[17px] not-italic text-[14px] text-white top-[5px] whitespace-nowrap">设置</p>
        </div>
      )}
    </div>
  );
}

