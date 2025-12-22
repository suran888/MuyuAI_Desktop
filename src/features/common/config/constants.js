/**
 * Application-wide constants and default values
 * 应用全局常量和默认值配置
 */

// Production environment defaults
// 生产环境默认配置
const PRODUCTION_DEFAULTS = {
    API_DOMAIN: 'https://resume-api.muyulab.com',
    WEB_URL: 'https://resume.muyulab.com',
    STT_BACKEND_ENDPOINT: 'wss://resume-api.muyulab.com/api/v1/stt/stream',
};

// Development environment defaults
// 开发环境默认配置
const DEVELOPMENT_DEFAULTS = {
    API_DOMAIN: 'http://localhost:8080',
    WEB_URL: 'http://localhost:3000',
    STT_BACKEND_ENDPOINT: 'ws://localhost:8080/api/v1/stt/stream',
};

// API endpoints
// API 端点路径
const API_PATHS = {
    // Auth endpoints
    INTERVIEW_LOGIN: '/api/v1/auth/login_by_token',

    // Session endpoints
    SESSION_START: '/api/v1/session/start',
    SESSION_STOP: '/api/v1/session/stop',
    SESSION_HEARTBEAT: '/api/v1/session/heartbeat',

    // User endpoints
    USER_TIME_SUMMARY: '/api/v1/user-time-account/summary',

    // STT endpoints
    STT_STREAM: '/api/v1/stt/stream',
};

// Application defaults
// 应用默认配置
const APP_DEFAULTS = {
    API_TIMEOUT: 10000,
    CACHE_TIMEOUT: 5 * 60 * 1000, // 5 minutes
    HEALTH_CHECK_INTERVAL: 30 * 1000, // 30 seconds
    SYNC_INTERVAL: 0,

    DEFAULT_WINDOW_WIDTH: 400,
    DEFAULT_WINDOW_HEIGHT: 60,

    ENABLE_CACHING: true,
    ENABLE_OFFLINE_MODE: true,
    ENABLE_FILE_BASED_COMMUNICATION: false,
    ENABLE_SQLITE_STORAGE: true,
    ENABLE_JWT: false,
    FALLBACK_TO_HEADER_AUTH: false,

    LOG_LEVEL: 'info',
    ENABLE_DEBUG_LOGGING: false,
};

// User defaults
// 用户默认配置
const USER_DEFAULTS = {
    ID: 'default_user',
    EMAIL: 'contact@muyu.ai',
    DISPLAY_NAME: 'Default User',
};

/**
 * Get environment-specific defaults based on NODE_ENV
 * 根据 NODE_ENV 获取对应环境的默认配置
 * @param {string} env - Environment name ('production' or 'development')
 * @returns {object} Environment-specific defaults
 */
function getEnvironmentDefaults(env = 'production') {
    // Only use development defaults when explicitly set to 'development'
    // 只有明确设置为 'development' 时才使用开发环境配置，其余情况都使用生产环境配置
    return env === 'development' ? DEVELOPMENT_DEFAULTS : PRODUCTION_DEFAULTS;
}

/**
 * Apply environment defaults to process.env if not already set
 * 将环境默认值应用到 process.env(如果尚未设置)
 * @param {string} env - Environment name
 */
function applyEnvironmentDefaults(env = 'production') {
    const defaults = getEnvironmentDefaults(env);

    process.env.MUYU_API_DOMAIN = process.env.MUYU_API_DOMAIN || defaults.API_DOMAIN;
    process.env.MUYU_WEB_URL = process.env.MUYU_WEB_URL || defaults.WEB_URL;
    process.env.STT_BACKEND_ENDPOINT = process.env.STT_BACKEND_ENDPOINT || defaults.STT_BACKEND_ENDPOINT;
}

module.exports = {
    PRODUCTION_DEFAULTS,
    DEVELOPMENT_DEFAULTS,
    API_PATHS,
    APP_DEFAULTS,
    USER_DEFAULTS,
    getEnvironmentDefaults,
    applyEnvironmentDefaults,
};
