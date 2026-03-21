const { Readable } = require('stream');
const config = require('../common/config/config');
const authService = require('../common/services/authService');

const fetchImpl = global.fetch || require('node-fetch');

function buildEndpoint(turnId) {
    const baseUrl = (config.get('apiUrl') || '').trim().replace(/\/$/, '');
    if (!baseUrl) {
        throw new Error('Live Insights API base URL is not configured.');
    }
    const path = '/api/v1/insights/stream';
    if (turnId) {
        const qs = new URLSearchParams({ turnId }).toString();
        return `${baseUrl}${path}?${qs}`;
    }
    return `${baseUrl}${path}`;
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
            console.error('[liveInsightsApi] Failed to convert Node stream to Web stream:', error);
        }
    }
    return null;
}

function normalizeStreamPayload(payload) {
    const base = (payload && typeof payload === 'object') ? { ...payload } : {};
    const turn = base.turn && typeof base.turn === 'object' ? { ...base.turn } : {};
    base.turn = {
        id: turn.id || null,
        speaker: turn.speaker || null,
        text: typeof turn.text === 'string' ? turn.text : '',
        timestamp: typeof turn.timestamp === 'number' ? turn.timestamp : Date.now(),
    };

    const context = base.context && typeof base.context === 'object' ? { ...base.context } : {};
    base.context = {
        recentTranscript: typeof context.recentTranscript === 'string' ? context.recentTranscript : '',
        candidateProfile: context.candidateProfile ?? null,
        interviewTopic: context.interviewTopic == null
            ? null
            : String(context.interviewTopic),
    };

    if (typeof base.sessionId === 'string') {
        base.sessionId = base.sessionId.trim() || null;
    } else if (base.sessionId == null) {
        base.sessionId = null;
    }
    return base;
}

async function startInsightStream(payload, { signal } = {}) {
    const turnId = payload?.turn?.id;
    const endpoint = buildEndpoint(turnId);

    const headers = {
        'Content-Type': 'application/json',
    };

    const interviewAuth = authService.getInterviewAuthState?.();
    if (interviewAuth?.token) {
        headers.Authorization = `Bearer ${interviewAuth.token}`;
    }

    const normalizedPayload = normalizeStreamPayload(payload || {});

    const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(normalizedPayload),
        signal,
    });

    if (!response.ok) {
        let message = `Insight stream request failed (${response.status})`;
        try {
            const errorBody = await response.text();
            if (errorBody) {
                const parsed = JSON.parse(errorBody);
                message = parsed?.message || parsed?.error || message;
            }
        } catch (_) {}
        throw new Error(message);
    }

    const reader = getReaderFromBody(response.body);
    if (!reader) {
        throw new Error('Streaming reader unavailable from backend response.');
    }

    return reader;
}

module.exports = {
    startInsightStream,
};
