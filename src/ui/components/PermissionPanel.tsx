import React, { useState, useEffect, useCallback, useRef } from "react";
import svgPathsPermission from "../imports/svg-nskm8ew5pp";
import svgPathsStartup from "../imports/svg-7hkh1j06cm";
import { MuyuLogo } from "./MuyuLogo";

interface PermissionPanelProps {
  onComplete?: () => void;
  onClose?: () => void;
  continueCallback?: () => void;
}

type PermissionStatus = 'unknown' | 'granted' | 'denied' | 'not-determined' | 'restricted';

export default function PermissionPanel({ onComplete, onClose, continueCallback }: PermissionPanelProps) {
  const [microphoneGranted, setMicrophoneGranted] = useState<PermissionStatus>('unknown');
  const [screenGranted, setScreenGranted] = useState<PermissionStatus>('unknown');
  const [isChecking, setIsChecking] = useState(false);
  const [userMode, setUserMode] = useState<'local' | 'interview'>('local');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const userModeRef = useRef<'local' | 'interview'>('local');
  const continueCallbackRef = useRef(continueCallback);
  const onCompleteRef = useRef(onComplete);
  const isCheckingRef = useRef(false);

  const allGranted = microphoneGranted === 'granted' && screenGranted === 'granted';

  // 更新 ref 以保持最新值
  useEffect(() => {
    userModeRef.current = userMode;
  }, [userMode]);

  useEffect(() => {
    continueCallbackRef.current = continueCallback;
  }, [continueCallback]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // 更新 isChecking ref
  useEffect(() => {
    isCheckingRef.current = isChecking;
  }, [isChecking]);

  // 使用 useRef 存储 checkPermissions 函数，避免依赖问题
  const checkPermissionsRef = useRef<(() => Promise<void>) | null>(null);

  checkPermissionsRef.current = async () => {
    if (!(window as any).api || isCheckingRef.current) {
      return;
    }

    isCheckingRef.current = true;
    setIsChecking(true);

    try {
      const permissions = await (window as any).api.permissionHeader.checkSystemPermissions();
      console.log('[PermissionPanel] Permission check result:', permissions);

      // 缓存权限状态到全局，供节流逻辑使用
      (window as any)._cachedMicPermission = permissions.microphone;
      (window as any)._cachedScreenPermission = permissions.screen;

      setMicrophoneGranted(prev => {
        if (prev !== permissions.microphone) {
          console.log('[PermissionPanel] Microphone permission changed:', prev, '->', permissions.microphone);
        }
        return permissions.microphone;
      });
      setScreenGranted(prev => {
        if (prev !== permissions.screen) {
          console.log('[PermissionPanel] Screen permission changed:', prev, '->', permissions.screen);
        }
        return permissions.screen;
      });

      // 使用一个标记防止重复触发跳转
      if (permissions.microphone === 'granted' &&
        permissions.screen === 'granted' &&
        (continueCallbackRef.current || onCompleteRef.current) &&
        !(window as any)._permissionTransitionTriggered) {
        console.log('[PermissionPanel] ✅ All permissions granted, proceeding automatically');
        (window as any)._permissionTransitionTriggered = true;

        // 立即触发，不延迟
        console.log('[PermissionPanel] Triggering transition callback...');
        if (continueCallbackRef.current) {
          continueCallbackRef.current();
        } else if (onCompleteRef.current) {
          onCompleteRef.current();
        }
      }
    } catch (error) {
      console.error('[PermissionPanel] Error checking permissions:', error);
    } finally {
      isCheckingRef.current = false;
      setIsChecking(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const loadUserState = async () => {
      if ((window as any).api && mounted) {
        try {
          const userState = await (window as any).api.common.getCurrentUser();
          if (mounted) {
            setUserMode(userState.mode);
          }
        } catch (e) {
          console.error('[PermissionPanel] Failed to get user state', e);
          if (mounted) {
            setUserMode('local');
          }
        }
      }
    };

    loadUserState();

    // 立即执行第一次权限检查
    const initialCheckTimeout = setTimeout(() => {
      if (mounted && checkPermissionsRef.current) {
        console.log('[PermissionPanel] Running initial permission check');
        checkPermissionsRef.current();
      }
    }, 300); // 减少延迟，更快响应

    // Set up periodic permission check - 增加到 3 秒，减少刷新频率
    // 并添加节流机制，只有在权限未全部授予时才持续检查
    intervalRef.current = setInterval(async () => {
      if (!mounted || !(window as any).api) return;

      // 只在没有正在检查时才执行
      if (isCheckingRef.current) {
        console.log('[PermissionPanel] Skipping check, already in progress');
        return;
      }

      // 如果权限已全部授予，停止频繁检查
      const permissionStates = {
        mic: (window as any)._cachedMicPermission,
        screen: (window as any)._cachedScreenPermission
      };

      if (permissionStates.mic === 'granted' &&
        permissionStates.screen === 'granted') {
        console.log('[PermissionPanel] All permissions granted, reducing check frequency');
        // 权限已全部授予，跳过本次检查
        return;
      }

      try {
        const userState = await (window as any).api.common.getCurrentUser();
        if (mounted) {
          setUserMode(prev => {
            if (prev !== userState.mode) {
              console.log('[PermissionPanel] User mode changed:', prev, '->', userState.mode);
            }
            return userState.mode;
          });
        }
      } catch (e) {
        if (mounted) {
          setUserMode('local');
        }
      }

      if (mounted && checkPermissionsRef.current) {
        checkPermissionsRef.current();
      }
    }, 3000); // 3 秒检查一次

    return () => {
      mounted = false;
      clearTimeout(initialCheckTimeout);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []); // 空依赖数组，只在挂载时执行一次

  // Calculate and notify height changes (only when layout actually changes)
  const prevHeightRef = useRef<number | null>(null);
  const prevCalcKeyRef = useRef<string>('');

  useEffect(() => {
    let newHeight = 430;

    if (allGranted) {
      newHeight += 70;
    }

    // 创建一个计算键，只有当真正影响高度的因素变化时才触发
    const calcKey = `${allGranted}`;

    // 只在高度真正变化时才发送事件，并且避免重复触发
    if (prevHeightRef.current !== newHeight && prevCalcKeyRef.current !== calcKey) {
      console.log(`[PermissionPanel] Height changed from ${prevHeightRef.current}px to ${newHeight}px, requesting resize`);
      prevHeightRef.current = newHeight;
      prevCalcKeyRef.current = calcKey;

      // Dispatch custom event for parent component
      const event = new CustomEvent('request-resize', {
        detail: { height: newHeight },
        bubbles: true,
      });
      window.dispatchEvent(event);
    }
  }, [allGranted]);

  const handleMicrophoneClick = useCallback(async () => {
    if (!(window as any).api || microphoneGranted === 'granted') return;

    console.log('[PermissionPanel] Requesting microphone permission...');

    try {
      const result = await (window as any).api.permissionHeader.checkSystemPermissions();
      console.log('[PermissionPanel] Microphone permission result:', result);

      if (result.microphone === 'granted') {
        setMicrophoneGranted('granted');
        return;
      }

      // 如果权限已经被拒绝，需要打开系统设置
      if (result.microphone === 'denied') {
        console.log('[PermissionPanel] Microphone permission denied, opening system preferences...');
        await (window as any).api.permissionHeader.openSystemPreferences('microphone');
        // 打开系统设置后，延迟检查权限状态
        setTimeout(async () => {
          const updatedResult = await (window as any).api.permissionHeader.checkSystemPermissions();
          if (updatedResult.microphone === 'granted') {
            setMicrophoneGranted('granted');
          }
        }, 1000);
        return;
      }

      // 对于 not-determined、unknown、restricted 状态，尝试请求权限
      if (['not-determined', 'unknown', 'restricted'].includes(result.microphone)) {
        const res = await (window as any).api.permissionHeader.requestMicrophonePermission();
        console.log('[PermissionPanel] Request microphone permission response:', res);
        if (res.status === 'granted' || res.success === true) {
          setMicrophoneGranted('granted');
          return;
        }
        // 如果请求失败，可能是被拒绝了，打开系统设置
        if (res.status === 'denied' || !res.success) {
          console.log('[PermissionPanel] Microphone permission request failed, opening system preferences...');
          await (window as any).api.permissionHeader.openSystemPreferences('microphone');
        }
      }
    } catch (error) {
      console.error('[PermissionPanel] Error requesting microphone permission:', error);
    }
  }, [microphoneGranted]);

  const handleScreenClick = useCallback(async () => {
    if (!(window as any).api || screenGranted === 'granted') return;

    console.log('[PermissionPanel] Checking screen recording permission...');

    try {
      const permissions = await (window as any).api.permissionHeader.checkSystemPermissions();
      console.log('[PermissionPanel] Screen permission check result:', permissions);

      if (permissions.screen === 'granted') {
        setScreenGranted('granted');
        return;
      }

      if (['not-determined', 'denied', 'unknown', 'restricted'].includes(permissions.screen)) {
        console.log('[PermissionPanel] Opening screen recording preferences...');
        await (window as any).api.permissionHeader.openSystemPreferences('screen-recording');
      }
    } catch (error) {
      console.error('[PermissionPanel] Error opening screen recording preferences:', error);
    }
  }, [screenGranted]);

  const handleContinue = useCallback(async () => {
    if ((continueCallback || onComplete) &&
      microphoneGranted === 'granted' &&
      screenGranted === 'granted') {

      if (continueCallback) {
        continueCallback();
      } else if (onComplete) {
        onComplete();
      }
    }
  }, [continueCallback, onComplete, microphoneGranted, screenGranted]);

  const handleClose = useCallback(() => {
    console.log('Close button clicked');
    if (onClose) {
      onClose();
    } else if ((window as any).api) {
      (window as any).api.common.quitApplication();
    }
  }, [onClose]);

  const micGranted = microphoneGranted === 'granted';
  const screenGrantedState = screenGranted === 'granted';

  // 计算容器高度
  let containerHeight = 308;
  if (allGranted) {
    containerHeight += 70;
  }

  return (
    <div
      className="absolute h-[308px] left-1/2 top-[106px] translate-x-[-50%] w-[455px]"
      style={{
        ['-webkit-app-region' as any]: 'drag',
        fontFamily: "'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        userSelect: 'none',
      } as React.CSSProperties}
    >
      {/* 背景 */}
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 455 308">
        <g id="Group 3">
          <g id="Rectangle 1">
            <rect fill="var(--fill-0, #030010)" fillOpacity="0.7" height="308" rx="19" width="455" />
            <rect height="307" rx="18.5" stroke={allGranted ? "var(--stroke-0, #C17FFF)" : "var(--stroke-0, white)"} strokeOpacity="0.2" width="454" x="0.5" y="0.5" />
          </g>
        </g>
      </svg>
      {/* 关闭按钮 */}
      <button
        onClick={handleClose}
        className="absolute left-[425px] top-[12px] size-[20px] cursor-pointer bg-transparent border-none p-0 z-10"
        style={{
          ['-webkit-app-region' as any]: 'no-drag',
        } as React.CSSProperties}
        title="关闭应用"
      >
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 20 20">
          <path d={svgPathsStartup.p3be22e00} fill="var(--fill-0, white)" fillOpacity="0.2" />
        </svg>
      </button>

      {/* Logo */}
      <MuyuLogo
        svgPaths={svgPathsPermission}
        className="absolute h-[25.762px] left-[139px] top-[45px] w-[177px]"
      />

      {/* 说明文字 */}
      <p className="absolute font-['PingFang_SC:Regular',sans-serif] h-[21px] leading-[normal] left-[48px] not-italic text-[15px] text-white top-[88px] w-[360px]">
        请为幕语提词器开启麦克风与屏幕获取权限后开始使用
      </p>

      {/* 麦克风权限 */}
      <div className="absolute left-[35px] top-[152px] flex items-center h-[39px]">
        {/* 麦克风图标 */}
        <div className="size-[35px] flex items-center justify-center">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 35 35">
            <g id="Frame">
              <path d={svgPathsPermission.p28290880} fill="var(--fill-0, white)" fillOpacity="0.8" />
              <path d={svgPathsPermission.p3e227e00} fill="var(--fill-0, white)" fillOpacity="0.8" />
              <path d={svgPathsPermission.p72a380} fill="var(--fill-0, white)" fillOpacity="0.8" />
            </g>
          </svg>
        </div>

        {/* 麦克风文字 */}
        <p className="font-['PingFang_SC:Semibold',sans-serif] leading-[normal] ml-[6px] not-italic text-[18px] text-white">
          麦克风
        </p>

        {/* 麦克风按钮 */}
        <button
          onClick={micGranted ? undefined : handleMicrophoneClick}
          disabled={micGranted}
          className={`absolute h-[39px] left-[276px] rounded-[22px] top-0 w-[109px] flex items-center justify-center border border-solid ${micGranted ? 'cursor-default' : 'cursor-pointer hover:bg-[rgba(193,127,255,0.25)]'
            } transition-colors`}
          style={{
            ['-webkit-app-region' as any]: 'no-drag',
            backgroundColor: 'rgba(193,127,255,0.15)',
            borderColor: micGranted ? 'rgba(193,127,255,0.4)' : '#c17fff'
          } as React.CSSProperties}
        >
          <span
            className="font-['PingFang_SC:Semibold',sans-serif] not-italic text-[15px]"
            style={{
              color: micGranted ? 'rgba(220,185,255,0.4)' : '#dcb9ff'
            }}
          >
            {micGranted ? '已开启' : '开启权限'}
          </span>
        </button>
      </div>

      {/* 屏幕权限 */}
      <div className="absolute left-[35px] top-[216px] flex items-center h-[39px]">
        {/* 屏幕图标 */}
        <div className="w-[35px] h-[35px] flex items-center justify-center">
          <svg className="block w-[20px] h-[20px]" fill="none" preserveAspectRatio="none" viewBox="0 0 20 20">
            <path d={svgPathsPermission.pc2bf780} fill="var(--fill-0, white)" fillOpacity="0.8" />
          </svg>
        </div>

        {/* 屏幕文字 */}
        <p className="font-['PingFang_SC:Semibold',sans-serif] leading-[normal] ml-[6px] not-italic text-[18px] text-white">
          屏幕
        </p>

        {/* 屏幕按钮 */}
        <button
          onClick={screenGrantedState ? undefined : handleScreenClick}
          disabled={screenGrantedState}
          className={`absolute h-[39px] left-[276px] rounded-[22px] top-0 w-[109px] flex items-center justify-center border border-solid ${screenGrantedState ? 'cursor-default' : 'cursor-pointer hover:bg-[rgba(193,127,255,0.25)]'
            } transition-colors`}
          style={{
            ['-webkit-app-region' as any]: 'no-drag',
            backgroundColor: 'rgba(193,127,255,0.15)',
            borderColor: screenGrantedState ? 'rgba(193,127,255,0.4)' : '#c17fff'
          } as React.CSSProperties}
        >
          <span
            className="font-['PingFang_SC:Semibold',sans-serif] not-italic text-[15px]"
            style={{
              color: screenGrantedState ? 'rgba(220,185,255,0.4)' : '#dcb9ff'
            }}
          >
            {screenGrantedState ? '已开启' : '开启权限'}
          </span>
        </button>
      </div>
    </div>
  );
}