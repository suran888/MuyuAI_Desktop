const WebSocket = require('ws');
const zlib = require('zlib');
const { randomUUID } = require('crypto');
const { EventEmitter } = require('events');
const authService = require('../../services/authService');
const { getEnvironmentDefaults } = require('../../config/constants');

// 改为连接后端代理服务
const envDefaults = getEnvironmentDefaults(process.env.NODE_ENV || 'production');
const DEFAULT_BACKEND_ENDPOINT = process.env.STT_BACKEND_ENDPOINT || envDefaults.STT_BACKEND_ENDPOINT;
const DEFAULT_WS_ENDPOINT = DEFAULT_BACKEND_ENDPOINT; // 保持兼容性
const DEFAULT_RESOURCE_ID = 'volc.bigasr.sauc.duration';

const ProtocolVersion = {
    V1: 0b0001
};

const MessageType = {
    CLIENT_FULL_REQUEST: 0b0001,
    CLIENT_AUDIO_ONLY_REQUEST: 0b0010,
    SERVER_FULL_RESPONSE: 0b1001,
    SERVER_ERROR_RESPONSE: 0b1111
};

const MessageTypeSpecificFlags = {
    NO_SEQUENCE: 0b0000,
    POS_SEQUENCE: 0b0001,
    NEG_SEQUENCE: 0b0010,
    NEG_WITH_SEQUENCE: 0b0011
};

const SerializationType = {
    NO_SERIALIZATION: 0b0000,
    JSON: 0b0001
};

const CompressionType = {
    NONE: 0b0000,
    GZIP: 0b0001
};

function gzipCompress(buffer) {
    return zlib.gzipSync(buffer);
}

function gzipDecompress(buffer) {
    return zlib.gunzipSync(buffer);
}

function buildHeader({ messageType, flags, serialization, compression, reserved = Buffer.from([0x00]) }) {
    const header = Buffer.alloc(4);
    header[0] = (ProtocolVersion.V1 << 4) | 1;
    header[1] = ((messageType & 0x0f) << 4) | (flags & 0x0f);
    header[2] = ((serialization & 0x0f) << 4) | (compression & 0x0f);
    header[3] = reserved[0] ?? 0x00;
    return header;
}

function buildFullClientRequest(seq, payload) {
    const header = buildHeader({
        messageType: MessageType.CLIENT_FULL_REQUEST,
        flags: MessageTypeSpecificFlags.POS_SEQUENCE,
        serialization: SerializationType.JSON,
        compression: CompressionType.GZIP
    });

    const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf-8');
    const compressed = gzipCompress(payloadBytes);

    const body = Buffer.alloc(8);
    body.writeInt32BE(seq, 0);
    body.writeUInt32BE(compressed.length, 4);

    return Buffer.concat([header, body, compressed]);
}

function buildAudioOnlyRequest(seq, segment, isLast = false) {
    const header = buildHeader({
        messageType: MessageType.CLIENT_AUDIO_ONLY_REQUEST,
        flags: isLast ? MessageTypeSpecificFlags.NEG_WITH_SEQUENCE : MessageTypeSpecificFlags.POS_SEQUENCE,
        serialization: SerializationType.NO_SERIALIZATION,
        compression: CompressionType.GZIP
    });

    const compressedSegment = gzipCompress(segment);
    const seqBuffer = Buffer.alloc(4);
    seqBuffer.writeInt32BE(isLast ? -Math.abs(seq) : seq, 0);

    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(compressedSegment.length, 0);

    return Buffer.concat([header, seqBuffer, lengthBuffer, compressedSegment]);
}

function parseResponse(buffer) {
    const response = {
        code: 0,
        event: 0,
        isLastPackage: false,
        payloadSequence: 0,
        payloadSize: 0,
        payloadMsg: null
    };

    if (!buffer || buffer.length < 4) {
        return response;
    }

    const headerSize = buffer[0] & 0x0f;
    const messageType = buffer[1] >> 4;
    const flags = buffer[1] & 0x0f;
    const serialization = buffer[2] >> 4;
    const compression = buffer[2] & 0x0f;

    let payload = buffer.slice(headerSize * 4);

    if (flags & 0x01) {
        response.payloadSequence = payload.readInt32BE(0);
        payload = payload.slice(4);
    }
    if (flags & 0x02) {
        response.isLastPackage = true;
    }
    if (flags & 0x04) {
        response.event = payload.readInt32BE(0);
        payload = payload.slice(4);
    }

    if (messageType === MessageType.SERVER_FULL_RESPONSE) {
        response.payloadSize = payload.readUInt32BE(0);
        payload = payload.slice(4);
    } else if (messageType === MessageType.SERVER_ERROR_RESPONSE) {
        response.code = payload.readInt32BE(0);
        response.payloadSize = payload.readUInt32BE(4);
        payload = payload.slice(8);
    }

    if (payload.length === 0) {
        return response;
    }

    let decompressed = payload;
    if (compression === CompressionType.GZIP) {
        try {
            decompressed = gzipDecompress(payload);
        } catch (err) {
            console.error('[DoubaoSTT] Failed to decompress payload:', err);
            return response;
        }
    }

    if (serialization === SerializationType.JSON) {
        try {
            response.payloadMsg = JSON.parse(decompressed.toString('utf-8'));
        } catch (err) {
            console.error('[DoubaoSTT] Failed to parse JSON payload:', err);
        }
    }

    return response;
}

