import React, { useState, useEffect, useCallback } from 'react';
import { StartupScreenContainer } from '../components/StartupScreenContainer';
import PermissionPanel from '../components/PermissionPanel';

type StartupStep = 'startup' | 'permission' | 'completed';

export function StartupFlow() {
    const [currentStep, setCurrentStep] = useState<StartupStep>('startup');
    const [passcodeVerified, setPasscodeVerified] = useState(false);

    // Resize Helpers
    const resizeWindow = useCallback((width: number, height: number) => {
        if (!(window as any).api?.headerController?.resizeHeaderWindow) return;
        console.log(`[StartupFlow] Resizing to ${width}x${height}`);
        return (window as any).api.headerController.resizeHeaderWindow({ width, height }).catch(console.error);
    }, []);

    // Transitions
    const showStartup = useCallback(() => {
        resizeWindow(456, 364);
        setCurrentStep('startup');
    }, [resizeWindow]);

    const showPermission = useCallback((height = 430) => {
        resizeWindow(710, height);
        setCurrentStep('permission');
        // Notify main process we are in permission state
        (window as any).api?.headerController?.sendHeaderStateChanged('permission');
    }, [resizeWindow]);

    const completeStartup = useCallback(async () => {
        console.log('[StartupFlow] Startup completed. Transitioning to Main View.');
        setCurrentStep('completed');
        // Resize to "main" size before hiding (keeps legacy behavior consistent)
        await resizeWindow(524, 393);
        // Notify main process to switch windows
        (window as any).api?.headerController?.sendHeaderStateChanged('main');
    }, [resizeWindow]);

    // Core Logic: Check Permissions
    const checkPermissionsAndProceed = useCallback(async () => {
        if (!(window as any).api) return;

        try {
            const permissions = await (window as any).api.headerController?.checkSystemPermissions();
            console.log('[StartupFlow] Permissions:', permissions);

            if (permissions && !permissions.needsSetup) {
                // All good
                await completeStartup();
            } else {
                // Needs permission
                let height = 430;
                try {
                    const userState = await (window as any).api.common?.getCurrentUser();
                    if (userState?.mode === 'interview') height = 520;
                } catch (e) { /* ignore */ }
                
                showPermission(height);
            }
        } catch (e) {
            console.error('[StartupFlow] Permission check failed', e);
            showPermission(); // Fallback
        }
    }, [showPermission, completeStartup]);

    // Core Logic: Check Passcode & User State
    const checkInitialState = useCallback(async () => {
        if (!(window as any).api) {
            console.log('[StartupFlow] No API, showing startup');
            showStartup();
            return;
        }

        try {
            console.log('[StartupFlow] Checking initial state...');
            // 1. Check Passcode
            let isPasscodeLocked = false;
            if ((window as any).api.passcode) {
                const status = await (window as any).api.passcode.getStatus();
                isPasscodeLocked = status?.required && !status?.verified;
            }

            // 2. Check User State (Login)
            const userState = await (window as any).api.common?.getCurrentUser();
            
            if (!isPasscodeLocked && userState) {
                // Already ready, check permissions
                console.log('[StartupFlow] Already unlocked and logged in.');
                setPasscodeVerified(true);
                await checkPermissionsAndProceed();
            } else {
                // Need login or passcode
                console.log('[StartupFlow] Locked or not logged in, showing startup screen.');
                showStartup();
            }
        } catch (e) {
            console.error('[StartupFlow] Initial check failed', e);
            showStartup();
        }
    }, [showStartup, checkPermissionsAndProceed]);

    // Handlers
    const handlePasscodeVerified = async () => {
        console.log('[StartupFlow] Passcode verified.');
        setPasscodeVerified(true);
        // After passcode, check permissions
        await checkPermissionsAndProceed();
    };

    const handlePermissionGranted = async () => {
        console.log('[StartupFlow] Permission granted.');
        // Re-init model state if needed
        if ((window as any).api?.headerController) {
            await (window as any).api.headerController.reInitializeModelState();
        }
        await completeStartup();
    };

    // Bootstrap
    useEffect(() => {
        checkInitialState();
        
        // Listen for resize requests (legacy permission panel behavior)
        const handleRequestResize = (e: CustomEvent) => {
             if (e.detail?.height && currentStep === 'permission') {
                 resizeWindow(710, e.detail.height);
             }
        };
        window.addEventListener('request-resize', handleRequestResize as EventListener);
        return () => window.removeEventListener('request-resize', handleRequestResize as EventListener);
    }, []); // Run once

    // Render
    return (
        <>
            {currentStep === 'startup' && (
                <StartupScreenContainer
                    passcodeRequired={true}
                    passcodeVerified={passcodeVerified}
                    onPasscodeVerified={handlePasscodeVerified}
                />
            )}
            {currentStep === 'permission' && (
                <PermissionPanel
                    continueCallback={handlePermissionGranted}
                    onClose={() => (window as any).api?.common?.quitApplication()}
                />
            )}
        </>
    );
}
