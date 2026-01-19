// Configuration management for environment-based settings
// Load environment variables first based on NODE_ENV
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { loadEnvironment, PRODUCTION_DEFAULTS, APP_DEFAULTS } = require('./constants');

// Load environment variables
const envPath = loadEnvironment(app);
const nodeEnv = process.env.NODE_ENV || 'production';
const envFile = nodeEnv === 'production' ? '.env.production' : '.env';

if (fs.existsSync(envPath)) {
    console.log(`[Config] Loading environment from: ${envFile} (NODE_ENV: ${nodeEnv})`);
} else {
    console.log(`[Config] Using ${nodeEnv} defaults (.env file not found)`);
}

const os = require('os');

const apiUrl = process.env.MUYU_API_DOMAIN;
const webUrl = process.env.MUYU_WEB_URL;
const apiTimeout = process.env.MUYU_API_TIMEOUT || APP_DEFAULTS.API_TIMEOUT;

class Config {
    constructor() {
        this.env = process.env.NODE_ENV || 'production';
        this.defaults = {
            apiUrl: apiUrl,
            apiTimeout: apiTimeout,
            
            webUrl: webUrl,
            
            enableJWT: APP_DEFAULTS.ENABLE_JWT,
            fallbackToHeaderAuth: APP_DEFAULTS.FALLBACK_TO_HEADER_AUTH,
            
            cacheTimeout: APP_DEFAULTS.CACHE_TIMEOUT,
            enableCaching: APP_DEFAULTS.ENABLE_CACHING,
            
            syncInterval: APP_DEFAULTS.SYNC_INTERVAL,
            healthCheckInterval: APP_DEFAULTS.HEALTH_CHECK_INTERVAL,
            
            defaultWindowWidth: APP_DEFAULTS.DEFAULT_WINDOW_WIDTH,
            defaultWindowHeight: APP_DEFAULTS.DEFAULT_WINDOW_HEIGHT,
            
            enableOfflineMode: APP_DEFAULTS.ENABLE_OFFLINE_MODE,
            enableFileBasedCommunication: APP_DEFAULTS.ENABLE_FILE_BASED_COMMUNICATION,
            enableSQLiteStorage: APP_DEFAULTS.ENABLE_SQLITE_STORAGE,
            
            logLevel: APP_DEFAULTS.LOG_LEVEL,
            enableDebugLogging: APP_DEFAULTS.ENABLE_DEBUG_LOGGING
        };
        
        this.config = { ...this.defaults };
        this.loadEnvironmentConfig();
        this.loadUserConfig();
    }
    
    loadEnvironmentConfig() {
        this.config.apiUrl = apiUrl;
        console.log(`[Config] API URL from env: ${this.config.apiUrl}`);
        
        this.config.webUrl = webUrl;
        console.log(`[Config] Web URL from env: ${this.config.webUrl}`);
        
        if (this.env === 'production') {
            this.config.enableDebugLogging = false;
            this.config.logLevel = 'warn';
        } else if (this.env === 'development') {
            this.config.enableDebugLogging = true;
            this.config.logLevel = 'debug';
        }
    }
    
    loadUserConfig() {
        try {
            const userConfigPath = this.getUserConfigPath();
            if (fs.existsSync(userConfigPath)) {
                const userConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf-8'));
                this.config = { ...this.config, ...userConfig };
                console.log('[Config] User config loaded from:', userConfigPath);
            }
        } catch (error) {
            console.warn('[Config] Failed to load user config:', error.message);
        }
    }
    
    getUserConfigPath() {
        const configDir = path.join(os.homedir(), '.muyu');
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        return path.join(configDir, 'config.json');
    }
    
    get(key) {
        return this.config[key];
    }
    
    set(key, value) {
        this.config[key] = value;
    }
    
    getAll() {
        return { ...this.config };
    }
    
    saveUserConfig() {
        try {
            const userConfigPath = this.getUserConfigPath();
            const userConfig = { ...this.config };
            
            Object.keys(this.defaults).forEach(key => {
                if (userConfig[key] === this.defaults[key]) {
                    delete userConfig[key];
                }
            });
            
            fs.writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2));
            console.log('[Config] User config saved to:', userConfigPath);
        } catch (error) {
            console.error('[Config] Failed to save user config:', error);
        }
    }
    
    reset() {
        this.config = { ...this.defaults };
        this.loadEnvironmentConfig();
    }
    
    isDevelopment() {
        return this.env === 'development';
    }
    
    isProduction() {
        return this.env === 'production';
    }
    
    shouldLog(level) {
        const levels = ['debug', 'info', 'warn', 'error'];
        const currentLevelIndex = levels.indexOf(this.config.logLevel);
        const requestedLevelIndex = levels.indexOf(level);
        return requestedLevelIndex >= currentLevelIndex;
    }
}

const config = new Config();

module.exports = config;