function extractTranscript(payload) {
    if (!payload || typeof payload !== 'object') return '';

    const direct = payload.text || payload.transcript;
    if (typeof direct === 'string' && direct.trim()) {
        return direct.trim();
    }

    const result = payload.result || {};
    if (typeof result.text === 'string' && result.text.trim()) {
        return result.text.trim();
    }
    if (Array.isArray(result.utterances) && result.utterances.length > 0) {
        const utterance = result.utterances[result.utterances.length - 1];
        if (utterance && typeof utterance.text === 'string' && utterance.text.trim()) {
            return utterance.text.trim();
        }
    }

    const data = payload.data || payload.payload;
    if (data && typeof data.text === 'string' && data.text.trim()) {
        return data.text.trim();
    }

    return '';
}

function resolveCredentials(raw) {
    // 不再需要从环境变量读取豆包密钥,改为使用后端代理
    const envEndpoint = process.env.STT_BACKEND_ENDPOINT;

    // 返回后端代理配置
    return {
        useBackendProxy: true,
        endpoint: envEndpoint || DEFAULT_BACKEND_ENDPOINT
    };
}

class DoubaoSttSession extends EventEmitter {
    constructor(options) {
        super();
        this.credentials = options.credentials;
        this.callbacks = options.callbacks || {};
        this.language = options.language || 'zh';
        this.modelName = options.modelName || 'bigmodel';
        this.endpoint = options.endpoint || DEFAULT_WS_ENDPOINT;
        this.seq = 1;
        this.ws = null;
        this.isReady = false;
        this.closed = false;
        this.buffer = Buffer.alloc(0);
        this.queue = [];
        this.sending = false;
        this.sampleRate = options.sampleRate || 24000;
        this.bytesPerSample = 2;
        this.chunkDurationMs = options.chunkDuration || 200;
        this.chunkBytes = Math.round(this.sampleRate * this.bytesPerSample * (this.chunkDurationMs / 1000));
        this.connectId = options.connectId || randomUUID();
        this.pendingClose = false;
    }

    connect() {
        // 使用后端代理模式(透传),添加用户认证 token
        const { token } = authService.getInterviewAuthState?.() || {};
        const headers = {
            'Authorization': token ? `Bearer ${token}` : '',
            'X-Api-Connect-Id': this.connectId,
            'X-Client-Version': '1.0.0',
            'X-Proxy-Mode': 'passthrough' // 标记为透传模式
        };

        console.log('[DoubaoSTT] Connecting to backend proxy (passthrough mode):', this.endpoint);
        this.ws = new WebSocket(this.endpoint, { headers });

        this.ws.on('open', () => {
            this.handleOpen();
        });

        this.ws.on('message', (data) => {
            this.handleMessage(data);
        });

        this.ws.on('close', (code, reason) => {
            this.handleClose(code, reason);
        });

        this.ws.on('error', (err) => {
            this.handleError(err);
        });
    }

    handleOpen() {
        try {
            const payload = {
                user: { uid: 'glass_user' },
                audio: {
                    format: 'pcm',
                    codec: 'raw',
                    rate: this.sampleRate,
                    bits: 16,
                    channel: 1
                },
                request: {
                    model_name: this.modelName,
                    enable_itn: true,
                    enable_punc: true,
                    enable_ddc: true,
                    show_utterances: true,
                    enable_nonstream: false,
                    result_type: 'full' // 结果返回方式: 设置为"full"全量返回，服务端会自动累加历史文本和修正标点。
                }
            };

            const request = buildFullClientRequest(this.seq, payload);
            this.ws.send(request);
            this.seq += 1;
            if (!this.isReady) {
                this.isReady = true;
                this.emit('ready');
            }
            this.processQueue();
        } catch (error) {
            this.handleError(error);
        }
    }

    handleMessage(data) {
        try {
            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
            const response = parseResponse(buffer);

            if (response.code && response.code !== 0) {
                const error = new Error(`Doubao STT error code: ${response.code}`);
                this.callbacks.onerror?.(error);
                return;
            }

            if (response.payloadMsg) {
                const text = extractTranscript(response.payloadMsg);
                console.log('[DoubaoSTT] --------------------------- text:', text);
                console.log('[DoubaoSTT] --------------------------- response:', response);
                if (text) {
                    let isFinal = response.isLastPackage || !!response.payloadMsg?.is_final || !!response.payloadMsg?.final;
                    const message = {
                        provider: 'doubao',
                        text,
                        isFinal,
                        raw: response.payloadMsg
                    };
                    this.callbacks.onmessage?.(message);
                }
            }

            if (response.isLastPackage && this.pendingClose) {
                this.ws.close(1000, 'Client finished');
            }
        } catch (error) {
            this.handleError(error);
        }
    }

