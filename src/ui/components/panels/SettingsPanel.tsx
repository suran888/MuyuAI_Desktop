import React, { useState, useCallback, useEffect } from "react";
import svgPathsSettings from "../../imports/svg-fg17hkisy3";
import { UserState } from "../../types";

interface SettingsPanelProps {
  onClose: () => void;
  onExitInterview: () => void;
  leftWidth: number;
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error' | 'development';

export function SettingsPanel({ onClose, onExitInterview, leftWidth }: SettingsPanelProps) {
  const [isContentProtectionOn, setIsContentProtectionOn] = useState(false);
  const [userState, setUserState] = useState<UserState | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [downloadPercent, setDownloadPercent] = useState<number>(0);

  // 初始化时获取当前状态和用户信息
  useEffect(() => {
    const settingsApi = (window as any).api?.settingsView;
    const commonApi = (window as any).api?.common;

    // 获取内容保护状态
    if (settingsApi?.getContentProtectionStatus) {
      settingsApi.getContentProtectionStatus().then((status: boolean) => {
        setIsContentProtectionOn(status);
      });
    }

    // 获取应用版本
    if (settingsApi?.getAppVersion) {
      settingsApi.getAppVersion().then((version: string) => {
        setAppVersion(version);
      });
    }

    // 获取用户信息
    if (commonApi?.getCurrentUser) {
      commonApi.getCurrentUser().then((user: UserState) => {
        if (user && user.isLoggedIn) {
          console.log('[SettingsPanel] getCurrentUser result:', user);
          console.log('[SettingsPanel] user.phone:', user.phone);
          console.log('[SettingsPanel] user.email:', user.email);
          setUserState(user);
        }
      });
    }

    // 监听用户状态变化
    if (commonApi?.onUserStateChanged) {
      const handleUserStateChanged = (event: any, user: UserState) => {
        if (user && user.isLoggedIn) {
          console.log('[SettingsPanel] onUserStateChanged result:', user);
          console.log('[SettingsPanel] user.phone:', user.phone);
          console.log('[SettingsPanel] user.email:', user.email);
          setUserState(user);
        } else {
          setUserState(null);
        }
      };

      commonApi.onUserStateChanged(handleUserStateChanged);

      return () => {
        if (commonApi?.removeOnUserStateChanged) {
          commonApi.removeOnUserStateChanged(handleUserStateChanged);
        }
      };
    }
  }, []);

  // 监听更新状态
  useEffect(() => {
    const settingsApi = (window as any).api?.settingsView;
    if (!settingsApi?.onUpdateStatus) return;

    const handleUpdateStatus = (event: any, data: any) => {
      console.log('[SettingsPanel] Update status:', data);
      setUpdateStatus(data.status);
      if (data.percent !== undefined) {
        setDownloadPercent(data.percent);
      }
    };

    settingsApi.onUpdateStatus(handleUpdateStatus);

    return () => {
      if (settingsApi?.removeOnUpdateStatus) {
        settingsApi.removeOnUpdateStatus(handleUpdateStatus);
      }
    };
  }, []);

  const handleToggleInvisibility = useCallback(async () => {
    console.log('Toggle Invisibility clicked');
    const settingsApi = (window as any).api?.settingsView;
    if (settingsApi?.toggleContentProtection) {
      const newStatus = await settingsApi.toggleContentProtection();
      setIsContentProtectionOn(newStatus);
    }
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    const settingsApi = (window as any).api?.settingsView;
    if (settingsApi?.checkForUpdates) {
      setUpdateStatus('checking');
      const result = await settingsApi.checkForUpdates();
      console.log('[SettingsPanel] Check for updates result:', result);
    }
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    const settingsApi = (window as any).api?.settingsView;
    if (settingsApi?.installUpdate) {
      await settingsApi.installUpdate();
    }
  }, []);

  const getUpdateStatusText = () => {
    switch (updateStatus) {
      case 'checking':
        return '正在检查...';
      case 'available':
        return '发现新版本，准备下载...';
      case 'downloading':
        return `正在下载 ${downloadPercent.toFixed(0)}%`;
      case 'downloaded':
        return '下载完成，点击安装';
      case 'not-available':
        return '已是最新版本';
      case 'error':
        return '检查失败';
      case 'development':
        return '开发环境';
      default:
        return '检查更新';
    }
  };
  return (
    <div className="absolute h-full top-0 w-[298px] z-[10000] rounded-[19px]" style={{ left: `${leftWidth + 6}px`, transition: 'none', padding: '53px 21px 21px' }}>
      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        className="absolute left-[262px] top-[14px] size-[20px] cursor-pointer bg-transparent border-none p-0"
      >
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 20 20">
          <path d={svgPathsSettings.p3be22e00} fill="var(--fill-0, white)" fillOpacity="0.2" />
        </svg>
      </button>

      {/* 幕语提词器 Logo */}
      <div className="absolute h-[17.029px] left-[92px] top-[16px] w-[117px]">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 117 18">
          <g id="Frame 1618868608">
            <g clipPath="url(#clip0_34_1358)" id="Frame">
              <path d={svgPathsSettings.pdfa9d30} fill="var(--fill-0, white)" />
              <path d={svgPathsSettings.p263c0c80} fill="var(--fill-0, white)" />
              <path d={svgPathsSettings.p1e44ca00} fill="var(--fill-0, white)" />
            </g>
            <g id="幕语提词器">
              <path d={svgPathsSettings.p1ec58f80} fill="var(--fill-0, white)" />
              <path d={svgPathsSettings.p268e4aa0} fill="var(--fill-0, white)" />
              <path d={svgPathsSettings.p36870500} fill="var(--fill-0, white)" />
              <path d={svgPathsSettings.p4388300} fill="var(--fill-0, white)" />
              <path d={svgPathsSettings.p4b75e00} fill="var(--fill-0, white)" />
            </g>
          </g>
          <defs>
            <clipPath id="clip0_34_1358">
              <rect fill="white" height="16.7736" transform="matrix(-1 -8.74228e-08 -8.74228e-08 1 23.1638 0.127728)" width="23.1636" />
            </clipPath>
          </defs>
        </svg>
      </div>

      {/* 显示用户信息  */}
      <div className="w-full mt-[16px]">
        {userState && userState.isLoggedIn && (
          <div className="pl-[16px] w-[266px]">
            {/* 分隔线 */}
            <div className="h-[1px] bg-[rgba(255,255,255,0.1)] mb-[16px]" />

            {/* 用户信息 */}
            <div className="flex items-start gap-[12px]">
              {/* 简单的用户图标 */}
              <div className="flex-shrink-0 mt-[2px]">
                <svg className="w-[20px] h-[20px]" fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.6)" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>

              {/* 用户信息文本 */}
              <div className="flex-1 min-w-0">
                {userState.displayName && (
                  <p className="font-['PingFang_SC:Semibold',sans-serif] leading-[20px] not-italic text-white text-[14px] mb-[4px] truncate">
                    {userState.displayName}
                  </p>
                )}
                {/* 优先显示手机号，如果没有手机号则显示邮箱 */}
                {(() => {
                  return userState.phone ? (
                    <p className="font-['PingFang_SC:Regular',sans-serif] leading-[18px] not-italic text-[rgba(255,255,255,0.6)] text-[12px] truncate">
                      {userState.phone}
                    </p>
                  ) : userState.email ? (
                    <p className="font-['PingFang_SC:Regular',sans-serif] leading-[18px] not-italic text-[rgba(255,255,255,0.6)] text-[12px] truncate">
                      {userState.email}
                    </p>
                  ) : null;
                })()}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 底部按钮区域 - 固定在底部 */}
      <div className="footer absolute w-full bottom-0 left-0 flex flex-col gap-[12px] pb-[21px] justify-center">
        {/* 版本信息和检查更新 */}
        <div className="flex flex-col items-center gap-[8px]">
          {appVersion && (
            <p className="font-['PingFang_SC:Regular',sans-serif] text-[12px] text-[rgba(255,255,255,0.4)]">
              当前版本: v{appVersion}
            </p>
          )}
          <button
            onClick={updateStatus === 'downloaded' ? handleInstallUpdate : handleCheckForUpdates}
            disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
            className={`h-[32px] rounded-[16px] px-[16px] flex items-center justify-center border border-solid cursor-pointer transition-colors
              ${updateStatus === 'downloaded' 
                ? 'bg-[rgba(34,197,94,0.15)] border-[rgba(34,197,94,0.6)] hover:bg-[rgba(34,197,94,0.25)]' 
                : 'bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.2)] hover:bg-[rgba(255,255,255,0.1)]'}
              ${(updateStatus === 'checking' || updateStatus === 'downloading') ? 'opacity-60 cursor-not-allowed' : ''}
            `}
          >
            <span className={`font-['PingFang_SC:Regular',sans-serif] not-italic text-[12px]
              ${updateStatus === 'downloaded' ? 'text-[rgba(34,197,94,1)]' : 'text-[rgba(255,255,255,0.6)]'}
            `}>
              {getUpdateStatusText()}
            </span>
          </button>
        </div>

        {/* 隐身模式按钮 - 仅开发模式显示 */}
        {process.env.NODE_ENV === 'development' && (
          <button
            onClick={handleToggleInvisibility}
            className="bg-[rgba(138,43,226,0.15)] h-[39px] rounded-[22px] w-[130px] flex items-center justify-center border border-[rgba(138,43,226,0.6)] border-solid cursor-pointer hover:bg-[rgba(138,43,226,0.25)] transition-colors mx-auto"
          >
            <span className="font-['PingFang_SC:Semibold',sans-serif] not-italic text-[rgba(180,130,255,1)] text-[14px]">
              {isContentProtectionOn ? '关闭隐身' : '开启隐身'}
            </span>
          </button>
        )}

        {/* 退出面试按钮 */}
        <button
          onClick={onExitInterview}
          style={{
            marginLeft: '50%',
            transform: 'translateX(-50%)',
          }}
          className={`bg-[rgba(187,46,48,0.15)] h-[39px] rounded-[22px] w-[109px] flex items-center justify-center border border-[#bb0003] border-solid cursor-pointer hover:bg-[rgba(187,46,48,0.25)] transition-colors ${process.env.NODE_ENV === 'development' ? 'left-[156px]' : 'left-[96px]'}`}
        >
          <span className="font-['PingFang_SC:Semibold',sans-serif] not-italic text-[#d10003] text-[15px]">退出面试</span>
        </button>
      </div>
    </div>
  );
}

