const { TextDecoder } = require('util');
const liveInsightsApi = require('./liveInsightsApi');

class LiveInsightsService {
    constructor({ sendToRenderer, buildStreamPayload } = {}) {
        this.sendToRenderer = sendToRenderer;
        this.buildStreamPayload = typeof buildStreamPayload === 'function' ? buildStreamPayload : null;
        this.currentTurnId = null;
        this.currentSpeaker = null;
        this.currentQuestion = '';
        this.fullAnswer = '';
        this.isStreaming = false;
        this.abortController = null;
        this.reader = null;
        this.decoder = new TextDecoder();
    }

    async handleTranscriptUpdate(turn) {
        console.log('[LiveInsightsService] handleTranscriptUpdate called:', { turnId: turn?.id, speaker: turn?.speaker, text: turn?.text?.slice(0, 50) });
        if (!turn || !turn.text || !turn.text.trim()) {
            console.log('[LiveInsightsService] Skipping: empty turn');
            return;
        }
        if (turn.speaker !== 'Them') {
            console.log('[LiveInsightsService] Skipping: speaker is not Them');
            return;
        }
        if (this.currentTurnId === turn.id && this.currentQuestion === turn.text && this.isStreaming) {
            console.log('[LiveInsightsService] Skipping: duplicate turn, already streaming');
            return;
        }

        if (this.currentTurnId && this.currentTurnId !== turn.id) {
            this.abortStream('new_turn');
        }

        this.currentTurnId = turn.id;
        this.currentSpeaker = turn.speaker;
        this.currentQuestion = turn.text;

        await this.startStream(turn);
    }

    reset() {
        this.abortStream('reset');
        this.currentTurnId = null;
        this.currentSpeaker = null;
        this.currentQuestion = '';
        this.fullAnswer = '';
        this.isStreaming = false;
    }

    abortStream(reason = 'aborted') {
        if (this.abortController) {
            try {
                this.abortController.abort(reason);
            } catch (err) {}
        }
        if (this.reader) {
            try {
                this.reader.cancel(reason).catch(() => {});
            } catch (err) {}
            this.reader = null;
        }
        if (this.isStreaming) {
            this.sendToRenderer('listen:live-answer', {
                turnId: this.currentTurnId,
                status: 'aborted',
                reason,
                answer: this.fullAnswer,
            });
        }
        this.abortController = null;
        this.isStreaming = false;
    }

    async startStream(turn) {
        console.log('[LiveInsightsService] startStream called:', { turnId: turn.id, text: turn.text?.slice(0, 50) });
        try {
            this.abortController = new AbortController();
            const payload = this.buildStreamPayload ? (this.buildStreamPayload(turn) || {}) : {};
            if (!payload.turn) {
                payload.turn = {
                    id: turn.id,
                    speaker: turn.speaker,
                    text: turn.text,
                    timestamp: turn.timestamp || Date.now(),
                };
            }
            console.log('[LiveInsightsService] Calling API with payload:', JSON.stringify(payload).slice(0, 200));
            this.reader = await liveInsightsApi.startInsightStream(payload, { signal: this.abortController.signal });
            console.log('[LiveInsightsService] API returned reader, starting streamLoop');
            this.streamLoop(this.reader, this.abortController.signal, turn.id);
        } catch (error) {
            console.error('[LiveInsightsService] startStream error:', error.message);
            this.sendToRenderer('listen:live-answer', {
                turnId: turn.id,
                status: 'error',
                error: error.message,
            });
            this.reset();
        }
    }

    async streamLoop(reader, signal, turnId) {
        this.isStreaming = true;
        this.fullAnswer = '';
        console.log(`[LiveInsightsService] streamLoop started for turn ${turnId}`);
        this.sendToRenderer('listen:live-answer', {
            turnId,
            status: 'started',
            answer: '',
        });

        signal.addEventListener('abort', () => {
            console.log(`[LiveInsightsService] Stream aborted for turn ${turnId}, reason: ${signal.reason}`);
            if (this.reader) {
                this.reader.cancel(signal.reason).catch(() => {});
            }
        });

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = this.decoder.decode(value);
                this._processChunk(chunk, turnId, reader);
            }
            this.completeStream(turnId);
        } catch (err) {
            if (signal.aborted) {
                this.sendToRenderer('listen:live-answer', {
                    turnId,
                    status: 'aborted',
                    reason: signal.reason,
                    answer: this.fullAnswer,
                });
            } else {
                this.sendToRenderer('listen:live-answer', {
                    turnId,
                    status: 'error',
                    error: err.message,
                });
            }
        } finally {
            this.isStreaming = false;
            this.reader = null;
            this.abortController = null;
        }
    }

    completeStream(turnId) {
        this.sendToRenderer('listen:live-answer', {
            turnId,
            status: 'completed',
            answer: this.fullAnswer,
        });
        this.isStreaming = false;
        this.reader = null;
        this.abortController = null;
    }

    _processChunk(chunk, turnId, reader) {
        const lines = chunk.split('\n');
        let currentEvent = null;

        for (const line of lines) {
            // 解析 event: 行
            if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
                continue;
            }

            if (!line.startsWith('data: ')) {
                // 空行重置事件类型
                if (line.trim() === '') {
                    currentEvent = null;
                }
                continue;
            }

            const data = line.slice(6).trim();
            if (!data) continue;
            if (data === '[DONE]') {
                reader.cancel().catch(() => {});
                this.completeStream(turnId);
                return;
            }

            try {
                const json = JSON.parse(data);

                // 处理 skip 事件：服务端判断问题为语气词，无需处理
                if (currentEvent === 'skip' || json.event === 'skip') {
                    this._handleSkipEvent(json, turnId, reader);
                    currentEvent = null;
                    return;
                }

                if (json.status || json.answer || json.reason || json.error) {
                    this._handleStatusEvent(json, turnId);
                    currentEvent = null;
                    continue;
                }
                const token = json.choices?.[0]?.delta?.content || json.token || '';
                if (token) {
                    this.fullAnswer += token;
                    console.log(`[LiveInsightsService] Received token for turn ${turnId}: ${token.slice(0, 10)}... (Total length: ${this.fullAnswer.length})`);
                    this.sendToRenderer('listen:live-answer', {
                        turnId,
                        status: 'streaming',
                        token,
                        answer: this.fullAnswer,
                    });
                }
            } catch (err) {
                console.error(`[LiveInsightsService] Error parsing chunk for turn ${turnId}:`, err.message);
                continue;
            }
            currentEvent = null;
        }
    }

    _handleSkipEvent(event, turnId, reader) {
        // 取消流读取
        reader.cancel().catch(() => {});

        // 发送 skipped 状态给渲染进程
        this.sendToRenderer('listen:live-answer', {
            turnId: event.turnId || turnId,
            status: 'skipped',
            reason: event.reason || 'acknowledgment',
            confidence: event.confidence,
            method: event.method,
            detectionReason: event.detectionReason,
        });

        // 重置流状态
        this.isStreaming = false;
        this.reader = null;
        this.abortController = null;
    }

    _handleStatusEvent(event, turnId) {
        const payload = {
            turnId,
            status: event.status || 'streaming',
            answer: event.answer ?? this.fullAnswer,
        };

        if (event.reason) {
            payload.reason = event.reason;
        }
        if (event.error) {
            payload.error = event.error;
        }

        if (event.status === 'completed' && typeof event.answer === 'string') {
            this.fullAnswer = event.answer;
            payload.answer = event.answer;
        }

        this.sendToRenderer('listen:live-answer', payload);
    }
}

module.exports = LiveInsightsService;
