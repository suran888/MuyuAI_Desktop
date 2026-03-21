import { useState, useCallback, useEffect, useRef } from 'react';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'failed' | 'disconnected';

interface HealthCheckConfig {
  enabled: boolean;
  intervalMs: number;
  consecutiveFailures: number;
  maxFailures: number;
  lastCheck: number;
}

export function useConnectionState(initialState: ConnectionState = 'idle') {
  const [connectionState, setConnectionState] = useState<ConnectionState>(initialState);
  const [lastStateChange, setLastStateChange] = useState(Date.now());
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;
  const baseRetryDelay = 1000;

  const healthCheckRef = useRef<HealthCheckConfig>({
    enabled: false,
    intervalMs: 30000,
    consecutiveFailures: 0,
    maxFailures: 3,
    lastCheck: 0,
  });
  const healthIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const updateConnectionState = useCallback((newState: ConnectionState, reason = '') => {
    setConnectionState(prev => {
      if (prev !== newState) {
        console.log(`[ConnectionState] ${prev} -> ${newState} (${reason})`);
        setLastStateChange(Date.now());
        return newState;
      }
      return prev;
    });
  }, []);

  const startHealthMonitoring = useCallback((healthCheckFn: () => Promise<boolean>) => {
    if (healthCheckRef.current.enabled) return;

    healthCheckRef.current.enabled = true;
    
    const performHealthCheck = async () => {
      if (connectionState === 'connecting') return;

      healthCheckRef.current.lastCheck = Date.now();

      try {
        const isHealthy = await healthCheckFn();

        if (isHealthy) {
          healthCheckRef.current.consecutiveFailures = 0;
          if (connectionState === 'failed') {
            updateConnectionState('connected', 'Health check recovered');
          }
        } else {
          healthCheckRef.current.consecutiveFailures++;
          if (healthCheckRef.current.consecutiveFailures >= healthCheckRef.current.maxFailures) {
            updateConnectionState('failed', 'Service health check failed');
          }
        }
      } catch (error) {
        console.warn('[ConnectionState] Health check failed:', error);
        healthCheckRef.current.consecutiveFailures++;
      }
    };

    healthIntervalRef.current = setInterval(performHealthCheck, healthCheckRef.current.intervalMs);
    console.log(`[ConnectionState] Health monitoring started (interval: ${healthCheckRef.current.intervalMs}ms)`);
  }, [connectionState, updateConnectionState]);

  const stopHealthMonitoring = useCallback(() => {
    if (!healthCheckRef.current.enabled) return;

    healthCheckRef.current.enabled = false;
    if (healthIntervalRef.current) {
      clearInterval(healthIntervalRef.current);
      healthIntervalRef.current = null;
    }

    console.log('[ConnectionState] Health monitoring stopped');
  }, []);

  const retryConnection = useCallback(async (connectFn: () => Promise<void>) => {
    if (retryCount >= maxRetries) {
      updateConnectionState('failed', `Connection failed after ${maxRetries} attempts`);
      return;
    }

    const delay = baseRetryDelay * Math.pow(2, retryCount);
    console.log(`[ConnectionState] Retrying connection in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);

    setRetryCount(prev => prev + 1);

    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      await connectFn();
    } catch (error) {
      console.error('[ConnectionState] Retry failed:', error);
      await retryConnection(connectFn);
    }
  }, [retryCount, maxRetries, baseRetryDelay, updateConnectionState]);

  const resetRetryCount = useCallback(() => {
    setRetryCount(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopHealthMonitoring();
    };
  }, [stopHealthMonitoring]);

  return {
    connectionState,
    lastStateChange,
    retryCount,
    updateConnectionState,
    startHealthMonitoring,
    stopHealthMonitoring,
    retryConnection,
    resetRetryCount,
  };
}

