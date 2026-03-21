const fetch = require('node-fetch');
const { BrowserWindow } = require('electron');
const authService = require('./authService');
const { API_PATHS } = require('../config/constants');

const loggerPrefix = '[PasscodeService]';
const SESSION_START_PATH = API_PATHS.SESSION_START;
const SESSION_STOP_PATH = API_PATHS.SESSION_STOP;
const SESSION_PING_PATH = API_PATHS.SESSION_HEARTBEAT;
const USER_TIME_SUMMARY_PATH = API_PATHS.USER_TIME_SUMMARY;

class PasscodeService {
    constructor() {
        this.isVerified = false;
        const domain = (process.env.MUYU_API_DOMAIN || '').trim().replace(/\/$/, '');
        this.sessionEndpoint = `${domain}${SESSION_START_PATH}`;
        this.sessionStopEndpoint = `${domain}${SESSION_STOP_PATH}`;
        this.sessionPingEndpoint = `${domain}${SESSION_PING_PATH}`;
        this.userTimeSummaryEndpoint = `${domain}${USER_TIME_SUMMARY_PATH}`;
        this.activeSession = null;
        this.sessionPingTimer = null;
    }

    isPasscodeRequired() {
        return !this.isVerified;
    }

    getStatus() {
        const required = this.isPasscodeRequired();
        return {
            required,
            verified: this.isVerified || !required,
        };
    }

    reset() {
        this.isVerified = false;
        this.activeSession = null;
        if (this.sessionPingTimer) {
            clearInterval(this.sessionPingTimer);
            this.sessionPingTimer = null;
        }
    }

    getActiveSessionInfo() {
        if (!this.activeSession) {
            return null;
        }
        try {
            return { ...this.activeSession };
        } catch (_) {
            return this.activeSession;
        }
    }

    getActiveSessionId() {
        const session = this.getActiveSessionInfo();
        if (!session) return null;
        return (
            session.sessionId ||
            session.session_id ||
            session.id ||
            session.interview_session_id ||
            null
        );
    }

    async verify(input) {
        const candidate = (input || '').trim();
        if (!candidate) {
            return { success: false, error: '请输入面试口令' };
        }

        if (!/^[A-Za-z0-9]{8}$/.test(candidate)) {
            return { success: false, error: '口令需为 8 位字母或数字组合' };
        }

        if (!this.sessionEndpoint) {
            console.warn(`${loggerPrefix} Session endpoint missing, using mock verification.`);
            await this.mockVerify(candidate);
            this.isVerified = true;
            return { success: true, mocked: true };
        }

        const loginResult = await this._loginWithToken(candidate);
        if (!loginResult.success) {
            return loginResult;
        }

        const sessionResult = await this._startInterviewSession(candidate, loginResult.token);
        if (!sessionResult.success) {
            return sessionResult;
        }

        this.activeSession = sessionResult.session || null;
        // 登录后不自动启动心跳，改为在开始收音时启动
        this.isVerified = true;
        console.log(`${loggerPrefix} Passcode verified, interview session started.`);
        return { success: true };
    }

    async _loginWithToken(passcode) {
        try {
            const result = await authService.loginWithInterviewToken(passcode);
            if (!result?.token) {
                return { success: false, error: '登录响应缺少 token，请联系管理员' };
            }
            return { success: true, token: result.token };
        } catch (error) {
            console.error(`${loggerPrefix} login error:`, error);
            return {
                success: false,
                error: error?.message || '登录失败，请稍后重试',
            };
        }
    }

    async _startInterviewSession(passcode, jwtToken) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (jwtToken) {
                headers.Authorization = `Bearer ${jwtToken}`;
            }

            const response = await fetch(this.sessionEndpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({ token: passcode }),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                return {
                    success: false,
                    error: data?.message || data?.error || '口令验证失败，请重试',
                };
            }

            const status = typeof data?.status === 'string' ? data.status.toLowerCase() : null;
            if (status && status !== 'active') {
                return {
                    success: false,
                    error: '当前面试未开放，请稍后再试',
                };
            }

