import { useState, useCallback, useRef, useEffect } from 'react';

interface Operation {
  id: string;
  promise: Promise<any>;
  startTime: number;
}

interface QueuedOperation {
  id: string;
  type: string;
  operation: () => Promise<any>;
  options: OperationOptions;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  queuedAt: number;
  priority: 'high' | 'normal' | 'low';
}

interface OperationOptions {
  timeout?: number;
  priority?: 'high' | 'normal' | 'low';
}

interface OperationMetrics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  timeouts: number;
  averageResponseTime: number;
}

export function useOperationManager(ipcTimeout = 10000) {
  const activeOperationsRef = useRef<Map<string, Operation>>(new Map());
  const operationTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const operationQueueRef = useRef<QueuedOperation[]>([]);
  
  const [maxConcurrentOperations, setMaxConcurrentOperations] = useState(2);
  const maxQueueSize = 5;
  
  const [operationMetrics, setOperationMetrics] = useState<OperationMetrics>({
    totalOperations: 0,
    successfulOperations: 0,
    failedOperations: 0,
    timeouts: 0,
    averageResponseTime: 0,
  });

  const updateMetrics = useCallback((update: Partial<OperationMetrics>) => {
    setOperationMetrics(prev => ({ ...prev, ...update }));
  }, []);

  const recordSuccess = useCallback((startTime: number) => {
    const responseTime = Date.now() - startTime;
    setOperationMetrics(prev => {
      const successOps = prev.successfulOperations + 1;
      const totalOps = prev.totalOperations;
      const avgTime = (prev.averageResponseTime * (successOps - 1) + responseTime) / successOps;
      
      return {
        ...prev,
        successfulOperations: successOps,
        averageResponseTime: avgTime,
      };
    });
  }, []);

  const recordFailure = useCallback(() => {
    updateMetrics({ failedOperations: operationMetrics.failedOperations + 1 });
  }, [operationMetrics.failedOperations, updateMetrics]);

  const recordTimeout = useCallback(() => {
    updateMetrics({ timeouts: operationMetrics.timeouts + 1 });
  }, [operationMetrics.timeouts, updateMetrics]);

  const cleanupOperation = useCallback((operationId: string, operationType: string) => {
    const timeout = operationTimeoutsRef.current.get(operationId);
    if (timeout) {
      clearTimeout(timeout);
      operationTimeoutsRef.current.delete(operationId);
    }
    activeOperationsRef.current.delete(operationType);
  }, []);

  const processQueue = useCallback(async () => {
    if (operationQueueRef.current.length === 0 || activeOperationsRef.current.size >= maxConcurrentOperations) {
      return;
    }

    const queuedOp = operationQueueRef.current.shift();
    if (!queuedOp) return;

    const queueTime = Date.now() - queuedOp.queuedAt;
    console.log(`[OperationManager] Processing queued operation ${queuedOp.type} (waited ${queueTime}ms)`);

    try {
      const result = await executeImmediately(
        queuedOp.id,
        queuedOp.type,
        queuedOp.operation,
        queuedOp.options.timeout || ipcTimeout
      );
      queuedOp.resolve(result);
    } catch (error) {
      queuedOp.reject(error as Error);
    }
  }, [maxConcurrentOperations, ipcTimeout]);

  const executeImmediately = useCallback(async (
    operationId: string,
    operationType: string,
    operation: () => Promise<any>,
    timeout: number
  ) => {
    const startTime = Date.now();
    updateMetrics({ totalOperations: operationMetrics.totalOperations + 1 });

    // Check if similar operation is already running
    if (activeOperationsRef.current.has(operationType)) {
      console.log(`[OperationManager] Operation ${operationType} already in progress, cancelling previous`);
      cleanupOperation(activeOperationsRef.current.get(operationType)!.id, operationType);
    }

    // Create cancellation mechanism
    const cancellationPromise = new Promise<never>((_, reject) => {
      const timeoutId = setTimeout(() => {
        recordTimeout();
        reject(new Error(`Operation ${operationType} timeout after ${timeout}ms`));
      }, timeout);

      operationTimeoutsRef.current.set(operationId, timeoutId);
    });

    const operationPromise = Promise.race([operation(), cancellationPromise]);

    activeOperationsRef.current.set(operationType, {
      id: operationId,
      promise: operationPromise,
      startTime,
    });

    try {
      const result = await operationPromise;
      recordSuccess(startTime);
      return result;
    } catch (error) {
      recordFailure();
      throw error;
    } finally {
      cleanupOperation(operationId, operationType);
      processQueue();
    }
  }, [operationMetrics.totalOperations, updateMetrics, recordTimeout, recordSuccess, recordFailure, cleanupOperation, processQueue]);

  const executeOperation = useCallback(async (
    operationType: string,
    operation: () => Promise<any>,
    options: OperationOptions = {}
  ) => {
    const operationId = `${operationType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timeout = options.timeout || ipcTimeout;

    // Backpressure control
    if (activeOperationsRef.current.size >= maxConcurrentOperations) {
      if (operationQueueRef.current.length >= maxQueueSize) {
        throw new Error(`Operation queue full (${maxQueueSize}), rejecting ${operationType}`);
      }

      console.log(`[OperationManager] Queuing operation ${operationType} (${activeOperationsRef.current.size} active)`);
      
      return new Promise((resolve, reject) => {
        const queuedOperation: QueuedOperation = {
          id: operationId,
          type: operationType,
          operation,
          options,
          resolve,
          reject,
          queuedAt: Date.now(),
          priority: options.priority || 'normal',
        };

        if (options.priority === 'high') {
          operationQueueRef.current.unshift(queuedOperation);
        } else {
          operationQueueRef.current.push(queuedOperation);
        }
      });
    }

    return executeImmediately(operationId, operationType, operation, timeout);
  }, [ipcTimeout, maxConcurrentOperations, maxQueueSize, executeImmediately]);

  const cancelAllOperations = useCallback(() => {
    console.log(`[OperationManager] Cancelling ${activeOperationsRef.current.size} active operations`);

    // Cancel active operations
    for (const [operationType, operation] of activeOperationsRef.current) {
      cleanupOperation(operation.id, operationType);
    }

    // Cancel queued operations
    for (const queuedOp of operationQueueRef.current) {
      queuedOp.reject(new Error(`Operation ${queuedOp.type} cancelled during cleanup`));
    }
    operationQueueRef.current.length = 0;

    // Clean up all timeouts
    for (const [, timeout] of operationTimeoutsRef.current) {
      clearTimeout(timeout);
    }
    operationTimeoutsRef.current.clear();
  }, [cleanupOperation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAllOperations();
    };
  }, [cancelAllOperations]);

  return {
    executeOperation,
    cancelAllOperations,
    operationMetrics,
    activeOperationCount: activeOperationsRef.current.size,
    queuedOperationCount: operationQueueRef.current.length,
  };
}

