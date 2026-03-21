import { useState, useCallback } from 'react';
import type { ListenSessionStatus } from '../types';
import { useIpcListener } from './useIpcListener';

export function useSessionState() {
  const [listenSessionStatus, setListenSessionStatus] = useState<ListenSessionStatus>('beforeSession');
  const [isTogglingSession, setIsTogglingSession] = useState(false);

  const getListenButtonText = useCallback((status: ListenSessionStatus) => {
    switch (status) {
      case 'beforeSession': return 'Listen';
      case 'inSession': return 'Stop';
      case 'afterSession': return 'Done';
      default: return 'Listen';
    }
  }, []);

  const handleSessionResult = useCallback((event: any, { success }: { success: boolean }) => {
    console.log('[useSessionState] Session state update received:', { success, currentStatus: listenSessionStatus });
    // 状态在 toggleSession 里已做 optimistic update。
    // 这里 success 时不再“推进一次”，避免出现状态错位；失败时回滚。
    if (!success) {
      setListenSessionStatus('beforeSession');
    }
    setIsTogglingSession(false);
  }, [listenSessionStatus]);

  useIpcListener(
    window.api.mainHeader.onListenChangeSessionResult,
    window.api.mainHeader.removeOnListenChangeSessionResult,
    handleSessionResult,
    [handleSessionResult]
  );

  const toggleSession = useCallback(async () => {
    if (isTogglingSession) return;

    setIsTogglingSession(true);

    try {
      // 这个 UI 按钮表现为“开始/停止收音”的二态开关：
      // - inSession -> Stop
      // - beforeSession / afterSession -> Listen
      const isStoppingRecording = listenSessionStatus === 'inSession';
      const isStartingRecording = !isStoppingRecording;
      const listenButtonText = isStoppingRecording ? 'Stop' : 'Listen';

      // Optimistic update for instant UI feedback
      const nextStatus: ListenSessionStatus = isStoppingRecording ? 'afterSession' : 'inSession';

      setListenSessionStatus(nextStatus);
      console.log('[useSessionState] Optimistic status update:', listenSessionStatus, '→', nextStatus);

      if (window.api) {
        const result = await window.api.mainHeader.sendListenButtonClick(listenButtonText);
        const success = typeof (result as any)?.success === 'boolean' ? (result as any).success : true;
        if (!success) {
          setListenSessionStatus('beforeSession');
          return;
        }

        // 开始收音时启动心跳上报
        if (isStartingRecording) {
          console.log('[useSessionState] Starting recording heartbeat...');
          (window as any).api?.passcode?.startRecordingHeartbeat?.();
        }

        // 停止收音时停止心跳上报
        if (isStoppingRecording) {
          console.log('[useSessionState] Stopping recording heartbeat...');
          (window as any).api?.passcode?.stopRecordingHeartbeat?.();
        }
      }
    } catch (error) {
      console.error('IPC invoke for session change failed:', error);
      // On error, rollback and allow retry
      setListenSessionStatus('beforeSession');
    } finally {
      setIsTogglingSession(false);
    }
  }, [isTogglingSession, listenSessionStatus, getListenButtonText]);

  return {
    listenSessionStatus,
    isTogglingSession,
    toggleSession,
    getListenButtonText,
  };
}

