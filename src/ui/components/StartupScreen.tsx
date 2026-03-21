import React from 'react';
import { MuyuLogo } from './MuyuLogo';

// SVG 路径数据 - 如果导入失败，使用备用数据
let svgPathsStartup: any;
try {
  const mod = require('../imports/svg-7hkh1j06cm');
  // 兼容 default 导出和 CommonJS 导出
  svgPathsStartup = mod.default || mod;
} catch {
  // 备用 SVG 路径数据
  svgPathsStartup = {
    p3be22e00: "M10 10L10 10",
    p2d759280: "M0 0",
    p114cea00: "M0 0",
    p315f7640: "M0 0",
    p932a200: "M0 0",
    p7655000: "M0 0",
    p1cfd3500: "M0 0",
    p33681900: "M0 0",
    p35222710: "M0 0",
    p2640da00: "M0 0",
  };
}

interface StartupScreenProps {
  interviewCode: string;
  onInterviewCodeChange: (code: string) => void;
  onStartInterview: () => void;
  onClose?: () => void;
  onCreateInterview?: () => void;
  passcodeError?: string;
  passcodeVerified?: boolean;
  isVerifyingPasscode?: boolean;
  passcodeRequired?: boolean;
  position?: { x: number; y: number };
  isDragging?: boolean;
  onMouseDown?: (e: any) => void;
  onMouseMove?: (e: any) => void;
  onMouseUp?: () => void;
}

export function StartupScreen({
  interviewCode,
  onInterviewCodeChange,
  onStartInterview,
  onClose,
  onCreateInterview,
  passcodeError,
  passcodeVerified = false,
  isVerifyingPasscode = false,
  passcodeRequired = false,
  position = { x: 0, y: 0 },
  isDragging = false,
  onMouseDown,
  onMouseMove,
  onMouseUp,
}: StartupScreenProps) {
  const passcodeGateActive = passcodeRequired && !passcodeVerified;
  const buttonDisabled = !passcodeGateActive || interviewCode.length !== 8 || isVerifyingPasscode;

  return (
    <div className="inline-flex">
      <div
        className="relative w-[455px] h-[311px]"
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
          cursor: isDragging ? 'grabbing' : onMouseDown ? 'grab' : 'default',
          userSelect: 'none',
          WebkitAppRegion: onMouseDown ? 'no-drag' : 'drag',
        } as React.CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        {/* 背景 */}
        <div className="absolute bg-[rgba(3,0,16,0.7)] h-[311px] left-0 rounded-[19px] top-0 w-[455px]">
          <div aria-hidden="true" className="absolute border border-[rgba(255,255,255,0.2)] border-solid inset-0 pointer-events-none rounded-[19px]" />
        </div>

        {/* 关闭按钮 */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute left-[425px] top-[12px] size-[20px] cursor-pointer hover:opacity-80 transition-opacity"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' }}
          >
            <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 20 20">
              <path d={svgPathsStartup.p3be22e00} fill="var(--fill-0, white)" fillOpacity="0.2" />
            </svg>
          </button>
        )}

        {/* Logo */}
        <MuyuLogo svgPaths={svgPathsStartup} />

        {/* 说明文字 */}
        <p className="absolute font-['PingFang_SC:Regular',sans-serif] leading-[normal] left-[35px] not-italic text-[15px] text-white top-[97px] w-[385px]">
          请在工作台创建面试，获得8位字母数字面试码后下方输入。验证成功后将开启面试。
        </p>

        {/* 创建面试链接 */}
        {onCreateInterview && (
          <button
            type="button"
            onClick={onCreateInterview}
            className="absolute left-[226.5px] top-[118px] flex items-center gap-[4px] cursor-pointer hover:opacity-80 transition-opacity"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' }}
          >
            <p className="font-['PingFang_SC:Regular',sans-serif] leading-[normal] not-italic text-[#c17fff] text-[15px]">创建面试</p>
            <div className="w-[4.987px] h-[10px] rotate-180">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 5 10">
                <path d={svgPathsStartup.p2640da00} fill="var(--fill-0, #C17FFF)" />
              </svg>
            </div>
          </button>
        )}

        {/* 输入框容器 - 根据验证状态改变样式 */}
        <div
          className={`absolute h-[44px] left-[35px] rounded-[12px] top-[166px] w-[385px] ${passcodeVerified
            ? 'bg-[rgba(18,61,42,0.8)] border border-[rgba(116,255,203,0.55)]'
            : 'bg-[rgba(193,127,255,0.1)] border border-[#c17fff]'
            }`}
        >
          <div aria-hidden="true" className="absolute border border-solid inset-0 pointer-events-none rounded-[12px]" />
        </div>
        <input
          type="text"
          value={interviewCode}
          onChange={(e) => onInterviewCodeChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !buttonDisabled && onStartInterview()}
          disabled={!passcodeGateActive}
          className={`absolute left-[52.5px] top-[178px] w-[350px] bg-transparent border-none outline-none font-['PingFang_SC:Regular',sans-serif] text-[15px] text-center leading-[normal] placeholder:opacity-50 ${passcodeVerified
            ? 'text-[#98ffd7] placeholder:text-[#98ffd7]'
            : 'text-[#c17fff] placeholder:text-[#c17fff]'
            } ${!passcodeGateActive ? 'opacity-60 cursor-not-allowed' : ''}`}
          placeholder="XXXXXXXX"
          maxLength={8}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          style={{ WebkitAppRegion: 'no-drag', letterSpacing: passcodeGateActive ? '0.3em' : 'normal' } as React.CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' }}
        />

        {/* 错误信息 */}
        {passcodeError && (
          <div className="absolute left-[35px] top-[214px] w-[385px] text-center text-[#ff9c9c] text-[13px] min-h-[18px] overflow-hidden text-ellipsis whitespace-nowrap">
            {passcodeError}
          </div>
        )}

        {/* 开始面试按钮 */}
        <button
          onClick={onStartInterview}
          disabled={buttonDisabled}
          className={`absolute h-[44px] left-[35px] rounded-[22px] w-[385px] flex items-center justify-center transition-all border-none ${buttonDisabled
            ? 'bg-[rgba(255,255,255,0.12)] text-[#bebebe] cursor-not-allowed opacity-75'
            : 'bg-[rgba(255,255,255,0.3)] text-white cursor-pointer hover:bg-[rgba(255,255,255,0.4)]'
            }`}
          style={{
            top: passcodeError ? '240px' : '222px',
            WebkitAppRegion: 'no-drag'
          } as React.CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' }}
        >
          <span className="font-['PingFang_SC:Semibold',sans-serif] not-italic text-[15px]">
            {isVerifyingPasscode ? '核验中…' : '开始面试'}
          </span>
        </button>

        {/* 成功状态提示 */}
        {!passcodeGateActive && passcodeVerified && (
          <div className="absolute left-[35px] top-[270px] w-[385px] px-[15px] py-[13px] rounded-[16px] bg-[rgba(18,61,42,0.8)] border border-[rgba(116,255,203,0.55)] text-[#98ffd7] text-[14px] leading-[21px]">
            面试码验证成功，正在载入…
          </div>
        )}
      </div>
    </div>
  );
}

