// providers/kimi.js

const DEFAULT_BASE_URL = 'https://api.moonshot.cn/v1';

class KimiProvider {
    static async validateApiKey(key) {
        if (!key || typeof key !== 'string') {
            return { success: false, error: 'Invalid Kimi API key.' };
        }

        try {
            const response = await fetch(`${DEFAULT_BASE_URL}/models`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${key}`,
                },
            });

            if (response.ok) {
                return { success: true };
            }

            const errorData = await response.json().catch(() => ({}));
            const message =
                errorData.error?.message ||
                errorData.message ||
                `Validation failed with status: ${response.status}`;
            return { success: false, error: message };
        } catch (error) {
            console.error('[KimiProvider] API key validation error:', error);
            return { success: false, error: error.message || 'Network error during validation.' };
        }
    }
}

function buildHeaders(apiKey) {
    return {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
    };
}

function buildRequestBody({ model, temperature, maxTokens, messages, stream }) {
    return JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream,
    });
}

function createLLM({
    apiKey,
    model = 'kimi-k2-turbo-preview',
    temperature = 0.7,
    maxTokens = 2048,
    baseUrl = DEFAULT_BASE_URL,
}) {
    const callApi = async (messages) => {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: buildHeaders(apiKey),
            body: buildRequestBody({
                model,
                temperature,
                maxTokens,
                messages,
                stream: false,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const message =
                errorData.error?.message ||
                errorData.message ||
                `Kimi API error: ${response.status} ${response.statusText}`;
            throw new Error(message);
        }

        const result = await response.json();
        const content = result.choices?.[0]?.message?.content ?? '';

        return {
            content,
            raw: result,
        };
    };

    return {
        chat: callApi,
        generateContent: async (prompt) => {
            const messages = Array.isArray(prompt)
                ? prompt
                : [
                      { role: 'system', content: 'You are Kimi, an assistant.' },
                      { role: 'user', content: prompt },
                  ];
            return callApi(messages);
        },
    };
}

function createStreamingLLM({
    apiKey,
    model = 'kimi-k2-turbo-preview',
    temperature = 0.7,
    maxTokens = 2048,
    baseUrl = DEFAULT_BASE_URL,
}) {
    return {
        streamChat: async (messages) => {
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: buildHeaders(apiKey),
                body: buildRequestBody({
                    model,
                    temperature,
                    maxTokens,
                    messages,
                    stream: true,
                }),
            });

            if (!response.ok) {
                throw new Error(`Kimi API error: ${response.status} ${response.statusText}`);
            }

            return response;
        },
    };
}

function createSTT() {
    throw new Error('Kimi does not support STT functionality.');
}

module.exports = {
    KimiProvider,
    createLLM,
    createStreamingLLM,
    createSTT,
};
