try {
    if (process.env.ENABLE_ELECTRON_RELOAD !== 'false') {
        const reloader = require('electron-reloader');
        reloader(module, {
            watchRenderer: true,
        });
    }
} catch (err) {
}

const path = require('path');
const { app } = require('electron');
const fs = require('fs');
const { loadEnvironment } = require('./features/common/config/constants');

// Load environment variables based on NODE_ENV and packaged state
const envPath = loadEnvironment(app);
const nodeEnv = process.env.NODE_ENV || 'production';
const envFile = nodeEnv === 'production' ? '.env.production' : '.env';

if (fs.existsSync(envPath)) {
    console.log(`[Config] Loading environment from: ${envFile} (NODE_ENV: ${nodeEnv})`);
} else {
    console.log(`[Config] Using ${nodeEnv} defaults (.env file not found)`);
}

if (require('electron-squirrel-startup')) {
    process.exit(0);
}

const { BrowserWindow, shell, ipcMain, dialog, desktopCapturer, session } = require('electron');
const { createWindows } = require('./window/windowManager.js');
const listenService = require('./features/listen/listenService');

const databaseInitializer = require('./features/common/services/databaseInitializer');
const authService = require('./features/common/services/authService');
const fetch = require('node-fetch');
const { autoUpdater } = require('electron-updater');
const { EventEmitter } = require('events');
const askService = require('./features/ask/askService');
const settingsService = require('./features/settings/settingsService');
const sessionRepository = require('./features/common/repositories/session');
const modelStateService = require('./features/common/services/modelStateService');
const featureBridge = require('./bridge/featureBridge');
const windowBridge = require('./bridge/windowBridge');

// Global variables
const eventBridge = new EventEmitter();
let isShuttingDown = false; // Flag to prevent infinite shutdown loop

console.log('>>> [DEBUG] Starting index.js execution');

//////// after_modelStateService ////////
global.modelStateService = modelStateService;
//////// after_modelStateService ////////

// Import and initialize OllamaService
console.log('>>> [DEBUG] Requiring ollamaService');
const ollamaService = require('./features/common/services/ollamaService');
console.log('>>> [DEBUG] Requiring ollamaModelRepository');
const ollamaModelRepository = require('./features/common/repositories/ollamaModel');
console.log('>>> [DEBUG] Requires complete');

// Native deep link handling - cross-platform compatible
// Protocol handling removed as per request




function focusMainWindow() {
    const { windowPool } = require('./window/windowManager.js');
    if (windowPool) {
        const header = windowPool.get('header');
        if (header && !header.isDestroyed()) {
            if (header.isMinimized()) header.restore();
            header.focus();
            return true;
        }
    }

    // Fallback: focus any available window
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        const mainWindow = windows[0];
        if (!mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
            return true;
        }
    }

    return false;
}



const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
    process.exit(0);
}

// setup protocol after single instance lock
// setupProtocolHandling(); // Removed

console.log('>>> [DEBUG] Waiting for app.whenReady()');
app.whenReady().then(async () => {
    console.log('>>> [DEBUG] app.whenReady() fired');

    // Setup native loopback audio capture for Windows
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
            // Grant access to the first screen found with loopback audio
            callback({ video: sources[0], audio: 'loopback' });
        }).catch((error) => {
            console.error('Failed to get desktop capturer sources:', error);
            callback({});
        });
    });

    // Initialize core services

    try {
        await databaseInitializer.initialize();
        console.log('>>> [index.js] Database initialized successfully');

        // Clean up zombie sessions from previous runs first - MOVED TO authService
        // sessionRepository.endAllActiveSessions();

        await authService.initialize();

        //////// after_modelStateService ////////
        await modelStateService.initialize();
        //////// after_modelStateService ////////

        featureBridge.initialize();  // Added: initialize featureBridge
        windowBridge.initialize();
        setupWebDataHandlers();

        // Initialize Ollama models in database
        await ollamaModelRepository.initializeDefaultModels();

        // Auto warm-up selected Ollama model in background (non-blocking)
        setTimeout(async () => {
            try {
                console.log('[index.js] Starting background Ollama model warm-up...');
                await ollamaService.autoWarmUpSelectedModel();
            } catch (error) {
                console.log('[index.js] Background warm-up failed (non-critical):', error.message);
            }
        }, 2000); // Wait 2 seconds after app start

        // Start web server and create windows ONLY after all initializations are successful
        console.log('All services initialized successfully');

        console.log('[index.js] Creating windows...');
        createWindows();
        console.log('[index.js] Windows creation completed');

    } catch (err) {
        console.error('>>> [index.js] Database initialization failed - some features may not work', err);
        // Optionally, show an error dialog to the user
        dialog.showErrorBox(
            'Application Error',
            'A critical error occurred during startup. Some features might be disabled. Please restart the application.'
        );
    }

    // initAutoUpdater should be called after auth is initialized
    initAutoUpdater();

    // Process any pending deep link after everything is initialized
    // if (pendingDeepLinkUrl) {
    //     console.log('[Protocol] Processing pending URL:', pendingDeepLinkUrl);
    //     handleCustomUrl(pendingDeepLinkUrl);
    //     pendingDeepLinkUrl = null;
    // }
});

