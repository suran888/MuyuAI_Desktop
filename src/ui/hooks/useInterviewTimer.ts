import { useState, useEffect, useCallback } from 'react';

function getStoredInterviewStart(): number | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const directValue = Number(window.__interviewStartTimestamp);
  if (Number.isFinite(directValue) && directValue > 0) {
    return directValue;
  }

  try {
    const stored = window.localStorage?.getItem('interviewStartTimestamp');
    const parsed = Number(stored);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  } catch (error) {
    console.warn('[useInterviewTimer] Failed to read interview start time from storage:', error);
  }

  return null;
}

export function useInterviewTimer() {
  const [interviewStartTime, setInterviewStartTime] = useState<number | null>(null);
  const [interviewElapsedSeconds, setInterviewElapsedSeconds] = useState(0);

  const updateInterviewElapsed = useCallback(() => {
    if (!interviewStartTime) {
      setInterviewElapsedSeconds(0);
      return;
    }

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - interviewStartTime) / 1000));
    setInterviewElapsedSeconds(elapsedSeconds);
  }, [interviewStartTime]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleInterviewStarted = (event: CustomEvent) => {
      const timestamp = Number(event?.detail?.startTime);
      if (Number.isFinite(timestamp) && timestamp > 0) {
        setInterviewStartTime(timestamp);
      }
    };

    window.addEventListener('interview-started', handleInterviewStarted as EventListener);

    const storedStart = getStoredInterviewStart();
    if (storedStart) {
      setInterviewStartTime(storedStart);
    }

    return () => {
      window.removeEventListener('interview-started', handleInterviewStarted as EventListener);
    };
  }, []);

  useEffect(() => {
    updateInterviewElapsed();
    const interval = setInterval(updateInterviewElapsed, 1000);
    return () => clearInterval(interval);
  }, [updateInterviewElapsed]);

  return {
    interviewStartTime,
    interviewElapsedSeconds,
  };
}

