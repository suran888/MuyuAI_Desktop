import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useWindowDrag, useSessionState, useIpcListener } from '../hooks';
import { MainInterface } from './MainInterface';
import type { Shortcuts, Turn } from '../types';

export function MainInterfaceContainer() {
  // Core hooks
  const { handleMouseDown, wasJustDragged } = useWindowDrag();
  const { listenSessionStatus, isTogglingSession, toggleSession } = useSessionState();

  // UI State adapted for MainInterface
  const [activePanel, setActivePanel] = useState<'input' | 'screenshot' | 'history' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showScreenshotAnswer, setShowScreenshotAnswer] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [inputHistory, setInputHistory] = useState<{ question: string; answer: string }[]>([]);
  const [inputAnswer, setInputAnswer] = useState("");
  const [isAnswering, setIsAnswering] = useState(false);

  // Window size state - 监听窗口大小变化
  const [windowSize, setWindowSize] = useState({ width: 524, height: 393 });

  // Screenshot state
  const [screenshotAnswer, setScreenshotAnswer] = useState("");
  const [isScreenshotLoading, setIsScreenshotLoading] = useState(false);

  // Turns state
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnMapRef = useRef<Map<string, Turn>>(new Map());
  const turnIdPrefixRef = useRef(0);

  const sortTurns = useCallback(() => {
    const values = Array.from(turnMapRef.current.values()) as Turn[];
    const filtered = values.filter((turn: Turn) => turn.question && turn.question.trim().length > 0);
    const sorted = filtered.sort((a: Turn, b: Turn) => {
      // 首先按 startedAt 排序，如果相同则按 id 排序确保稳定性
      const timeDiff = a.startedAt - b.startedAt;
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });
    console.log('[MainInterfaceContainer] sortTurns - total in map:', values.length, 'filtered:', filtered.length, 'ids:', sorted.map(t => t.id));
    return sorted;
  }, []);

  const handleTurnReset = useCallback(() => {
    // 用户要求停止 Listen 后保留历史记录，因此不再清空 turns
    // 增加 ID 前缀计数，确保新会话的 turn ID (如 turn-1) 不会覆盖旧会话的同名 ID，从而实现追加效果
    turnIdPrefixRef.current += 1;
    console.log('[MainInterfaceContainer] Turn state reset received. Keeping history, incremented ID prefix to:', turnIdPrefixRef.current);
  }, []);

  const handleTurnUpdate = useCallback((event: any, payload: any) => {
    if (!payload) return;

    // 构造带前缀的唯一 ID，防止不同 Session 间的 ID 冲突
    const uniqueId = `${payload.id}_${turnIdPrefixRef.current}`;
    
    console.log('[MainInterfaceContainer] handleTurnUpdate - payload.id:', payload.id, 'uniqueId:', uniqueId, 'event:', payload.event, 'status:', payload.status);
    console.log('[MainInterfaceContainer] handleTurnUpdate - payload.text:', payload.text?.slice(0, 50));

    const existing = turnMapRef.current.get(uniqueId) || {
      id: uniqueId,
      speaker: payload.speaker,
      question: '',
      answer: '',
      status: 'in_progress' as const,
      updatedAt: payload.timestamp || Date.now(),
      startedAt: payload.startedAt || payload.timestamp || Date.now(),
    };

    // 更新 speaker 信息（如果之前没有或有更新）
    if (payload.speaker) {
      existing.speaker = payload.speaker;
    }

    if (payload.text) {
      existing.question = payload.text.trim();
    }
    if (payload.event === 'finalized' || payload.status === 'completed') {
      existing.status = 'completed';
    } else {
      existing.status = 'in_progress';
    }
    existing.updatedAt = payload.timestamp || Date.now();

    turnMapRef.current.set(uniqueId, existing);
    const newTurns = sortTurns();
    console.log('[MainInterfaceContainer] handleTurnUpdate - new turns length:', newTurns.length);
    setTurns(newTurns);
  }, [sortTurns]);

  const handleLiveAnswer = useCallback((event: any, payload: any) => {
    if (!payload || !payload.turnId) return;

    // 使用当前前缀查找 Turn
    const uniqueId = `${payload.turnId}_${turnIdPrefixRef.current}`;

    const existing = turnMapRef.current.get(uniqueId);
    if (!existing) {
      console.log('[MainInterfaceContainer] handleLiveAnswer - turn not found:', uniqueId);
      return;
    }

    console.log('[MainInterfaceContainer] handleLiveAnswer - turnId:', payload.turnId, 'hasAnswer:', payload.answer !== undefined, 'hasToken:', !!payload.token, 'status:', payload.status);

    if (payload.answer !== undefined) {
      existing.answer = payload.answer;
    } else if (payload.token) {
      existing.answer = (existing.answer || '') + payload.token;
    }

    if (payload.status) {
      if (['completed', 'error', 'aborted'].includes(payload.status)) {
        existing.status = payload.status;
      } else if (['streaming', 'started'].includes(payload.status)) {
        existing.status = 'in_progress';
      }
    }

    existing.updatedAt = Date.now();
    turnMapRef.current.set(uniqueId, existing);
    const newTurns = sortTurns();
    setTurns(newTurns);
  }, [sortTurns]);

  // Input panel stream listener
  useEffect(() => {
    const handleInputPanelStream = (event: any, payload: any) => {
      if (payload.status === 'start') {
        setIsAnswering(true);
      } else if (payload.text) {
        setInputHistory(prev => {
          if (prev.length === 0) return prev;
          const newHistory = [...prev];
          const lastIndex = newHistory.length - 1;
          newHistory[lastIndex] = {
            ...newHistory[lastIndex],
            answer: payload.text
          };
          return newHistory;
        });
      }

      if (['completed', 'error'].includes(payload.status)) {
        setIsAnswering(false);
      }
    };

    if (window.api?.askView?.onInputPanelStream) {
      window.api.askView.onInputPanelStream(handleInputPanelStream);
    }

    return () => {
      if (window.api?.askView?.removeOnInputPanelStream) {
        window.api.askView.removeOnInputPanelStream(handleInputPanelStream);
      }
    };
  }, []);

  // Screenshot state listener
  useEffect(() => {
    const handleScreenshotStateUpdate = (event: any, payload: any) => {
      console.log('[MainInterfaceContainer] Screenshot state update:', payload);

      if (payload.isLoading) {
        setIsScreenshotLoading(true);
        // 仅当没有提供 currentResponse 时才清空，意味着这是一个新的开始
        // 如果是流式传输中途发送 isLoading: true（虽然不常见），我们不应清除已有内容
        if (payload.currentResponse === undefined || payload.currentResponse === null) {
          setScreenshotAnswer("");
        }
      } else {
        // 如果明确收到 isLoading: false，或者 payload 中没有 isLoading (通常流式更新不带 isLoading)
        // 我们假设只要有内容更新，或者 explicitly false，就不是 loading 状态了
        // 但为了保险，我们只在显式 false 时设为 false，或者在流式传输中
        if (payload.isLoading === false || payload.isStreaming) {
          setIsScreenshotLoading(false);
        }
      }

      if (payload.currentResponse !== undefined && payload.currentResponse !== null) {
        setScreenshotAnswer(payload.currentResponse);
      }
    };

    const handleScreenshotError = (event: any, payload: any) => {
      console.error('[MainInterfaceContainer] Screenshot error:', payload);
      setIsScreenshotLoading(false);
      setScreenshotAnswer(`错误: ${payload.error || '截图分析失败'}`);
    };

    if (window.api?.screenshotView?.onStateUpdate) {
      window.api.screenshotView.onStateUpdate(handleScreenshotStateUpdate);
    }

    if (window.api?.screenshotView?.onStreamError) {
      window.api.screenshotView.onStreamError(handleScreenshotError);
    }

    return () => {
      if (window.api?.screenshotView?.removeOnStateUpdate) {
        window.api.screenshotView.removeOnStateUpdate(handleScreenshotStateUpdate);
      }
      if (window.api?.screenshotView?.removeOnStreamError) {
        window.api.screenshotView.removeOnStreamError(handleScreenshotError);
      }
    };
  }, []);

  // Register listeners
  useEffect(() => {
    if (!window.api.liveInsights) return;

    window.api.liveInsights.onTurnUpdate(handleTurnUpdate);
    window.api.liveInsights.onLiveAnswer(handleLiveAnswer);
    window.api.liveInsights.onTurnStateReset(handleTurnReset);

    // Initial fetch
    window.api.liveInsights.getTurnState?.().then(state => {
      if (!state) return;
      const newTurns: Turn[] = [];

      // 初始加载时也应用当前前缀 (通常为0)
      const prefix = turnIdPrefixRef.current;

      for (const entry of state.activeTurns || []) {
        const uniqueId = `${entry.id}_${prefix}`;
        const turn: Turn = {
          id: uniqueId,
          speaker: entry.speaker,
          question: entry.partialText || entry.finalText || '',
          answer: '',
          status: entry.status || 'in_progress',
          updatedAt: entry.updatedAt || Date.now(),
          startedAt: entry.startedAt || Date.now(),
        };
        turnMapRef.current.set(turn.id, turn);
        newTurns.push(turn);
      }

      for (const entry of state.turnHistory || []) {
        const uniqueId = `${entry.id}_${prefix}`;
        const turn: Turn = {
          id: uniqueId,
          speaker: entry.speaker,
          question: entry.finalText || entry.partialText || '',
          answer: '',
          status: entry.status || 'completed',
          updatedAt: entry.completedAt || entry.updatedAt || Date.now(),
          startedAt: entry.startedAt || Date.now(),
        };
        turnMapRef.current.set(turn.id, turn);
        newTurns.push(turn);
      }

      if (newTurns.length > 0) {
        setTurns(sortTurns());
      }
    }).catch(() => { });

    return () => {
      window.api.liveInsights?.removeOnTurnUpdate(handleTurnUpdate);
      window.api.liveInsights?.removeOnLiveAnswer(handleLiveAnswer);
      window.api.liveInsights?.removeOnTurnStateReset(handleTurnReset);
    };
  }, [handleTurnUpdate, handleLiveAnswer, handleTurnReset, sortTurns]);

  // Additional state from original MainView
  const [shortcuts, setShortcuts] = useState({} as Shortcuts);
  // 当前后端返回的「有效剩余时长（秒）」；完全以 summary / heartbeat 结果为准
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  // Refs
  const prevPanelOpen = useRef(false);
  const prevActivePanel = useRef<'input' | 'screenshot' | 'history' | null>(null);
  const prevShowSettings = useRef(false);
  const isPanelStateInitialized = useRef(false);

  // Shortcuts listener
  const handleShortcutsUpdate = useCallback((event: any, keybinds: Shortcuts) => {
    console.log('[MainView] Received updated shortcuts:', keybinds);
    setShortcuts(keybinds);
  }, []);

  useIpcListener(
    window.api.mainHeader.onShortcutsUpdated,
    window.api.mainHeader.removeOnShortcutsUpdated,
    handleShortcutsUpdate,
    [handleShortcutsUpdate]
  );

  // 初次渲染时，从 /api/v1/user-time-account/summary 获取当前剩余时长（秒）
  useEffect(() => {
    let isCancelled = false;

    const fetchSummary = async () => {
      try {
        const passcodeApi = (window as any).api?.passcode;
        if (!passcodeApi?.getUserTimeSummary) return;

        const result = await passcodeApi.getUserTimeSummary();
        const seconds = typeof result?.effectiveRemainingSeconds === 'number'
          ? result.effectiveRemainingSeconds
          : result?.remainingSeconds;
        if (!isCancelled && result?.success && typeof seconds === 'number') {
          setRemainingSeconds(seconds);
        }
      } catch (error) {
        // 安静失败，避免影响主流程
        console.warn('[MainInterfaceContainer] Failed to fetch user time summary:', error);
      }
    };

    // 首屏立即拉一次
    fetchSummary();

    return () => {
      isCancelled = true;
    };
  }, []);

  // 监听主进程通过 heartbeat+summary 推送的剩余时长更新
  useIpcListener(
    (window as any).api?.common?.onUserTimeSummaryUpdated,
    (window as any).api?.common?.removeOnUserTimeSummaryUpdated,
    useCallback((event: any, payload: any) => {
      if (!payload) return;
      const seconds = typeof payload.effectiveRemainingSeconds === 'number'
        ? payload.effectiveRemainingSeconds
        : payload.remainingSeconds;
      if (typeof seconds === 'number') {
        console.log('[MainInterfaceContainer] Received user-time-summary-updated:', payload);
        setRemainingSeconds(seconds);
      }
    }, []),
    []
  );

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      const newSize = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
      console.log('[MainInterfaceContainer] Window resize event:', newSize);
      setWindowSize(newSize);
    };

    // 初始设置 - 使用初始值而不是读取实际窗口大小，避免影响初始高度
    // 只在后续的 resize 事件中才读取实际窗口大小
    setWindowSize({ width: 524, height: 393 });

    // 监听窗口大小变化
    window.addEventListener('resize', handleResize);

    // 监听 IPC 事件通知的窗口大小变化（当通过 resizeMainWindow 调整时）
    const handleIpcResize = (event: any, size: { width: number; height: number }) => {
      console.log('[MainInterfaceContainer] Window size changed via IPC:', size);
      setWindowSize(size);
    };

    // 使用 Electron IPC 监听窗口大小变化
    if ((window as any).api?.common?.onWindowSizeChanged) {
      (window as any).api.common.onWindowSizeChanged(handleIpcResize);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if ((window as any).api?.common?.removeOnWindowSizeChanged) {
        (window as any).api.common.removeOnWindowSizeChanged(handleIpcResize);
      }
    };
  }, []);

  // 当面板状态变化时，调整窗口大小
  useEffect(() => {
    const isPanelOpen = !!(activePanel || showSettings);
    const wasPanelOpen = prevPanelOpen.current;
    const wasActivePanel = prevActivePanel.current;
    const wasShowSettings = prevShowSettings.current;

    // 跳过初始渲染，避免影响初始窗口高度
    if (!isPanelStateInitialized.current) {
      isPanelStateInitialized.current = true;
      prevPanelOpen.current = isPanelOpen;
      prevActivePanel.current = activePanel;
      prevShowSettings.current = showSettings;
      return;
    }

    // 只在面板状态实际变化时才调整窗口大小
    if (wasPanelOpen === isPanelOpen && wasActivePanel === activePanel && wasShowSettings === showSettings) {
      return;
    }

    // 直接从 DOM 获取当前窗口宽度，确保是最新的
    const currentWidth = window.innerWidth;
    
    // 计算当前左侧宽度（基于当前窗口宽度和之前的面板状态）
    let leftWidth: number;
    if (wasPanelOpen) {
      // 之前面板是打开的，从当前宽度减去之前的面板宽度得到左侧宽度
      if (wasActivePanel) {
        leftWidth = currentWidth - 458 - 6;
      } else if (wasShowSettings) {
        leftWidth = currentWidth - 298 - 6;
      } else {
        leftWidth = currentWidth;
      }
    } else {
      // 之前面板是关闭的，当前宽度就是左侧宽度
      leftWidth = currentWidth;
    }

    const MIN_LEFT_WIDTH = 400;
    const effectiveLeftWidth = Math.max(MIN_LEFT_WIDTH, leftWidth);

    // 计算新的窗口宽度
    let newWidth: number;
    if (isPanelOpen) {
      if (activePanel) {
        newWidth = effectiveLeftWidth + 458 + 6;
      } else if (showSettings) {
        newWidth = effectiveLeftWidth + 298 + 6;
      } else {
        newWidth = effectiveLeftWidth;
      }
    } else {
      newWidth = effectiveLeftWidth;
    }

    const minWidth = isPanelOpen
      ? effectiveLeftWidth + (showSettings ? 298 : 458) + 6
      : 524;

    // 获取当前窗口高度
    const height = window.innerHeight || 393;

    console.log('[MainInterfaceContainer] Panel state changed:', { 
      currentWidth, leftWidth, newWidth, 
      wasPanelOpen, isPanelOpen, 
      wasActivePanel, activePanel 
    });

    if (window.api?.headerController?.resizeHeaderWindow) {
      window.api.headerController.resizeHeaderWindow({ width: newWidth, height, minWidth }).catch(console.error);
    }

    // 更新之前的状态
    prevPanelOpen.current = isPanelOpen;
    prevActivePanel.current = activePanel;
    prevShowSettings.current = showSettings;
  }, [activePanel, showSettings]); // 不依赖 windowSize，避免循环触发

  // 这个 useEffect 已被移除，因为：
  // 1. 最小宽度限制已经在 windowManager.js 的 resizeHeaderWindow 中强制执行
  // 2. 面板切换时的宽度计算已经在上面的 useEffect 中正确处理
  // 3. 这个 useEffect 会在面板状态变化时使用旧的 windowSize 导致错误的宽度计算

  // Handlers adapted for MainInterface
  const handleToggleRecording = useCallback(() => {
    toggleSession();
  }, [toggleSession]);

  const handleToggleSettings = useCallback(() => {
    if (!showSettings) {
      setActivePanel(null);
      setShowScreenshotAnswer(false);
    }
    setShowSettings(!showSettings);
  }, [showSettings]);

  const handleToggleInputPanel = useCallback(() => {
    if (activePanel === 'input') {
      setActivePanel(null);
    } else {
      setActivePanel('input');
      setShowSettings(false); // 关闭 settings 面板
      setShowScreenshotAnswer(false);
    }
  }, [activePanel]);

  const handleToggleScreenshotPanel = useCallback(() => {
    if (activePanel === 'screenshot') {
      setActivePanel(null);
      setShowScreenshotAnswer(false);
    } else {
      setActivePanel('screenshot');
      setShowSettings(false); // 关闭 settings 面板
      setShowScreenshotAnswer(false);
    }
  }, [activePanel]);

  const handleToggleHistoryPanel = useCallback(() => {
    if (activePanel === 'history') {
      setActivePanel(null);
    } else {
      setActivePanel('history');
      setShowSettings(false); // 关闭 settings 面板
    }
  }, [activePanel]);

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
  }, []);

  const handleSend = useCallback(async () => {
    if (inputValue.trim()) {
      const question = inputValue.trim();
      console.log('[MainView] Sending input:', question);

      // Add to history immediately
      setInputHistory(prev => [...prev, { question, answer: '' }]);
      setInputValue("");
      setIsAnswering(true);

      if (window.api?.askView?.sendQuestionFromInputPanel) {
        await window.api.askView.sendQuestionFromInputPanel(question);
      } else if (window.api?.listenCapture?.sendManualInput) {
        await window.api.listenCapture.sendManualInput(question, 'Them');
      }
    }
  }, [inputValue]);

  const handleScreenshotAnswer = useCallback(async () => {
    if (wasJustDragged) return;

    try {
      console.log('[MainInterfaceContainer] Starting screenshot analysis...');
      setIsScreenshotLoading(true);
      setScreenshotAnswer("");
      setShowScreenshotAnswer(true);

      // Trigger screenshot capture, upload, and analysis
      if (window.api?.screenshotView?.analyze) {
        await window.api.screenshotView.analyze();
      }
    } catch (error) {
      console.error('[MainInterfaceContainer] Screenshot analysis error:', error);
      setIsScreenshotLoading(false);
      setScreenshotAnswer(`错误: ${error instanceof Error ? error.message : '截图分析失败'}`);
    }
  }, [wasJustDragged]);

  const handleHideWindow = useCallback(async () => {
    if (wasJustDragged) return;
    try {
      if (window.api?.mainHeader?.sendToggleAllWindowsVisibility) {
        await window.api.mainHeader.sendToggleAllWindowsVisibility();
      }
    } catch (error) {
      console.error('IPC invoke for all windows visibility button failed:', error);
    }
  }, [wasJustDragged]);

  const handleExitInterview = useCallback(() => {
    if (window.api?.common?.quitApplication) {
      window.api.common.quitApplication();
    }
  }, []);


  // 计算剩余面试时长（分钟）——完全使用后端 remainingSeconds，不做本地倒计时推算
  const remainingMinutes = remainingSeconds > 0
    ? Math.max(0, Math.ceil(remainingSeconds / 60))
    : null;

  return (
    <MainInterface
      activePanel={activePanel}
      showSettings={showSettings}
      showScreenshotAnswer={showScreenshotAnswer}
      remainingMinutes={remainingMinutes}
      inputValue={inputValue}
      inputHistory={inputHistory}
      isAnswering={isAnswering}
      screenshotAnswer={screenshotAnswer}
      isScreenshotLoading={isScreenshotLoading}
      isRecording={listenSessionStatus === 'inSession'}
      position={{ x: 0, y: 0 }}
      isDragging={false}
      windowSize={windowSize}
      onMouseDown={handleMouseDown}
      onMouseMove={() => { }}
      onMouseUp={() => { }}
      onToggleSettings={handleToggleSettings}
      onToggleRecording={handleToggleRecording}
      onToggleInputPanel={handleToggleInputPanel}
      onToggleScreenshotPanel={handleToggleScreenshotPanel}
      onToggleHistoryPanel={handleToggleHistoryPanel}
      onInputChange={handleInputChange}
      onSend={handleSend}
      onScreenshotAnswer={handleScreenshotAnswer}
      onExitInterview={handleExitInterview}
      onHideWindow={handleHideWindow}
      turns={turns}
    />
  );
}
