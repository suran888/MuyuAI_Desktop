import { useEffect } from 'react';

type IpcCallback = (...args: any[]) => void;

export function useIpcListener(
  register: (callback: IpcCallback) => void,
  unregister: (callback: IpcCallback) => void,
  callback: IpcCallback,
  dependencies: any[] = []
) {
  useEffect(() => {
    register(callback);
    return () => {
      unregister(callback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
}

