const DEFAULT_BASE_URL = normalizeBaseUrl(process.env.MUYUAI_BASE_URL || '');
const DEFAULT_STREAM_PATH = process.env.MUYUAI_STREAM_PATH || '/v1/chat/completions';
const DEFAULT_COMPLETIONS_PATH = process.env.MUYUAI_COMPLETIONS_PATH || '/v1/chat/completions';
const DEFAULT_HEALTH_PATH = process.env.MUYUAI_HEALTH_PATH || '/v1/health';

function normalizeBaseUrl(baseUrl) {
    if (!baseUrl) return '';
    return baseUrl.trim().replace(/\/+$/, '');
}

function resolveUrl({ explicitUrl, baseUrlOverride, defaultPath, required = true }) {
    const trimmedExplicit = (explicitUrl || '').trim();
    if (trimmedExplicit) {
        return trimmedExplicit;
    }

    const baseUrl = normalizeBaseUrl(baseUrlOverride) || DEFAULT_BASE_URL;
    if (!baseUrl) {
        if (required) {
            throw new Error('[MuyuAIProvider] Base URL is not configured. Set MUYUAI_BASE_URL or provide an explicit URL.');
        }
        return '';
    }

    const normalizedPath = defaultPath?.startsWith('/') ? defaultPath : `/${defaultPath || ''}`;
    return `${baseUrl}${normalizedPath}`;
}

function buildHeaders(apiKey, extraHeaders = {}) {
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
}

function buildRequestBody({ model, temperature, maxTokens, messages, stream, metadata }) {
    return JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream,
        metadata,
    });
}

async function parseError(response) {
    const fallback = `(${response.status}) ${response.statusText}`;
    try {
        const data = await response.json();
        return data?.error?.message || data?.message || fallback;
    } catch (err) {
        try {
            const text = await response.text();
            return text || fallback;
        } catch (innerErr) {
            return fallback;
        }
    }
}

class MuyuAIProvider {
    static async validateApiKey(key, { healthUrl, extraHeaders, baseUrl } = {}) {
        if (!key || typeof key !== 'string') {
            return { success: false, error: 'API key is required for the MuyuAI provider.' };
        }

        let targetHealthUrl;
        try {
            targetHealthUrl = resolveUrl({
                explicitUrl: healthUrl,
                baseUrlOverride: baseUrl,
                defaultPath: DEFAULT_HEALTH_PATH,
                required: false,
            });
        } catch (error) {
            return { success: false, error: error.message };
        }

        if (!targetHealthUrl) {
            // Without a health endpoint we cannot validate; treat as soft success.
            return { success: true, warning: 'Health endpoint not configured; skipped live validation.' };
        }

        try {
            const response = await fetch(targetHealthUrl, {
                method: 'GET',
                headers: buildHeaders(key, extraHeaders),
            });

            if (!response.ok) {
                const message = await parseError(response);
                return { success: false, error: message };
            }

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message || 'Network error during validation.' };
        }
    }
}

async function callMuyuAiApi({
    url,
    apiKey,
    body,
    extraHeaders = {},
    expectStream = false,
}) {
    const response = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(apiKey, extraHeaders),
        body,
    });

    if (!response.ok) {
        const message = await parseError(response);
        throw new Error(`[MuyuAIProvider] API error: ${message}`);
    }

    return expectStream ? response : response.json();
}

function createLLM({
    apiKey,
    model = 'kimi-muyu',
    temperature = 0.6,
    maxTokens = 1024,
    baseUrl,
    completionsUrl,
    extraHeaders,
    metadata,
}) {
    const targetUrl = resolveUrl({
        explicitUrl: completionsUrl,
        baseUrlOverride: baseUrl,
        defaultPath: DEFAULT_COMPLETIONS_PATH,
    });

    const callApi = async (messages) => {
        const payload = buildRequestBody({
            model,
            temperature,
            maxTokens,
            messages,
            stream: false,
            metadata,
        });

        const result = await callMuyuAiApi({
            url: targetUrl,
            apiKey,
            body: payload,
            extraHeaders,
        });

        const content = result?.choices?.[0]?.message?.content ?? '';
        return {
            content,
            raw: result,
        };
    };

    return {
        chat: callApi,
        generateContent: callApi,
    };
}

function createStreamingLLM({
    apiKey,
    model = 'kimi-muyu',
    temperature = 0.6,
    maxTokens = 1024,
    baseUrl,
    streamUrl,
    extraHeaders,
    metadata,
}) {
    const targetUrl = resolveUrl({
        explicitUrl: streamUrl,
        baseUrlOverride: baseUrl,
        defaultPath: DEFAULT_STREAM_PATH,
    });

    return {
        streamChat: async (messages) => {
            const payload = buildRequestBody({
                model,
                temperature,
                maxTokens,
                messages,
                stream: true,
                metadata,
            });

            return callMuyuAiApi({
                url: targetUrl,
                apiKey,
                body: payload,
                extraHeaders,
                expectStream: true,
            });
        },
    };
}

function createSTT() {
    throw new Error('MuyuAI provider does not support STT.');
}

module.exports = {
    MuyuAIProvider,
    createLLM,
    createStreamingLLM,
    createSTT,
};