app.on('before-quit', async (event) => {
    // Prevent infinite loop by checking if shutdown is already in progress
    if (isShuttingDown) {
        console.log('[Shutdown] 🔄 Shutdown already in progress, allowing quit...');
        return;
    }

    console.log('[Shutdown] App is about to quit. Starting graceful shutdown...');

    // Set shutdown flag to prevent infinite loop
    isShuttingDown = true;

    // Prevent immediate quit to allow graceful shutdown
    event.preventDefault();

    try {
        // 1. Stop audio capture first (immediate)
        await listenService.closeSession();
        console.log('[Shutdown] Audio capture stopped');

        // 2. End all active sessions (database operations) - with error handling
        try {
            await sessionRepository.endAllActiveSessions();
            console.log('[Shutdown] Active sessions ended');
        } catch (dbError) {
            console.warn('[Shutdown] Could not end active sessions (database may be closed):', dbError.message);
        }

        // 3. Shutdown Ollama service (potentially time-consuming)
        console.log('[Shutdown] shutting down Ollama service...');
        const ollamaShutdownSuccess = await Promise.race([
            ollamaService.shutdown(false), // Graceful shutdown
            new Promise(resolve => setTimeout(() => resolve(false), 8000)) // 8s timeout
        ]);

        if (ollamaShutdownSuccess) {
            console.log('[Shutdown] Ollama service shut down gracefully');
        } else {
            console.log('[Shutdown] Ollama shutdown timeout, forcing...');
            // Force shutdown if graceful failed
            try {
                await ollamaService.shutdown(true);
            } catch (forceShutdownError) {
                console.warn('[Shutdown] Force shutdown also failed:', forceShutdownError.message);
            }
        }

        // 4. Close database connections (final cleanup)
        try {
            databaseInitializer.close();
            console.log('[Shutdown] Database connections closed');
        } catch (closeError) {
            console.warn('[Shutdown] Error closing database:', closeError.message);
        }

        console.log('[Shutdown] Graceful shutdown completed successfully');

    } catch (error) {
        console.error('[Shutdown] Error during graceful shutdown:', error);
        // Continue with shutdown even if there were errors
    } finally {
        // Actually quit the app now
        console.log('[Shutdown] Exiting application...');
        app.exit(0); // Use app.exit() instead of app.quit() to force quit
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainOnlyWindow();
    }
});

function setupWebDataHandlers() {
    const sessionRepository = require('./features/common/repositories/session');
    const sttRepository = require('./features/listen/stt/repositories');
    const summaryRepository = require('./features/listen/summary/repositories');
    const askRepository = require('./features/ask/repositories');
    const userRepository = require('./features/common/repositories/user');
    const presetRepository = require('./features/common/repositories/preset');

    const handleRequest = async (channel, responseChannel, payload) => {
        let result;
        // const currentUserId = authService.getCurrentUserId(); // No longer needed here
        try {
            switch (channel) {
                // SESSION
                case 'get-sessions':
                    // Adapter injects UID
                    result = await sessionRepository.getAllByUserId();
                    break;
                case 'get-session-details':
                    const session = await sessionRepository.getById(payload);
                    if (!session) {
                        result = null;
                        break;
                    }
                    const [transcripts, ai_messages, summary] = await Promise.all([
                        sttRepository.getAllTranscriptsBySessionId(payload),
                        askRepository.getAllAiMessagesBySessionId(payload),
                        summaryRepository.getSummaryBySessionId(payload)
                    ]);
                    result = { session, transcripts, ai_messages, summary };
                    break;
                case 'delete-session':
                    result = await sessionRepository.deleteWithRelatedData(payload);
                    break;
                case 'create-session':
                    // Adapter injects UID
                    const id = await sessionRepository.create('ask');
                    if (payload && payload.title) {
                        await sessionRepository.updateTitle(id, payload.title);
                    }
                    result = { id };
                    break;

                // USER
                case 'get-user-profile':
                    // Adapter injects UID
                    result = await userRepository.getById();
                    break;
                case 'update-user-profile':
                    // Adapter injects UID
                    result = await userRepository.update(payload);
                    break;
                case 'find-or-create-user':
                    result = await userRepository.findOrCreate(payload);
                    break;
                case 'save-api-key':
                    // Use ModelStateService as the single source of truth for API key management
                    result = await modelStateService.setApiKey(payload.provider, payload.apiKey);
                    break;
                case 'check-api-key-status':
                    // Use ModelStateService to check API key status
                    const hasApiKey = await modelStateService.hasValidApiKey();
                    result = { hasApiKey };
                    break;
                case 'delete-account':
                    // Adapter injects UID
                    result = await userRepository.deleteById();
                    break;

                // PRESET
                case 'get-presets':
                    // Adapter injects UID
                    result = await presetRepository.getPresets();
                    break;
                case 'create-preset':
                    // Adapter injects UID
                    result = await presetRepository.create(payload);
                    settingsService.notifyPresetUpdate('created', result.id, payload.title);
                    break;
                case 'update-preset':
                    // Adapter injects UID
                    result = await presetRepository.update(payload.id, payload.data);
                    settingsService.notifyPresetUpdate('updated', payload.id, payload.data.title);
                    break;
                case 'delete-preset':
                    // Adapter injects UID
                    result = await presetRepository.delete(payload);
                    settingsService.notifyPresetUpdate('deleted', payload);
                    break;

                // BATCH
                case 'get-batch-data':
                    const includes = payload ? payload.split(',').map(item => item.trim()) : ['profile', 'presets', 'sessions'];
                    const promises = {};

                    if (includes.includes('profile')) {
                        // Adapter injects UID
                        promises.profile = userRepository.getById();
                    }
                    if (includes.includes('presets')) {
                        // Adapter injects UID
                        promises.presets = presetRepository.getPresets();
                    }
                    if (includes.includes('sessions')) {
                        // Adapter injects UID
                        promises.sessions = sessionRepository.getAllByUserId();
                    }

                    const batchResult = {};
                    const promiseResults = await Promise.all(Object.values(promises));
                    Object.keys(promises).forEach((key, index) => {
                        batchResult[key] = promiseResults[index];
                    });

                    result = batchResult;
                    break;

                default:
                    throw new Error(`Unknown web data channel: ${channel}`);
            }
            eventBridge.emit(responseChannel, { success: true, data: result });
        } catch (error) {
            console.error(`Error handling web data request for ${channel}:`, error);
            eventBridge.emit(responseChannel, { success: false, error: error.message });
        }
    };

    eventBridge.on('web-data-request', handleRequest);
}






