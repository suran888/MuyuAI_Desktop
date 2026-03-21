interface Window {
    api: {
        passcode?: {
            verify: (input: string) => Promise<{ success: boolean; error?: string }>;
            getStatus?: () => Promise<{ required: boolean; verified: boolean }>;
            getUserTimeSummary?: () => Promise<any>;
        };
        common?: {
            getCurrentUser: () => Promise<any>;
            quitApplication: () => Promise<void>;
            openExternal: (url: string) => Promise<void>;
            getWebUrl: () => Promise<string>;
            onUserStateChanged: (callback: (event: any, userState: any) => void) => void;
            removeOnUserStateChanged: (callback: (event: any, userState: any) => void) => void;
            onUserTimeSummaryUpdated: (callback: (event: any, payload: any) => void) => void;
            removeOnUserTimeSummaryUpdated: (callback: (event: any, payload: any) => void) => void;
            onWindowSizeChanged?: (callback: (event: any, size: { width: number; height: number }) => void) => void;
            removeOnWindowSizeChanged?: (callback: (event: any, size: { width: number; height: number }) => void) => void;
        };
        headerController?: {
            resizeHeaderWindow?: (dimensions: { width: number; height: number }) => Promise<void>;
            resizeMainWindow?: (params: { edge: string; deltaX: number; deltaY: number; startWidth: number; startHeight: number }) => void;
            clearResizeState?: () => void;
        };
    };
}