    handleClose(code, reason) {
        if (!this.closed) {
            this.closed = true;
            this.callbacks.onclose?.({ code, reason });
        }
    }

    handleError(err) {
        if (!this.closed) {
            this.callbacks.onerror?.(err);
            this.emit('error', err);
        }
    }

    enqueueChunk(buffer, isLast = false) {
        if (!buffer || buffer.length === 0) {
            if (isLast) {
                this.queue.push({ data: Buffer.alloc(0), isLast: true });
            }
            return;
        }
        this.queue.push({ data: buffer, isLast });
        this.processQueue();
    }

    processQueue() {
        if (this.sending || this.queue.length === 0 || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        this.sending = true;
        const { data, isLast } = this.queue.shift();
        const seq = this.seq;
        const payload = buildAudioOnlyRequest(seq, data, isLast);

        this.ws.send(payload, (err) => {
            this.sending = false;
            if (err) {
                this.handleError(err);
                return;
            }
            if (!isLast) {
                this.seq += 1;
            } else {
                this.pendingClose = true;
            }
            if (this.queue.length > 0) {
                this.processQueue();
            } else if (this.pendingClose && this.ws.readyState === WebSocket.OPEN) {
                // Wait for server final package then close
                setTimeout(() => {
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.close(1000, 'Client finished');
                    }
                }, 500);
            }
        });
    }

    async sendRealtimeInput(audioData) {
        if (this.closed) return;

        let buffer;
        if (typeof audioData === 'string') {
            buffer = Buffer.from(audioData, 'base64');
        } else if (Buffer.isBuffer(audioData)) {
            buffer = audioData;
        } else if (audioData instanceof ArrayBuffer) {
            buffer = Buffer.from(audioData);
        } else if (audioData && audioData.data) {
            buffer = Buffer.from(audioData.data, 'base64');
        } else {
            console.warn('[DoubaoSTT] Unsupported audio payload type.');
            return;
        }

        this.buffer = Buffer.concat([this.buffer, buffer]);

        const threshold = this.chunkBytes || buffer.length;
        while (this.buffer.length >= threshold) {
            const chunk = this.buffer.slice(0, threshold);
            this.buffer = this.buffer.slice(threshold);
            this.enqueueChunk(chunk, false);
        }
    }

    keepAlive() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.ping();
            } catch (error) {
                console.warn('[DoubaoSTT] keepAlive ping failed:', error.message);
            }
        }
    }

    close() {
        if (this.closed) return;
        this.closed = true;

        if (this.buffer.length > 0) {
            this.enqueueChunk(this.buffer, true);
            this.buffer = Buffer.alloc(0);
        } else {
            this.enqueueChunk(Buffer.alloc(0), true);
        }

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // Further closing handled after last response
        } else if (this.ws) {
            try {
                this.ws.close(1000, 'Client closed');
            } catch (error) {
                console.warn('[DoubaoSTT] Error closing websocket:', error.message);
            }
        }
    }
}

class DoubaoProvider {
    static async validateApiKey(key) {
        const creds = resolveCredentials(key);
        if (!creds) {
            return { success: false, error: '未找到豆包凭证。请在 .env 中设置 DOUBAO_APP_KEY / DOUBAO_ACCESS_KEY，或输入 {"appKey":"xxx","accessKey":"xxx"}。' };
        }
        return { success: true };
    }
}

async function createSTT({ apiKey, language = 'zh', callbacks = {}, model = 'doubao-bigmodel' }) {
    const credentials = resolveCredentials(apiKey);
    if (!credentials) {
        throw new Error('Invalid Doubao credentials. Please provide {"appKey":"...","accessKey":"..."}');
    }

    const modelName = model === 'doubao-bigmodel' ? 'bigmodel' : model;

    return new Promise((resolve, reject) => {
        const session = new DoubaoSttSession({
            credentials,
            callbacks,
            language,
            modelName,
            endpoint: credentials.endpoint,
            sampleRate: 24000, // matches current audio pipeline
            chunkDuration: 200
        });

        session.once('ready', () => {
            resolve({
                sendRealtimeInput: (audioData) => session.sendRealtimeInput(audioData),
                keepAlive: () => session.keepAlive(),
                close: () => session.close()
            });
        });

        session.once('error', (err) => {
            reject(err);
        });

        session.connect();
    });
}

module.exports = {
    DoubaoProvider,
    createSTT
};
