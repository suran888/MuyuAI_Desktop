const config = require('../config/config');
const authService = require('./authService');

const fetchImpl = global.fetch || require('node-fetch');

function buildEndpoint() {
    const baseUrl = (config.get('apiUrl') || '').trim().replace(/\/$/, '');
    if (!baseUrl) {
        throw new Error('OSS API base URL is not configured.');
    }
    return `${baseUrl}/api/v1/oss/upload`;
}

async function uploadScreenshot(payload = {}) {
    const { data, mimeType, fileExtension, objectPrefix = 'ask-screenshots' } = payload || {};
    if (!data || typeof data !== 'string') {
        throw new Error('Screenshot upload payload requires a base64 data string.');
    }
    const endpoint = buildEndpoint();

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
        body: JSON.stringify({
            data,
            mimeType,
            fileExtension,
            objectPrefix,
        }),
    });

    if (!response.ok) {
        let message = `OSS upload request failed (${response.status})`;
        try {
            const text = await response.text();
            if (text) {
                const parsed = JSON.parse(text);
                message = parsed?.message || parsed?.error || message;
            }
        } catch (_) {}
        throw new Error(message);
    }

    return response.json();
}

module.exports = {
    uploadScreenshot,
};
