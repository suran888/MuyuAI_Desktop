const { Readable } = require('stream');
const config = require('../common/config/config');
const authService = require('../common/services/authService');

const fetchImpl = global.fetch || require('node-fetch');

function buildEndpoint() {
    const baseUrl = (config.get('apiUrl') || '').trim().replace(/\/$/, '');
    if (!baseUrl) {
        throw new Error('Ask API base URL is not configured.');
    }
    return `${baseUrl}/api/v1/ask/stream`;
}

function getReaderFromBody(body) {
    if (!body) return null;
    if (typeof body.getReader === 'function') {
        return body.getReader();
    }

    if (typeof body.on === 'function' && Readable?.toWeb) {
        try {
            const webStream = Readable.toWeb(body);
            return webStream.getReader();
        } catch (error) {
            console.error('[askApi] Failed to convert Node stream to Web stream:', error);
        }
    }
    return null;
}

function normalizePayload(payload) {
    const base = (payload && typeof payload === 'object') ? { ...payload } : {};

    base.sessionId = typeof base.sessionId === 'string' ? (base.sessionId.trim() || null) : base.sessionId || null;
    base.question = typeof base.question === 'string' ? base.question.trim() : '';

    const context = base.context && typeof base.context === 'object' ? { ...base.context } : {};
    base.context = {
        conversationHistory: typeof context.conversationHistory === 'string' ? context.conversationHistory : '',
        metadata: context.metadata ?? null,
    };

    base.attachments = normalizeAttachments(base.attachments);

    return base;
}

function normalizeAttachments(attachments) {
    if (!attachments || typeof attachments !== 'object') {
        return null;
    }
    const screenshot = attachments.screenshot;
    if (!screenshot || typeof screenshot !== 'object') {
        return null;
    }
    const url = typeof screenshot.url === 'string' ? screenshot.url.trim() : '';
    if (!url) return null;

    return {
        screenshot: {
            url,
            width: typeof screenshot.width === 'number' ? screenshot.width : null,
            height: typeof screenshot.height === 'number' ? screenshot.height : null,
            mimeType: typeof screenshot.mimeType === 'string' ? screenshot.mimeType : 'image/jpeg',
        },
    };
}

async function startAskStream(payload, { signal } = {}) {
    const endpoint = buildEndpoint();

    const headers = {
        'Content-Type': 'application/json',
    };

    const interviewAuth = authService.getInterviewAuthState?.();
    if (interviewAuth?.token) {
        headers.Authorization = `Bearer ${interviewAuth.token}`;
    }

    const normalizedPayload = normalizePayload(payload || {});

    const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(normalizedPayload),
        signal,
    });

    console.log('Ask API response:', response)
    if (!response.ok) {
        let message = `Ask stream request failed (${response.status})`;
        try {
            const errorBody = await response.text();
            if (errorBody) {
                const parsed = JSON.parse(errorBody);
                message = parsed?.message || parsed?.error || message;
            }
        } catch (_) { }
        throw new Error(message);
    }

    const reader = getReaderFromBody(response.body);
    if (!reader) {
        throw new Error('Streaming reader unavailable from backend response.');
    }

    return reader;
}

/**
 * Start screenshot analysis stream
 * @param {Object} payload - { sessionId, imageUrl }
 * @param {Object} options - { signal }
 * @returns {Promise<ReadableStreamDefaultReader>}
 */
async function startScreenshotAnalysis(payload, { signal } = {}) {
    const baseUrl = (config.get('apiUrl') || '').trim().replace(/\/$/, '');
    if (!baseUrl) {
        throw new Error('Ask API base URL is not configured.');
    }
    const endpoint = `${baseUrl}/api/v1/ask/screenshot`;

    const headers = {
        'Content-Type': 'application/json',
    };

    const interviewAuth = authService.getInterviewAuthState?.();
    if (interviewAuth?.token) {
        headers.Authorization = `Bearer ${interviewAuth.token}`;
    }

    const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
    });

    if (!response.ok) {
        let message = `Screenshot analysis request failed (${response.status})`;
        try {
            const errorBody = await response.text();
            if (errorBody) {
                const parsed = JSON.parse(errorBody);
                message = parsed?.message || parsed?.error || message;
            }
        } catch (_) { }
        throw new Error(message);
    }

    const reader = getReaderFromBody(response.body);
    if (!reader) {
        throw new Error('Streaming reader unavailable from screenshot API response.');
    }

    return reader;
}

module.exports = {
    startAskStream,
    startScreenshotAnalysis,
};