            return { success: true, session: data || null };
        } catch (error) {
            console.error(`${loggerPrefix} session start error:`, error);
            return {
                success: false,
                error: '无法连接验证服务，请稍后重试',
            };
        }
    }

    /**
     * 调用 /api/v1/user-time-account/summary 获取当前剩余时长等信息
   * 返回结果示例（后端约定）：
   *  {
   *    creditedSeconds: 7200,
   *    consumedSeconds: 1800,
   *    remainingSeconds: 5400,
   *    entries: [...]
   *  }
     */
    async getUserTimeSummary() {
        if (!this.userTimeSummaryEndpoint) {
            console.warn(`${loggerPrefix} User time summary endpoint missing, skipping call.`);
            return { success: false, error: 'User time summary endpoint not configured' };
        }

        try {
            const headers = { 'Content-Type': 'application/json' };
            const { token } = authService.getInterviewAuthState?.() || {};
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }

            const response = await fetch(this.userTimeSummaryEndpoint, {
                method: 'GET',
                headers,
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                return {
                    success: false,
                    error: data?.message || data?.error || '获取剩余时长失败，请稍后重试',
                };
            }

            // 按后端约定字段解析
            const creditedSeconds = Number.isFinite(data?.creditedSeconds) ? data.creditedSeconds : 0;
            const consumedSeconds = Number.isFinite(data?.consumedSeconds) ? data.consumedSeconds : 0;
            const remainingSeconds = Number.isFinite(data?.remainingSeconds) ? data.remainingSeconds : 0;
            // 新增：用于 UI 实时展示的有效剩余时长
            const effectiveRemainingSeconds = Number.isFinite(data?.effectiveRemainingSeconds)
                ? data.effectiveRemainingSeconds
                : remainingSeconds;

            const normalized = {
                success: true,
                remainingSeconds: Number.isFinite(remainingSeconds) ? remainingSeconds : 0,
                effectiveRemainingSeconds: Number.isFinite(effectiveRemainingSeconds) ? effectiveRemainingSeconds : 0,
                creditedSeconds,
                consumedSeconds,
                raw: data,
            };

            console.log(`${loggerPrefix} User time summary:`, {
                creditedSeconds: normalized.creditedSeconds,
                consumedSeconds: normalized.consumedSeconds,
                remainingSeconds: normalized.remainingSeconds,
                effectiveRemainingSeconds: normalized.effectiveRemainingSeconds,
            });

            // 主动广播给所有窗口，让前端同步更新剩余时长
            try {
                BrowserWindow.getAllWindows().forEach(win => {
                    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
                        win.webContents.send('user-time-summary-updated', {
                            remainingSeconds: normalized.remainingSeconds,
                            effectiveRemainingSeconds: normalized.effectiveRemainingSeconds,
                            creditedSeconds: normalized.creditedSeconds,
                            consumedSeconds: normalized.consumedSeconds,
                        });
                    }
                });
            } catch (_) {
                // 广播失败不影响主流程
            }

            return normalized;
        } catch (error) {
            console.error(`${loggerPrefix} user time summary error:`, error);
            return {
                success: false,
                error: error?.message || '无法获取剩余时长，请稍后重试',
            };
        }
    }

    /**
     * 调用 /api/v1/session/ping，告知后端会话仍然活跃，以便后端刷新剩余时长
     */
    async _pingSession(sessionId) {
        if (!this.sessionPingEndpoint) {
            console.warn(`${loggerPrefix} Session ping endpoint missing, skipping ping.`);
            return { success: false, error: 'Session ping endpoint not configured' };
        }

        if (!sessionId) {
            console.warn(`${loggerPrefix} No sessionId for ping, skipping.`);
            return { success: false, error: 'No sessionId for ping' };
        }

        try {
            const headers = { 'Content-Type': 'application/json' };
            const { token } = authService.getInterviewAuthState?.() || {};
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }

            console.log(`${loggerPrefix} Sending session heartbeat`, {
                endpoint: this.sessionPingEndpoint,
                sessionId,
            });

            const response = await fetch(this.sessionPingEndpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({ sessionId }),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                console.warn(`${loggerPrefix} Session ping failed:`, data);
                return {
                    success: false,
                    error: data?.message || data?.error || 'Session ping failed',
                };
            }

            // ping 成功后刷新一次 summary，并通过 getUserTimeSummary 内部广播最新剩余时长
            this.getUserTimeSummary().catch(err => {
                console.warn(`${loggerPrefix} Failed to refresh user time summary after ping:`, err);
            });

            return { success: true, data };
        } catch (error) {
            console.error(`${loggerPrefix} Session ping error:`, error);
            return {
                success: false,
                error: error?.message || 'Session ping error',
            };
        }
    }

    /**
     * 开始收音时调用 - 立即上报一次，然后每 60 秒上报一次
     */
    async startRecordingHeartbeat() {
        const sessionId = this.getActiveSessionId();
        if (!sessionId) {
            console.warn(`${loggerPrefix} No sessionId for recording heartbeat, skipping.`);
            return { success: false, error: 'No active session' };
        }

        // 停止之前的定时器（如果有）
        if (this.sessionPingTimer) {
            clearInterval(this.sessionPingTimer);
            this.sessionPingTimer = null;
        }

        // 记录开始时间
        this.recordingStartTime = Date.now();
        this.lastHeartbeatTime = Date.now();

        console.log(`${loggerPrefix} Starting recording heartbeat for sessionId:`, sessionId);

        // 立即上报一次（预扣 1 分钟）
        const result = await this._pingSession(sessionId);

        // 启动定时器，每 60 秒上报一次
        this.sessionPingTimer = setInterval(() => {
            this.lastHeartbeatTime = Date.now();
            this._pingSession(sessionId).catch(() => { /* 已在内部记录日志 */ });
        }, 60 * 1000);

        return result;
    }

    /**
     * 停止收音时调用 - 停止定时器，上报最后一段时间（不足 1 分钟按 1 分钟算）
     */
    async stopRecordingHeartbeat() {
        const sessionId = this.getActiveSessionId();

        // 停止定时器
        if (this.sessionPingTimer) {
            clearInterval(this.sessionPingTimer);
            this.sessionPingTimer = null;
        }

        if (!sessionId) {
            console.warn(`${loggerPrefix} No sessionId for stop recording heartbeat.`);
            return { success: false, error: 'No active session' };
        }

        // 计算距离上次心跳的时间
        const now = Date.now();
        const timeSinceLastHeartbeat = this.lastHeartbeatTime ? (now - this.lastHeartbeatTime) : 0;

        console.log(`${loggerPrefix} Stopping recording heartbeat`, {
            sessionId,
            timeSinceLastHeartbeat: `${Math.round(timeSinceLastHeartbeat / 1000)}s`,
        });

        // 如果距离上次心跳超过 1 秒，则再上报一次（不足 1 分钟按 1 分钟算）
        // 这样可以确保最后一段时间也被计费
        if (timeSinceLastHeartbeat > 1000) {
            const result = await this._pingSession(sessionId);
            this.recordingStartTime = null;
            this.lastHeartbeatTime = null;
            return result;
        }

        this.recordingStartTime = null;
        this.lastHeartbeatTime = null;
        return { success: true, skipped: true };
    }

    async stopActiveSession(sessionId = null) {
        // 先停止本地 ping 计时器
        if (this.sessionPingTimer) {
            clearInterval(this.sessionPingTimer);
            this.sessionPingTimer = null;
        }

        // return { success: true, skipped: true }
        // TODO 临时跳过 stop session logic for debug

        const targetSessionId = sessionId || this.activeSession?.session_id || this.activeSession?.sessionId;
        console.log(`${loggerPrefix} stopActiveSession called with sessionId:`, targetSessionId);
        if (!targetSessionId) {
            console.log(`${loggerPrefix} No active interview session to stop.`);
            return { success: true, skipped: true };
        }

        if (!this.sessionStopEndpoint) {
            console.warn(`${loggerPrefix} Session stop endpoint missing, skipping stop call.`);
            return { success: false, error: 'Session stop endpoint not configured' };
        }

        try {
            const headers = { 'Content-Type': 'application/json' };
            const { token } = authService.getInterviewAuthState?.() || {};
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }

            const response = await fetch(this.sessionStopEndpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({ sessionId: targetSessionId }),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                return {
                    success: false,
                    error: data?.message || data?.error || 'Session stop failed',
                };
            }

            console.log(`${loggerPrefix} Interview session ${targetSessionId} stopped successfully.`);
            this.activeSession = null;
            return { success: true, data };
        } catch (error) {
            console.error(`${loggerPrefix} session stop error:`, error);
            return {
                success: false,
                error: error?.message || 'Failed to stop interview session',
            };
        }
    }

    async mockVerify(passcode) {
        console.log(`${loggerPrefix} No API endpoint configured. Mock-verifying passcode "${passcode}".`);
        await new Promise(resolve => setTimeout(resolve, 300));
        return { success: true };
    }
}

module.exports = new PasscodeService();