// Auto-update initialization
let updateStatus = 'idle'; // idle, checking, available, downloading, downloaded, not-available, error

async function initAutoUpdater() {
    if (process.env.NODE_ENV === 'development') {
        console.log('Development environment, skipping auto-updater.');
        return;
    }

    try {
        // 设置事件监听器
        autoUpdater.on('checking-for-update', () => {
            console.log('[AutoUpdater] Checking for update...');
            updateStatus = 'checking';
            broadcastUpdateStatus({ status: 'checking' });
        });

        autoUpdater.on('update-available', (info) => {
            console.log('[AutoUpdater] Update available:', info.version);
            updateStatus = 'available';
            broadcastUpdateStatus({ status: 'available', version: info.version });
            autoUpdater.downloadUpdate();
        });

        autoUpdater.on('update-not-available', (info) => {
            console.log('[AutoUpdater] Update not available, current version is latest');
            updateStatus = 'not-available';
            broadcastUpdateStatus({ status: 'not-available', version: info.version });
        });

        autoUpdater.on('download-progress', (progress) => {
            console.log(`[AutoUpdater] Download progress: ${progress.percent.toFixed(1)}%`);
            updateStatus = 'downloading';
            broadcastUpdateStatus({ 
                status: 'downloading', 
                percent: progress.percent,
                transferred: progress.transferred,
                total: progress.total
            });
        });

        autoUpdater.on('update-downloaded', (info) => {
            console.log('[AutoUpdater] Update downloaded:', info.version);
            updateStatus = 'downloaded';
            broadcastUpdateStatus({ status: 'downloaded', version: info.version });
            dialog.showMessageBox({
                type: 'info',
                title: '幕语更新',
                message: `幕语新版本 (${info.version}) 已下载完成，是否立即重启应用以完成更新？`,
                buttons: ['立即重启', '稍后']
            }).then(response => {
                if (response.response === 0) {
                    autoUpdater.quitAndInstall();
                }
            });
        });

        autoUpdater.on('error', (err) => {
            console.error('[AutoUpdater] Error:', err);
            updateStatus = 'error';
            broadcastUpdateStatus({ status: 'error', error: err.message });
        });

        // 启动时自动检查更新
        await autoUpdater.checkForUpdates();
    } catch (err) {
        console.error('[AutoUpdater] Error initializing:', err);
        updateStatus = 'error';
    }
}

// 广播更新状态到所有渲染进程
function broadcastUpdateStatus(data) {
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
            win.webContents.send('updater:status', data);
        }
    });
}

// 手动检查更新
ipcMain.handle('updater:check', async () => {
    if (process.env.NODE_ENV === 'development') {
        return { status: 'development', message: '开发环境不支持更新检查' };
    }
    
    try {
        updateStatus = 'checking';
        const result = await autoUpdater.checkForUpdates();
        return { status: 'success', updateInfo: result?.updateInfo };
    } catch (err) {
        console.error('[AutoUpdater] Manual check error:', err);
        return { status: 'error', message: err.message };
    }
});

// 获取当前应用版本
ipcMain.handle('updater:get-version', () => {
    return app.getVersion();
});

// 获取当前更新状态
ipcMain.handle('updater:get-status', () => {
    return { status: updateStatus };
});

// 安装已下载的更新
ipcMain.handle('updater:install', () => {
    if (updateStatus === 'downloaded') {
        autoUpdater.quitAndInstall();
        return { status: 'success' };
    }
    return { status: 'error', message: '没有可安装的更新' };
});
