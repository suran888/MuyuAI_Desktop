/*
 - SttService 是监听页（Listen）里的语音转文字总控类，负责双通道会话（我方 Me、对方 Them）的建立、消息处理、渲染端更新、节流与完成判定、会话保活与续期，以及系统音频采集的管理。
 - 依赖关键组件： createSTT （根据提供商创建 STT 连接）、 modelStateService （读取当前 STT 模型与密钥）、 windowManager （向 Listen 窗口发 IPC）。
 */

const { BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const { createSTT, isVirtualOpenAIProvider } = require('../../common/ai/factory');
const modelStateService = require('../../common/services/modelStateService');

const COMPLETION_DEBOUNCE_MS = 2000; // 2 seconds

// ── New heartbeat / renewal constants ────────────────────────────────────────────
// Interval to send low-cost keep-alive messages so the remote service does not
// treat the connection as idle. One minute is safely below the typical 2-5 min
// idle timeout window seen on provider websockets.
const KEEP_ALIVE_INTERVAL_MS = 60 * 1000;         // 1 minute

// Interval after which we pro-actively tear down and recreate the STT sessions
// to dodge the 30-minute hard timeout enforced by some providers. 20 minutes
// gives a 10-minute safety buffer.
const SESSION_RENEW_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

// Duration to allow the old and new sockets to run in parallel so we don't
// miss any packets at the exact swap moment.
const SOCKET_OVERLAP_MS = 2 * 1000; // 2 seconds

class SttService {
    constructor() {
        this.mySttSession = null;
        this.theirSttSession = null;
        this.myCurrentUtterance = '';
        this.theirCurrentUtterance = '';

        // Turn-completion debouncing
        this.myCompletionBuffer = '';
        this.theirCompletionBuffer = '';
        this.myCompletionTimer = null;
        this.theirCompletionTimer = null;

        // Timestamp tracking for new utterance detection
        this.myLastUpdateTime = 0;
        this.theirLastUpdateTime = 0;

        // Track last received complete text from Doubao API (for incremental extraction)
        this.myLastReceivedText = '';
        this.theirLastReceivedText = '';

        // System audio capture
        this.systemAudioProc = null;

        // Keep-alive / renewal timers
        this.keepAliveInterval = null;
        this.sessionRenewTimeout = null;

        // Callbacks
        this.onTranscriptionComplete = null;
        this.onStatusUpdate = null;
        this.onPartialTranscript = null;

        this.modelInfo = null;
    }

    setCallbacks({ onTranscriptionComplete, onStatusUpdate, onPartialTranscript }) {
        this.onTranscriptionComplete = onTranscriptionComplete;
        this.onStatusUpdate = onStatusUpdate;
        this.onPartialTranscript = onPartialTranscript;
        try {
            console.log('[SttService] Callbacks set:', {
                onTranscriptionComplete: typeof onTranscriptionComplete,
                onStatusUpdate: typeof onStatusUpdate,
                onPartialTranscript: typeof onPartialTranscript,
            });
        } catch (e) { }
    }

    emitPartialTranscript(speaker, text, extra = {}) {
        const payload = typeof text === 'object' ? text : { text };
        const normalizedText = payload?.text;

        if (!normalizedText || !normalizedText.trim()) return;

        if (this.onPartialTranscript) {
            try {
                this.onPartialTranscript({
                    speaker,
                    text: normalizedText,
                    timestamp: Date.now(),
                    isPartial: true,
                    isFinal: false,  // 默认值
                    ...extra,  // extra 会覆盖默认值
                    ...payload,  // payload 中的值优先级最高
                });
            } catch (err) {
                console.error('[SttService] Failed to emit partial transcript', err);
            }
        }
    }

    sendToRenderer(channel, data) {
        // Send Listen-related events only to the Listen window (prevents conflicts with Ask window)
        const { windowPool } = require('../../../window/windowManager');
        const listenWindow = windowPool?.get('listen');

        if (listenWindow && !listenWindow.isDestroyed()) {
            listenWindow.webContents.send(channel, data);
        }
    }

    async handleSendSystemAudioContent(data, mimeType) {
        try {
            await this.sendSystemAudioContent(data, mimeType);
            this.sendToRenderer('system-audio-data', { data });
            return { success: true };
        } catch (error) {
            console.error('Error sending system audio:', error);
            return { success: false, error: error.message };
        }
    }

    flushMyCompletion() {
        const finalText = (this.myCompletionBuffer + this.myCurrentUtterance).trim();
        if (!this.modelInfo || !finalText) return;

        // Notify completion callback
        if (this.onTranscriptionComplete) {
            this.onTranscriptionComplete('Me', finalText);
        }

        // Send to renderer as final
        this.sendToRenderer('stt-update', {
            speaker: 'Me',
            text: finalText,
            isPartial: false,
            isFinal: true,
            timestamp: Date.now(),
        });

        this.myCompletionBuffer = '';
        this.myCompletionTimer = null;
        this.myCurrentUtterance = '';

        if (this.onStatusUpdate) {
            this.onStatusUpdate('Listening...');
        }
    }

    flushTheirCompletion() {
        const finalText = (this.theirCompletionBuffer + this.theirCurrentUtterance).trim();
        try {
            console.log('[SttService-Them] flushTheirCompletion invoked', {
                provider: this.modelInfo?.provider,
                bufferLen: (this.theirCompletionBuffer || '').length,
                currentLen: (this.theirCurrentUtterance || '').length,
                finalLen: (finalText || '').length,
            });
        } catch (e) { }
        if (!this.modelInfo || !finalText) {
            try {
                console.log('[SttService-Them] flushTheirCompletion skipped', {
                    hasModelInfo: !!this.modelInfo,
                    finalTextEmpty: !finalText,
                });
            } catch (e) { }
            return;
        }

        // Notify completion callback
        if (this.onTranscriptionComplete) {
            try {
                console.log('[SttService-Them] onTranscriptionComplete firing', { finalText });
            } catch (e) { }
            this.onTranscriptionComplete('Them', finalText);
        }

        // Send to renderer as final
        this.sendToRenderer('stt-update', {
            speaker: 'Them',
            text: finalText,
            isPartial: false,
            isFinal: true,
            timestamp: Date.now(),
        });
        try { console.log('[SttService-Them] stt-update final dispatched'); } catch (e) { }

        // 保存最后完成的 utterance，用于检测下一次是否包含重复内容
        this.theirLastCompletedUtterance = finalText;
        
        this.theirCompletionBuffer = '';
        this.theirCompletionTimer = null;
        this.theirCurrentUtterance = '';
        try { console.log('[SttService-Them] completion buffers reset'); } catch (e) { }

        if (this.onStatusUpdate) {
            this.onStatusUpdate('Listening...');
        }
    }

    debounceMyCompletion(text) {
        if (this.modelInfo?.provider === 'gemini') {
            this.myCompletionBuffer += text;
        } else {
            this.myCompletionBuffer += (this.myCompletionBuffer ? ' ' : '') + text;
        }

        if (this.myCompletionTimer) clearTimeout(this.myCompletionTimer);
        this.myCompletionTimer = setTimeout(() => this.flushMyCompletion(), COMPLETION_DEBOUNCE_MS);
    }

    debounceTheirCompletion(text) {
        if (this.modelInfo?.provider === 'gemini') {
            this.theirCompletionBuffer += text;
        } else {
            this.theirCompletionBuffer += (this.theirCompletionBuffer ? ' ' : '') + text;
        }

        try {
            console.log('[SttService-Them] debounceTheirCompletion called', {
                provider: this.modelInfo?.provider,
                textLen: (text || '').length,
                bufferLen: (this.theirCompletionBuffer || '').length,
            });
        } catch (e) { }

        if (this.theirCompletionTimer) {
            try { console.log('[SttService-Them] clearing previous completion timer'); } catch (e) { }
            clearTimeout(this.theirCompletionTimer);
        }
        try { console.log(`[SttService-Them] setting completion timer ${COMPLETION_DEBOUNCE_MS}ms`); } catch (e) { }
        this.theirCompletionTimer = setTimeout(() => {
            try { console.log('[SttService-Them] completion timer fired'); } catch (e) { }
            this.flushTheirCompletion();
        }, COMPLETION_DEBOUNCE_MS);
    }

    _hasOverlap(current, incoming) {
        if (!current || !incoming) return false;
        const minOverlap = 2;
        const maxOverlap = Math.min(current.length, incoming.length);
        for (let len = maxOverlap; len >= minOverlap; len--) {
            if (current.slice(-len) === incoming.slice(0, len)) {
                return true;
            }
        }
        return false;
    }

    // 计算两个文本之间的重叠长度（用于滑动窗口截断）
    _calculateOverlapLength(oldText, newText) {
        if (!oldText || !newText) return 0;
        // 最长可能重叠长度
        const maxPossible = Math.min(oldText.length, newText.length);
        // 至少重叠2个字符才算
        const minOverlap = 2;
        
        for (let len = maxPossible; len >= minOverlap; len--) {
            if (oldText.slice(-len) === newText.slice(0, len)) {
                return len;
            }
        }
        return 0;
    }

    // 检测两个文本是否有共同的开头（用于判断滑动窗口是否重置）
    _hasCommonStart(text1, text2, minLength = 10) {
        if (!text1 || !text2 || text1.length < minLength || text2.length < minLength) {
            return false;
        }
        // 检查 text1 的开头是否出现在 text2 的开头
        const start1 = text1.slice(0, minLength).toLowerCase();
        const start2 = text2.slice(0, minLength).toLowerCase();
        // 互相包含或相等
        return start1 === start2 || start1.includes(start2) || start2.includes(start1);
    }

    _extractIncrementalText(lastReceived, newComplete) {
        if (!lastReceived) {
            // First time receiving text, return the complete text
            console.log('[SttService] _extractIncrementalText: first text, returning complete');
            return newComplete;
        }

        if (!newComplete) {
            return '';
        }

        // If newComplete starts with lastReceived, extract the new part
        if (newComplete.startsWith(lastReceived)) {
            const incremental = newComplete.slice(lastReceived.length).trim();
            console.log('[SttService] _extractIncrementalText: extracted incremental', {
                lastLength: lastReceived.length,
                newLength: newComplete.length,
                incrementalLength: incremental.length,
                incremental: incremental.slice(0, 50)
            });
            return incremental;
        }

        // If newComplete is completely different (new utterance detected elsewhere)
        // or doesn't start with lastReceived, return the complete new text
        console.log('[SttService] _extractIncrementalText: new text doesn\'t start with last, returning complete');
        return newComplete;
    }

    _mergeSlidingWindow(current, incoming) {
        if (!current) return incoming;
        if (!incoming) return current;

        // Fast path: incoming extends current (normal accumulation)
        if (incoming.startsWith(current)) {
            console.log('[SttService] _mergeSlidingWindow: incoming extends current');
            return incoming;
        }

        // Overlap check: find longest suffix of current that matches prefix of incoming
        const maxOverlap = Math.min(current.length, incoming.length);
        const minOverlap = 2; // Minimum overlap to consider valid stitching

        for (let len = maxOverlap; len >= minOverlap; len--) {
            if (current.slice(-len) === incoming.slice(0, len)) {
                console.log('[SttService] _mergeSlidingWindow: found overlap of length', len);
                return current + incoming.slice(len);
            }
        }

        // Fallback: Text is different but no clear overlap
        // This could be:
        // 1. A correction from the API (e.g., "Ideas" -> "Videos")
        // 2. A completely new segment
        // Strategy: Check if incoming contains the essence of current
        
        // If current is contained within incoming (even with corrections before/after), use incoming
        if (incoming.includes(current.slice(0, Math.min(current.length, 20)))) {
            // Incoming likely contains the corrected/extended version
            console.log('[SttService] _mergeSlidingWindow: incoming contains current start, using incoming');
            return incoming;
        }
        
        // If incoming is significantly longer, it likely has more content
        if (incoming.length > current.length) {
            console.log('[SttService] _mergeSlidingWindow: incoming is longer, replacing');
            return incoming;
        }
        
        // Default: trust the API's latest result
        console.log('[SttService] _mergeSlidingWindow: default to incoming (API latest)');
        return incoming;
    }

    async initializeSttSessions(language = 'zh') {
        const effectiveLanguage = process.env.OPENAI_TRANSCRIBE_LANG || language || 'zh';

        const modelInfo = await modelStateService.getCurrentModelInfo('stt');
        if (!modelInfo || !modelInfo.apiKey) {
            throw new Error('AI model or API key is not configured.');
        }
        this.modelInfo = modelInfo;
        console.log(`[SttService] Initializing STT for ${modelInfo.provider} using model ${modelInfo.model}`);

        const handleMyMessage = message => {
            if (!this.modelInfo) {
                console.log('[SttService] Ignoring message - session already closed');
                return;
            }
            // console.log('[SttService] handleMyMessage', message);

            if (this.modelInfo.provider === 'whisper') {
                // Whisper STT emits 'transcription' events with different structure
                if (message.text && message.text.trim()) {
                    const finalText = message.text.trim();

                    // Filter out Whisper noise transcriptions
                    const noisePatterns = [
                        '[BLANK_AUDIO]',
                        '[INAUDIBLE]',
                        '[MUSIC]',
                        '[SOUND]',
                        '[NOISE]',
                        '(BLANK_AUDIO)',
                        '(INAUDIBLE)',
                        '(MUSIC)',
                        '(SOUND)',
                        '(NOISE)'
                    ];

                    const isNoise = noisePatterns.some(pattern =>
                        finalText.includes(pattern) || finalText === pattern
                    );


                    if (!isNoise && finalText.length > 2) {
                        this.debounceMyCompletion(finalText);

                        this.sendToRenderer('stt-update', {
                            speaker: 'Me',
                            text: finalText,
                            isPartial: false,
                            isFinal: true,
                            timestamp: Date.now(),
                        });
                    } else {
                        console.log(`[Whisper-Me] Filtered noise: "${finalText}"`);
                    }
                }
                return;
            } else if (this.modelInfo.provider === 'gemini') {
                if (!message.serverContent?.modelTurn) {
                    console.log('[Gemini STT - Me]', JSON.stringify(message, null, 2));
                }

                if (message.serverContent?.turnComplete) {
                    if (this.myCompletionTimer) {
                        clearTimeout(this.myCompletionTimer);
                        this.flushMyCompletion();
                    }
                    return;
                }

                const transcription = message.serverContent?.inputTranscription;
                if (!transcription || !transcription.text) return;

                const textChunk = transcription.text;
                if (!textChunk.trim() || textChunk.trim() === '<noise>') {
                    return; // 1. Ignore whitespace-only chunks or noise
                }

                this.debounceMyCompletion(textChunk);

                this.sendToRenderer('stt-update', {
                    speaker: 'Me',
                    text: this.myCompletionBuffer,
                    isPartial: true,
                    isFinal: false,
                    timestamp: Date.now(),
                });

                this.emitPartialTranscript('Me', {
                    text: this.myCompletionBuffer,
                    provider: this.modelInfo?.provider,
                    isFinal: false
                });

                // Deepgram 
            } else if (this.modelInfo.provider === 'deepgram' || this.modelInfo.provider === 'doubao') {
                let text;
                let isFinal = false;

                if (this.modelInfo.provider === 'deepgram') {
                    text = message.channel?.alternatives?.[0]?.transcript;
                    isFinal = message.is_final;
                    if (!text || text.trim().length === 0) return;
                    console.log(`[SttService-Me-Deepgram] Received: isFinal=${isFinal}, text="${text}"`);
                } else {
                    text = message.text || message.transcript || message.raw?.result?.text;
                    if (!text || text.trim().length === 0) return;
                    isFinal = message.isFinal ?? false;
                    console.log(`[SttService-Me-Doubao] Received: isFinal=${isFinal}, text="${text}"`);
                }

                if (isFinal) {
                    // When the final result arrives, clear the current partial utterance
                    // and run debounce with the final text.
                    this.myCurrentUtterance = '';
                    this.debounceMyCompletion(text);
                    if (this.modelInfo.provider === 'doubao') {
                        this.flushMyCompletion();
                    } else {
                        // For Deepgram/others that send isFinal but don't auto-flush in flushMyCompletion logic
                        this.sendToRenderer('stt-update', {
                            speaker: 'Me',
                            text: text,
                            isPartial: false,
                            isFinal: true,
                            timestamp: Date.now(),
                        });
                        this.emitPartialTranscript('Me', {
                            text: text,
                            provider: this.modelInfo?.provider,
                            isFinal: true
                        });
                    }
                } else {
                    // For interim results, update the UI in real-time.
                    if (this.myCompletionTimer) clearTimeout(this.myCompletionTimer);

                    // 简化策略：新 Utterance 检测（豆包滑动窗口机制）
                    const now = Date.now();
                    const currentUtterance = this.myCurrentUtterance || '';
                    
                    // 核心逻辑：
                    // 1. 如果旧文本 > 20 字符
                    // 2. 且新文本不以旧文本前 15 个字符开头（说明是滑动窗口重置）
                    // 3. 且不是完全重复
                    // → 判定为新 utterance
                    
                    const isSignificantlyLong = currentUtterance.length > 20;
                    const isExtension = text.startsWith(currentUtterance.slice(0, 15));
                    const isDuplicate = currentUtterance === text || 
                                       (currentUtterance.length > 5 && text.length > 5 && 
                                        currentUtterance.includes(text));
                    
                    // 简化判断：长文本 + 不是扩展 + 不是重复 = 新 utterance
                    const isNewUtterance = isSignificantlyLong && !isExtension && !isDuplicate;
                    
                    if (isNewUtterance) {
                        // 计算重叠长度，截断新文本的重复部分
                        const overlapLen = this._calculateOverlapLength(currentUtterance, text);
                        const uniquePart = overlapLen > 0 ? text.slice(overlapLen).trim() : text;
                        
                        console.log('[SttService-Me-Doubao] NEW UTTERANCE DETECTED:', {
                            currentLength: currentUtterance.length,
                            newLength: text.length,
                            isExtension,
                            isDuplicate,
                            overlapLen,
                            uniquePart: uniquePart.slice(0, 50)
                        });
                        
                        // 1. 先发送 finalize 事件，完成当前 turn
                        const finalText = (this.myCompletionBuffer + ' ' + currentUtterance).trim();
                        this.emitPartialTranscript('Me', {
                            text: finalText,
                            provider: this.modelInfo?.provider,
                            isFinal: true  // 标记为 final，触发 finalizeTurn
                        });
                        
                        // 2. 清空 buffer 和 current，开始新的 utterance
                        this.myCompletionBuffer = '';
                        this.myCurrentUtterance = uniquePart;
                        this.myLastReceivedText = ''; // 重置，开始新的轮次
                        
                        // 3. 发送新 utterance 的 partial 事件
                        this.emitPartialTranscript('Me', {
                            text: uniquePart,
                            provider: this.modelInfo?.provider,
                            isFinal: false
                        });
                    } else {
                        // 使用滑动窗口合并策略
                        // 这个函数会处理：
                        // 1. 正常累积（新文本以旧文本开头）
                        // 2. 滑动窗口重置（新文本和旧文本有重叠）
                        // 3. 完全不同（应该由混合策略处理，这里会替换）
                        const beforeMerge = this.myCurrentUtterance;
                        this.myCurrentUtterance = this._mergeSlidingWindow(this.myCurrentUtterance, text);
                        
                        console.log('[SttService-Me-Doubao] Merged text:', {
                            beforeLength: beforeMerge.length,
                            afterLength: this.myCurrentUtterance.length,
                            newTextLength: text.length,
                            beforeText: beforeMerge.slice(-30),
                            afterText: this.myCurrentUtterance.slice(-30),
                        });
                        
                        const continuousText = (this.myCompletionBuffer + ' ' + this.myCurrentUtterance).trim();

                        this.sendToRenderer('stt-update', {
                            speaker: 'Me',
                            text: continuousText,
                            isPartial: true,
                            isFinal: false,
                            timestamp: Date.now(),
                        });

                        this.emitPartialTranscript('Me', {
                            text: continuousText,
                            provider: this.modelInfo?.provider,
                        });
                    }

                    // Set completion timer to auto-complete after silence
                    this.myCompletionTimer = setTimeout(() => {
                        this.flushMyCompletion();
                    }, COMPLETION_DEBOUNCE_MS);
                }

            } else {
                const type = message.type;
                const text = message.transcript || message.delta || (message.alternatives && message.alternatives[0]?.transcript) || '';

                if (type === 'conversation.item.input_audio_transcription.delta') {
                    if (this.myCompletionTimer) clearTimeout(this.myCompletionTimer);
                    this.myCompletionTimer = null;
                    this.myCurrentUtterance += text;
                    const continuousText = this.myCompletionBuffer + (this.myCompletionBuffer ? ' ' : '') + this.myCurrentUtterance;
                    if (text && !text.includes('vq_lbr_audio_')) {
                        this.sendToRenderer('stt-update', {
                            speaker: 'Me',
                            text: continuousText,
                            isPartial: true,
                            isFinal: false,
                            timestamp: Date.now(),
                        });
                    }
                    this.emitPartialTranscript('Me', {
                        text: continuousText,
                        provider: this.modelInfo?.provider,
                    });
                } else if (type === 'conversation.item.input_audio_transcription.completed') {
                    if (text && text.trim()) {
                        const finalUtteranceText = text.trim();
                        this.myCurrentUtterance = '';
                        this.debounceMyCompletion(finalUtteranceText);
                    }
                }
            }

            if (message.error) {
                console.error('[Me] STT Session Error:', message.error);
            }
        };

        const handleTheirMessage = message => {
            console.log('------------------- handleTheirMessage message.text:', message.text);
            if (!message || typeof message !== 'object') return;

            if (!this.modelInfo) {
                console.log('[SttService] Ignoring message - session already closed');
                return;
            }

            if (this.modelInfo.provider === 'whisper') {
                // Whisper STT emits 'transcription' events with different structure
                if (message.text && message.text.trim()) {
                    const finalText = message.text.trim();

                    // Filter out Whisper noise transcriptions
                    const noisePatterns = [
                        '[BLANK_AUDIO]',
                        '[INAUDIBLE]',
                        '[MUSIC]',
                        '[SOUND]',
                        '[NOISE]',
                        '(BLANK_AUDIO)',
                        '(INAUDIBLE)',
                        '(MUSIC)',
                        '(SOUND)',
                        '(NOISE)'
                    ];

                    const isNoise = noisePatterns.some(pattern =>
                        finalText.includes(pattern) || finalText === pattern
                    );


                    // Only process if it's not noise, not a false positive, and has meaningful content
                    if (!isNoise && finalText.length > 2) {
                        this.debounceTheirCompletion(finalText);

                        this.sendToRenderer('stt-update', {
                            speaker: 'Them',
                            text: finalText,
                            isPartial: false,
                            isFinal: true,
                            timestamp: Date.now(),
                        });
                    } else {
                        console.log(`[Whisper-Them] Filtered noise: "${finalText}"`);
                    }
                }
                return;
            } else if (this.modelInfo.provider === 'gemini') {
                if (!message.serverContent?.modelTurn) {
                    console.log('[Gemini STT - Them]', JSON.stringify(message, null, 2));
                }

                if (message.serverContent?.turnComplete) {
                    if (this.theirCompletionTimer) {
                        clearTimeout(this.theirCompletionTimer);
                        this.flushTheirCompletion();
                    }
                    return;
                }

                const transcription = message.serverContent?.inputTranscription;
                if (!transcription || !transcription.text) return;

                const textChunk = transcription.text;
                if (!textChunk.trim() || textChunk.trim() === '<noise>') {
                    return; // 1. Ignore whitespace-only chunks or noise
                }

                this.debounceTheirCompletion(textChunk);

                this.sendToRenderer('stt-update', {
                    speaker: 'Them',
                    text: this.theirCompletionBuffer,
                    isPartial: true,
                    isFinal: false,
                    timestamp: Date.now(),
                });

                this.emitPartialTranscript('Them', {
                    text: this.theirCompletionBuffer,
                    provider: this.modelInfo?.provider,
                });

                // Deepgram
            } else if (this.modelInfo.provider === 'deepgram' || this.modelInfo.provider === 'doubao') {
                let text;
                let isFinal = false;

                if (this.modelInfo.provider === 'deepgram') {
                    text = message.channel?.alternatives?.[0]?.transcript;
                    if (!text || text.trim().length === 0) return;
                    isFinal = message.is_final;
                    console.log(`[SttService-Them-Deepgram] Received: isFinal=${isFinal}, text="${text}"`);
                } else {
                    text = message.text || message.transcript || message.raw?.result?.text;
                    if (!text || text.trim().length === 0) return;
                    isFinal = message.isFinal ?? false;
                    console.log(`[SttService-Them-Doubao] Received: isFinal=${isFinal}, text="${text}"`);
                }

                if (isFinal) {
                    try { console.log('[SttService-Them-Doubao] Final received; flushing immediately'); } catch (e) { }
                    
                    // 1. 先清除定时器，避免竞态条件
                    if (this.theirCompletionTimer) {
                        try { console.log('[SttService-Them-Doubao] clearing previous completion timer'); } catch (e) { }
                        clearTimeout(this.theirCompletionTimer);
                        this.theirCompletionTimer = null;
                    }
                    
                    // 2. 更新状态并 flush
                    // 注意：debounceTheirCompletion 会把 text 添加到 buffer
                    // flushTheirCompletion 会合并 buffer + currentUtterance
                    // 所以这里清空 currentUtterance，避免 text 被重复计算
                    this.theirCurrentUtterance = '';
                    this.debounceTheirCompletion(text);
                    if (this.modelInfo.provider === 'doubao') {
                        this.flushTheirCompletion();
                    }
                } else {
                    // ========== isFinal=false: 处理中间结果 ==========
                    try { console.log('[SttService-Them-Doubao] Partial received; processing interim result'); } catch (e) { }
                    
                    if (this.theirCompletionTimer) {
                        try { console.log('[SttService-Them-Doubao] clearing previous completion timer'); } catch (e) { }
                        clearTimeout(this.theirCompletionTimer);
                    }

                    // 更新当前识别内容（用于后续 flush 时计算 finalText）
                    this.theirCurrentUtterance = text;

                    // 计算当前展示文本：buffer + 当前识别内容
                    const continuousText = (this.theirCompletionBuffer + ' ' + text).trim();

                    // 1. 同步到 UI（显示中间结果）
                    this.sendToRenderer('stt-update', {
                        speaker: 'Them',
                        text: continuousText,
                        isPartial: true,
                        isFinal: false,
                        timestamp: Date.now(),
                    });

                    // 2. 发送事件给 listenService 处理 turn 管理
                    this.emitPartialTranscript('Them', {
                        text: continuousText,
                        provider: this.modelInfo?.provider,
                    });

                    // 3. 启动自动完成倒计时（如果在2秒内没有收到新的识别结果，则自动完成）
                    const COMPLETION_DEBOUNCE_MS = this.modelInfo.provider === 'doubao' ? 2000 : 800;
                    try { console.log(`[SttService-Them-Doubao] setting completion timer ${COMPLETION_DEBOUNCE_MS}ms (interim)`); } catch (e) { }
                    this.theirCompletionTimer = setTimeout(() => {
                        try { console.log('[SttService-Them-Doubao] completion timer fired (interim path)'); } catch (e) { }
                        this.flushTheirCompletion();
                    }, COMPLETION_DEBOUNCE_MS);
                }

            } else {
                const type = message.type;
                const text = message.transcript || message.delta || (message.alternatives && message.alternatives[0]?.transcript) || '';
                if (type === 'conversation.item.input_audio_transcription.delta') {
                    if (this.theirCompletionTimer) clearTimeout(this.theirCompletionTimer);
                    this.theirCompletionTimer = null;
                    this.theirCurrentUtterance += text;
                    const continuousText = this.theirCompletionBuffer + (this.theirCompletionBuffer ? ' ' : '') + this.theirCurrentUtterance;
                    if (text && !text.includes('vq_lbr_audio_')) {
                        this.sendToRenderer('stt-update', {
                            speaker: 'Them',
                            text: continuousText,
                            isPartial: true,
                            isFinal: false,
                            timestamp: Date.now(),
                        });
                    }
                    this.emitPartialTranscript('Them', {
                        text: continuousText,
                        provider: this.modelInfo?.provider,
                    });
                } else if (type === 'conversation.item.input_audio_transcription.completed') {
                    if (text && text.trim()) {
                        const finalUtteranceText = text.trim();
                        this.theirCurrentUtterance = '';
                        this.debounceTheirCompletion(finalUtteranceText);
                    }
                }
            }

            if (message.error) {
                console.error('[Them] STT Session Error:', message.error);
            }
        };

        const mySttConfig = {
            language: effectiveLanguage,
            callbacks: {
                onmessage: handleMyMessage,
                onerror: error => console.error('My STT session error:', error.message),
                onclose: event => console.log('My STT session closed:', event.reason),
            },
        };

        const theirSttConfig = {
            language: effectiveLanguage,
            callbacks: {
                onmessage: handleTheirMessage,
                onerror: error => console.error('Their STT session error:', error.message),
                onclose: event => console.log('Their STT session closed:', event.reason),
            },
        };

        const isVirtualProvider = isVirtualOpenAIProvider(this.modelInfo.provider);
        const sttOptions = {
            apiKey: this.modelInfo.apiKey,
            language: effectiveLanguage,
            model: this.modelInfo.model,
            usePortkey: isVirtualProvider,
            portkeyVirtualKey: isVirtualProvider ? this.modelInfo.apiKey : undefined,
        };

        // Add sessionType for Whisper to distinguish between My and Their sessions
        const myOptions = { ...sttOptions, callbacks: mySttConfig.callbacks, sessionType: 'my' };
        const theirOptions = { ...sttOptions, callbacks: theirSttConfig.callbacks, sessionType: 'their' };

        [this.mySttSession, this.theirSttSession] = await Promise.all([
            createSTT(this.modelInfo.provider, myOptions),
            createSTT(this.modelInfo.provider, theirOptions),
        ]);

        console.log('✅ Both STT sessions initialized successfully.');

        // ── Setup keep-alive heart-beats ────────────────────────────────────────
        if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = setInterval(() => {
            this._sendKeepAlive();
        }, KEEP_ALIVE_INTERVAL_MS);

        // ── Schedule session auto-renewal ───────────────────────────────────────
        if (this.sessionRenewTimeout) clearTimeout(this.sessionRenewTimeout);
        this.sessionRenewTimeout = setTimeout(async () => {
            try {
                console.log('[SttService] Auto-renewing STT sessions…');
                await this.renewSessions(language);
            } catch (err) {
                console.error('[SttService] Failed to renew STT sessions:', err);
            }
        }, SESSION_RENEW_INTERVAL_MS);

        return true;
    }

    /**
     * Send a lightweight keep-alive to prevent idle disconnects.
     * Currently only implemented for OpenAI provider because Gemini's SDK
     * already performs its own heart-beats.
     */
    _sendKeepAlive() {
        if (!this.isSessionActive()) return;

        if (this.modelInfo?.provider === 'openai') {
            try {
                this.mySttSession?.keepAlive?.();
                this.theirSttSession?.keepAlive?.();
            } catch (err) {
                console.error('[SttService] keepAlive error:', err.message);
            }
        }
    }

    /**
     * Gracefully tears down then recreates the STT sessions. Should be invoked
     * on a timer to avoid provider-side hard timeouts.
     */
    async renewSessions(language = 'zh') {
        if (!this.isSessionActive()) {
            console.warn('[SttService] renewSessions called but no active session.');
            return;
        }

        const oldMySession = this.mySttSession;
        const oldTheirSession = this.theirSttSession;

        console.log('[SttService] Spawning fresh STT sessions in the background…');

        // We reuse initializeSttSessions to create fresh sessions with the same
        // language and handlers. The method will update the session pointers
        // and timers, but crucially it does NOT touch the system audio capture
        // pipeline, so audio continues flowing uninterrupted.
        await this.initializeSttSessions(language);

        // Close the old sessions after a short overlap window.
        setTimeout(() => {
            try {
                oldMySession?.close?.();
                oldTheirSession?.close?.();
                console.log('[SttService] Old STT sessions closed after hand-off.');
            } catch (err) {
                console.error('[SttService] Error closing old STT sessions:', err.message);
            }
        }, SOCKET_OVERLAP_MS);
    }

    async sendMicAudioContent(data, mimeType) {
        // const provider = await this.getAiProvider();
        // const isGemini = provider === 'gemini';

        if (!this.mySttSession) {
            throw new Error('User STT session not active');
        }

        let modelInfo = this.modelInfo;
        if (!modelInfo) {
            console.warn('[SttService] modelInfo not found, fetching on-the-fly as a fallback...');
            modelInfo = await modelStateService.getCurrentModelInfo('stt');
        }
        if (!modelInfo) {
            throw new Error('STT model info could not be retrieved.');
        }

        let payload;
        if (modelInfo.provider === 'gemini') {
            payload = { audio: { data, mimeType: mimeType || 'audio/pcm;rate=24000' } };
        } else if (modelInfo.provider === 'deepgram') {
            payload = Buffer.from(data, 'base64');
        } else {
            payload = data;
        }
        await this.mySttSession.sendRealtimeInput(payload);
    }

    async sendSystemAudioContent(data, mimeType) {
        if (!this.theirSttSession) {
            throw new Error('Their STT session not active');
        }

        let modelInfo = this.modelInfo;
        if (!modelInfo) {
            console.warn('[SttService] modelInfo not found, fetching on-the-fly as a fallback...');
            modelInfo = await modelStateService.getCurrentModelInfo('stt');
        }
        if (!modelInfo) {
            throw new Error('STT model info could not be retrieved.');
        }

        let payload;
        if (modelInfo.provider === 'gemini') {
            payload = { audio: { data, mimeType: mimeType || 'audio/pcm;rate=24000' } };
        } else if (modelInfo.provider === 'deepgram') {
            payload = Buffer.from(data, 'base64');
        } else {
            payload = data;
        }

        await this.theirSttSession.sendRealtimeInput(payload);
    }

    killExistingSystemAudioDump() {
        return new Promise(resolve => {
            console.log('Checking for existing SystemAudioDump processes...');

            const killProc = spawn('pkill', ['-f', 'SystemAudioDump'], {
                stdio: 'ignore',
            });

            killProc.on('close', code => {
                if (code === 0) {
                    console.log('Killed existing SystemAudioDump processes');
                } else {
                    console.log('No existing SystemAudioDump processes found');
                }
                resolve();
            });

            killProc.on('error', err => {
                console.log('Error checking for existing processes (this is normal):', err.message);
                resolve();
            });

            setTimeout(() => {
                killProc.kill();
                resolve();
            }, 2000);
        });
    }

    async startMacOSAudioCapture() {
        if (process.platform !== 'darwin' || !this.theirSttSession) return false;

        await this.killExistingSystemAudioDump();
        console.log('Starting macOS audio capture for "Them"...');

        const { app } = require('electron');
        const path = require('path');
        const systemAudioPath = app.isPackaged
            ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'ui', 'assets', 'SystemAudioDump')
            : path.join(app.getAppPath(), 'src', 'ui', 'assets', 'SystemAudioDump');

        console.log('SystemAudioDump path:', systemAudioPath);

        this.systemAudioProc = spawn(systemAudioPath, [], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        if (!this.systemAudioProc.pid) {
            console.error('Failed to start SystemAudioDump');
            return false;
        }

        console.log('SystemAudioDump started with PID:', this.systemAudioProc.pid);

        const CHUNK_DURATION = 0.1;
        const SAMPLE_RATE = 24000;
        const BYTES_PER_SAMPLE = 2;
        const CHANNELS = 2;
        const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

        let audioBuffer = Buffer.alloc(0);

        // const provider = await this.getAiProvider();
        // const isGemini = provider === 'gemini';

        let modelInfo = this.modelInfo;
        if (!modelInfo) {
            console.warn('[SttService] modelInfo not found, fetching on-the-fly as a fallback...');
            modelInfo = await modelStateService.getCurrentModelInfo('stt');
        }
        if (!modelInfo) {
            throw new Error('STT model info could not be retrieved.');
        }

        this.systemAudioProc.stdout.on('data', async data => {
            audioBuffer = Buffer.concat([audioBuffer, data]);

            while (audioBuffer.length >= CHUNK_SIZE) {
                const chunk = audioBuffer.slice(0, CHUNK_SIZE);
                audioBuffer = audioBuffer.slice(CHUNK_SIZE);

                const monoChunk = CHANNELS === 2 ? this.convertStereoToMono(chunk) : chunk;
                const base64Data = monoChunk.toString('base64');

                this.sendToRenderer('system-audio-data', { data: base64Data });

                if (this.theirSttSession) {
                    try {
                        let payload;
                        if (modelInfo.provider === 'gemini') {
                            payload = { audio: { data: base64Data, mimeType: 'audio/pcm;rate=24000' } };
                        } else if (modelInfo.provider === 'deepgram') {
                            payload = Buffer.from(base64Data, 'base64');
                        } else {
                            payload = base64Data;
                        }

                        await this.theirSttSession.sendRealtimeInput(payload);
                    } catch (err) {
                        console.error('Error sending system audio:', err.message);
                    }
                }
            }
        });

        this.systemAudioProc.stderr.on('data', data => {
            console.error('SystemAudioDump stderr:', data.toString());
        });

        this.systemAudioProc.on('close', code => {
            console.log('SystemAudioDump process closed with code:', code);
            this.systemAudioProc = null;
        });

        this.systemAudioProc.on('error', err => {
            console.error('SystemAudioDump process error:', err);
            this.systemAudioProc = null;
        });

        return true;
    }

    convertStereoToMono(stereoBuffer) {
        const samples = stereoBuffer.length / 4;
        const monoBuffer = Buffer.alloc(samples * 2);

        for (let i = 0; i < samples; i++) {
            const leftSample = stereoBuffer.readInt16LE(i * 4);
            monoBuffer.writeInt16LE(leftSample, i * 2);
        }

        return monoBuffer;
    }

    stopMacOSAudioCapture() {
        if (this.systemAudioProc) {
            console.log('Stopping SystemAudioDump...');
            this.systemAudioProc.kill('SIGTERM');
            this.systemAudioProc = null;
        }
    }

    isSessionActive() {
        return !!this.mySttSession && !!this.theirSttSession;
    }

    async closeSessions() {
        this.stopMacOSAudioCapture();

        // Clear heartbeat / renewal timers
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
        if (this.sessionRenewTimeout) {
            clearTimeout(this.sessionRenewTimeout);
            this.sessionRenewTimeout = null;
        }

        // Clear timers
        if (this.myCompletionTimer) {
            clearTimeout(this.myCompletionTimer);
            this.myCompletionTimer = null;
        }
        if (this.theirCompletionTimer) {
            clearTimeout(this.theirCompletionTimer);
            this.theirCompletionTimer = null;
        }

        const closePromises = [];
        if (this.mySttSession) {
            closePromises.push(this.mySttSession.close());
            this.mySttSession = null;
        }
        if (this.theirSttSession) {
            closePromises.push(this.theirSttSession.close());
            this.theirSttSession = null;
        }

        await Promise.all(closePromises);
        console.log('All STT sessions closed.');

        // Reset state
        this.myCurrentUtterance = '';
        this.theirCurrentUtterance = '';
        this.myCompletionBuffer = '';
        this.theirCompletionBuffer = '';
        this.modelInfo = null;
    }
}

module.exports = SttService;
