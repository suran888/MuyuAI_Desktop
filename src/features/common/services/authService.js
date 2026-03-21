const { API_PATHS, USER_DEFAULTS } = require('../config/constants');

const { BrowserWindow } = require('electron');
const fetch = require('node-fetch');
const sessionRepository = require('../repositories/session');

const INTERVIEW_LOGIN_PATH = API_PATHS.INTERVIEW_LOGIN;

class AuthService {
    constructor() {
        this.currentUserId = USER_DEFAULTS.ID;
        this.currentUserMode = 'local'; // 'local' | 'interview'
        this.currentUser = null;
        this.isInitialized = false;
        this.interviewAuth = {
            token: null,
            user: null,
            raw: null,
        };

        this.initializationPromise = null;
        sessionRepository.setAuthService(this);
    }

    async initialize() {
        if (this.isInitialized) return this.initializationPromise;

        this.initializationPromise = (async () => {
            console.log('[AuthService] Initializing in local mode...');

            // Clean up any zombie sessions from previous runs
            await sessionRepository.endAllActiveSessions();

            // Initialize with default local user
            this.currentUserId = USER_DEFAULTS.ID;
            this.currentUserMode = 'local';
            this.currentUser = null;

            this.isInitialized = true;
            this.broadcastUserState();

            console.log('[AuthService] Initialized successfully in local mode.');
        })();

        return this.initializationPromise;
    }

    broadcastUserState() {
        const userState = this.getCurrentUser();
        console.log('[AuthService] Broadcasting user state change:', userState);
        BrowserWindow.getAllWindows().forEach(win => {
            if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
                win.webContents.send('user-state-changed', userState);
            }
        });
    }

    getCurrentUserId() {
        return this.currentUserId;
    }

    getCurrentUser() {
        if (this.currentUserMode === 'interview' && this.currentUser) {
            return {
                uid: this.currentUser.uid,
                email: this.currentUser.email,
                displayName: this.currentUser.displayName,
                phone: this.currentUser.phone || null,
                mode: 'interview',
                isLoggedIn: true,
                authToken: this.interviewAuth?.token || null,
                profile: this.interviewAuth?.user || null,
                totalInterviewSeconds: this.interviewAuth?.raw?.totalInterviewSeconds || 0,
            };
        }

        // Local mode (default)
        return {
            uid: this.currentUserId,
            email: USER_DEFAULTS.EMAIL,
            displayName: USER_DEFAULTS.DISPLAY_NAME,
            mode: 'local',
            isLoggedIn: false,
        };
    }

    _getApiDomain() {
        const domain = (process.env.MUYU_API_DOMAIN || '').trim().replace(/\/$/, '');
        console.log('[AuthService] API domain:', domain);
        return domain;
    }

    _getInterviewLoginEndpoint() {
        return `${this._getApiDomain()}${INTERVIEW_LOGIN_PATH}`;
    }

    async loginWithInterviewToken(passcode) {
        const sanitized = (passcode || '').trim();
        if (!sanitized) {
            throw new Error('请输入面试口令');
        }

        const endpoint = this._getInterviewLoginEndpoint();
        console.log('[AuthService] Interview login endpoint:', endpoint);
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: sanitized }),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data?.message || data?.error || '登录失败，请重试');
            }

            const jwtToken = data?.token || data?.jwt || data?.accessToken || data?.access_token;
            if (!jwtToken) {
                throw new Error('登录响应缺少 token，请联系管理员');
            }

            const userPayload = data?.user || data?.data?.user || null;
            this._setInterviewUserState(userPayload, jwtToken, data);

            console.log('[AuthService] Interview login succeeded.');
            return { token: jwtToken, user: userPayload, raw: data };
        } catch (error) {
            console.error('[AuthService] loginWithInterviewToken failed:', error);
            throw new Error(error?.message || '无法连接登录服务，请稍后再试');
        }
    }

    _setInterviewUserState(userPayload, jwtToken, raw) {
        const inferredId =
            userPayload?.uid ||
            userPayload?.id ||
            userPayload?._id ||
            userPayload?.userId ||
            `interview_${Date.now()}`;

        const normalizedId = String(inferredId);
        const displayName = userPayload?.name || userPayload?.displayName || userPayload?.nickname || userPayload?.profile?.displayName || 'Interview User';
        const email = userPayload?.email || userPayload?.profile?.email || `${normalizedId}@muyu.ai`;
        // 手机号可能在 profile 对象中
        const phone = userPayload?.phone || userPayload?.phoneNumber || userPayload?.mobile || userPayload?.profile?.phone || null;

        console.log('[AuthService] _setInterviewUserState - userPayload:', userPayload);
        console.log('[AuthService] _setInterviewUserState - extracted phone:', phone);
        console.log('[AuthService] _setInterviewUserState - extracted email:', email);
        console.log('[AuthService] _setInterviewUserState - normalizedId:', normalizedId);

        this.currentUserId = normalizedId;
        this.currentUserMode = 'interview';
        this.currentUser = {
            uid: normalizedId,
            email,
            displayName,
            phone,
            mode: 'interview',
            isLoggedIn: true,
        };
        
        console.log('[AuthService] _setInterviewUserState - final currentUser:', this.currentUser);
        this.interviewAuth = {
            token: jwtToken,
            user: userPayload || null,
            raw: raw || null,
        };

        this.broadcastUserState();
    }

    getInterviewAuthState() {
        return { ...this.interviewAuth };
    }
}

const authService = new AuthService();
module.exports = authService; 
