import React from 'react';

interface MuyuLogoProps {
  /** SVG 路径数据对象，需要包含以下键：p2d759280, p114cea00, p315f7640, p932a200, p7655000, p1cfd3500, p33681900, p35222710 */
  svgPaths: {
    p2d759280: string;
    p114cea00: string;
    p315f7640: string;
    p932a200: string;
    p7655000: string;
    p1cfd3500: string;
    p33681900: string;
    p35222710: string;
  };
  /** 自定义 className，用于定位和样式 */
  className?: string;
}

/**
 * 幕语提词器 Logo 组件
 * 可复用的 Logo 组件，用于显示幕语提词器的品牌标识
 */
export function MuyuLogo({ svgPaths, className = 'absolute h-[25.762px] left-[139px] top-[45px] w-[177px]' }: MuyuLogoProps) {
  return (
    <div className={className}>
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 177 26">
        <g id="Frame 1618868608">
          <g id="Frame">
            <path d={svgPaths.p2d759280} fill="var(--fill-0, white)" />
            <path d={svgPaths.p114cea00} fill="var(--fill-0, white)" />
            <path d={svgPaths.p315f7640} fill="var(--fill-0, white)" />
          </g>
          <g id="幕语提词器">
            <path d={svgPaths.p932a200} fill="var(--fill-0, white)" />
            <path d={svgPaths.p7655000} fill="var(--fill-0, white)" />
            <path d={svgPaths.p1cfd3500} fill="var(--fill-0, white)" />
            <path d={svgPaths.p33681900} fill="var(--fill-0, white)" />
            <path d={svgPaths.p35222710} fill="var(--fill-0, white)" />
          </g>
        </g>
      </svg>
    </div>
  );
}

