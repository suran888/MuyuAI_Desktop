// Lazy require helper to avoid circular dependency issues
const getWindowManager = () => require('../../window/windowManager');
const internalBridge = require('../../bridge/internalBridge');
const askApi = require('./askApi');
const ossApi = require('../common/services/ossApi');

const getWindowPool = () => {
    try {
        return getWindowManager().windowPool;
    } catch {
        return null;
    }
};

const sessionRepository = require('../common/repositories/session');
const askRepository = require('./repositories');
const path = require('node:path');
const fs = require('node:fs');
const os = require('os');
const { promisify, TextDecoder } = require('util');
const execFile = promisify(require('child_process').execFile);
const { desktopCapturer } = require('electron');

// Try to load sharp, but don't fail if it's not available
let sharp;
try {
    sharp = require('sharp');
    console.log('[AskService] Sharp module loaded successfully');
} catch (error) {
    console.warn('[AskService] Sharp module not available:', error.message);
    console.warn('[AskService] Screenshot functionality will work with reduced image processing capabilities');
    sharp = null;
}
async function captureScreenshot(options = {}) {
    if (process.platform === 'darwin') {
        try {
            const tempPath = path.join(os.tmpdir(), `screenshot-${Date.now()}.jpg`);

            await execFile('screencapture', ['-x', '-t', 'jpg', tempPath]);

            const imageBuffer = await fs.promises.readFile(tempPath);
            await fs.promises.unlink(tempPath);

            if (sharp) {
                try {
                    // Resize + compress to keep clarity without exceeding payload limits
                    const baseImage = sharp(imageBuffer);
                    const metadata = await baseImage.metadata();
                    const targetHeight = 900;
                    const processedBuffer = await baseImage
                        .clone()
                        .resize({ height: targetHeight, withoutEnlargement: true })
                        .jpeg({ quality: 85 })
                        .toBuffer();

                    const resizedMeta = await sharp(processedBuffer).metadata();

                    return {
                        success: true,
                        buffer: processedBuffer,
                        width: resizedMeta.width ?? metadata.width ?? null,
                        height: resizedMeta.height ?? metadata.height ?? null,
                        mimeType: 'image/jpeg',
                    };
                } catch (sharpError) {
                    console.warn('Sharp module failed, falling back to basic image processing:', sharpError.message);
                }
            }

            // Fallback: Return the original image without resizing
            console.log('[AskService] Using fallback image processing (no resize/compression)');
            return {
                success: true,
                buffer: imageBuffer,
                width: null,
                height: null,
                mimeType: 'image/jpeg',
            };
        } catch (error) {
            console.error('Failed to capture screenshot:', error);
            return { success: false, error: error.message };
        }
    }

    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: {
                width: 1920,
                height: 1080,
            },
        });

        if (sources.length === 0) {
            throw new Error('No screen sources available');
        }
        const source = sources[0];
        const buffer = source.thumbnail.toJPEG(70);
        const size = source.thumbnail.getSize();

        return {
            success: true,
            buffer,
            width: size.width,
            height: size.height,
            mimeType: 'image/jpeg',
        };
    } catch (error) {
        console.error('Failed to capture screenshot using desktopCapturer:', error);
        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * @class
 * @description
 */
class AskService {
    constructor() {
        this.abortController = null;
        this.state = {
            isVisible: false,
            isLoading: false,
            isStreaming: false,
            currentQuestion: '',
            currentResponse: '',
            showTextInput: true,
        };
        // Add tracking for screenshot window state
        this.screenshotState = {
            isVisible: false
        };
        console.log('[AskService] Service instance created.');
    }

    _broadcastState() {
        const windowPool = getWindowPool();
        if (!windowPool) return;

        const askWindow = windowPool.get('ask');
        if (askWindow && !askWindow.isDestroyed()) {
            askWindow.webContents.send('ask:stateUpdate', this.state);
        }
    }
    
    /**
     * Process a question from the Main Interface Input Panel
     * @param {string} question 
     */
    async askInInputPanel(question) {
        const trimmedPrompt = (question || '').trim();
        if (!trimmedPrompt) return { success: false, error: 'Empty question' };

        const windowPool = getWindowPool();
        // We broadcast to all relevant windows that might host the InputPanel
        const broadcastStreamUpdate = (payload) => {
            ['main', 'header', 'listen'].forEach(winName => {
                const win = windowPool?.get(winName);
                if (win && !win.isDestroyed()) {
                    win.webContents.send('ask:input-panel-stream', payload);
                }
            });
        };

        // 1. Reset previous answer state in frontend
        broadcastStreamUpdate({ status: 'start', text: '' });

        // 2. Get Session
        let sessionId;
        try {
            sessionId = await sessionRepository.getOrCreateActive('ask');
            // Optional: save user message to DB
            await askRepository.addAiMessage({ sessionId, role: 'user', content: trimmedPrompt });
        } catch (e) {
            console.error('[AskService] Failed to init session for InputPanel:', e);
        }

        // 3. Build Payload
        const payload = {
            sessionId,
            question: trimmedPrompt,
            context: { conversationHistory: '' },
            attachments: {} // Explicitly requested by user
        };

        const abortController = new AbortController();
        const { signal } = abortController;

        try {
             // 4. Start Stream
             const reader = await askApi.startAskStream(payload, { signal });
             
             const decoder = new TextDecoder();
             let fullResponse = '';
 
             while (true) {
                 const { done, value } = await reader.read();
                 if (done) break;
 
                 const chunk = decoder.decode(value);
                 const lines = chunk.split('\n');
 
                 for (const line of lines) {
                     if (!line.startsWith('data: ')) continue;
                     const data = line.slice(6).trim();
                     if (!data) continue;
                     if (data === '[DONE]') {
                         break;
                     }
 
                     try {
                         const json = JSON.parse(data);
                         if (json.status === 'completed' && typeof json.answer === 'string') {
                            // Final replacement
                             fullResponse = json.answer;
                             broadcastStreamUpdate({ status: 'streaming', text: fullResponse });
                             continue;
                         }
                         const token = json.token || json.choices?.[0]?.delta?.content || '';
                         if (token) {
                             fullResponse += token;
                             broadcastStreamUpdate({ status: 'streaming', text: fullResponse });
                         }
                     } catch (e) { }
                 }
             }
 
             // 5. Finalize
             broadcastStreamUpdate({ status: 'completed', text: fullResponse });
             
             // Optional: save AI response to DB
             if (sessionId && fullResponse) {
                 await askRepository.addAiMessage({ sessionId, role: 'assistant', content: fullResponse });
             }
 
             return { success: true };

        } catch (error) {
            console.error('[AskService] InputPanel ask error:', error);
            broadcastStreamUpdate({ status: 'error', error: error.message });
            return { success: false, error: error.message };
        }
    }

    async toggleAskButton() {
        const askWindow = getWindowPool()?.get('ask');

        if (askWindow && askWindow.isVisible()) {
            internalBridge.emit('window:requestVisibility', { name: 'ask', visible: false });
            this.state.isVisible = false;
        } else {
            console.log('[AskService] Showing hidden Ask window');
            internalBridge.emit('window:requestVisibility', { name: 'ask', visible: true });
            this.state.isVisible = true;
        }
        if (this.state.isVisible) {
            this.state.showTextInput = true;
            this._broadcastState();
        }
    }

    async closeAskWindow() {
        if (this.abortController) {
            this.abortController.abort('Window closed by user');
            this.abortController = null;
        }

        this.state = {
            isVisible: false,
            isLoading: false,
            isStreaming: false,
            currentQuestion: '',
            currentResponse: '',
            showTextInput: true,
        };
        this._broadcastState();

        internalBridge.emit('window:requestVisibility', { name: 'ask', visible: false });

        return { success: true };
    }

    /**
     * Toggle screenshot window: open and analyze if closed, close if open
     */
    async toggleScreenshotWindow() {
        const screenshotWin = getWindowPool()?.get('screenshot');
        const isVisible = this.screenshotState.isVisible || (screenshotWin && !screenshotWin.isDestroyed() && screenshotWin.isVisible());

        if (isVisible) {
            return await this.closeScreenshotWindow();
        } else {
            return await this.analyzeScreenshot();
        }
    }

    /**
     * Close screenshot window and abort current analysis
     */
    async closeScreenshotWindow() {
        console.log('[AskService] Closing screenshot window...');
        this.screenshotState.isVisible = false;

        if (this.screenshotAbortController) {
            this.screenshotAbortController.abort('Window closed by user');
            this.screenshotAbortController = null;
        }

        internalBridge.emit('window:requestVisibility', { name: 'screenshot', visible: false });

        // Reset state
        const screenshotState = {
            isLoading: false,
            isStreaming: false,
            currentResponse: '',
        };
        this._broadcastScreenshotState(screenshotState);

        return { success: true };
    }


    /**
     * Analyze screenshot: capture, upload, and get AI analysis
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async analyzeScreenshot() {
        console.log('[AskService] Starting screenshot analysis...');
        this.screenshotState.isVisible = true;

        // 1. Show ScreenshotView window
        internalBridge.emit('window:requestVisibility', { name: 'screenshot', visible: true });

        // 2. Set loading state
        const screenshotState = {
            isLoading: true,
            isStreaming: false,
            currentResponse: '',
        };
        this._broadcastScreenshotState(screenshotState);

        if (this.screenshotAbortController) {
            this.screenshotAbortController.abort('New screenshot analysis request.');
        }
        this.screenshotAbortController = new AbortController();
        const { signal } = this.screenshotAbortController;

        try {
            // 3. Capture screenshot
            console.log('[AskService] Capturing screenshot...');
            const screenshotResult = await captureScreenshot({ quality: 'medium' });
            if (!screenshotResult.success) {
                throw new Error(screenshotResult.error || 'Screenshot capture failed');
            }

            // 4. Upload to OSS
            console.log('[AskService] Uploading screenshot to OSS...');
            const uploadedScreenshot = await this._uploadScreenshotToOss(screenshotResult);
            if (!uploadedScreenshot || !uploadedScreenshot.url) {
                throw new Error('Screenshot upload failed');
            }

            console.log('[AskService] Screenshot uploaded:', uploadedScreenshot.url);

            // 5. Get or create session
            const sessionId = await sessionRepository.getOrCreateActive('ask');
            await askRepository.addAiMessage({
                sessionId,
                role: 'user',
                content: '截屏分析请求'
            });

            // 6. Call screenshot analysis API
            const payload = {
                sessionId,
                imageUrl: uploadedScreenshot.url
            };

            console.log('[AskService] Calling screenshot analysis API...');
            const reader = await askApi.startScreenshotAnalysis(payload, { signal });

            const screenshotWin = getWindowPool()?.get('screenshot');
            if (!screenshotWin || screenshotWin.isDestroyed()) {
                console.error('[AskService] Screenshot window is not available.');
                if (typeof reader.cancel === 'function') {
                    reader.cancel('screenshot-window-missing').catch(() => { });
                }
                return { success: false, error: 'Screenshot window is not available.' };
            }

            signal.addEventListener('abort', () => {
                console.log(`[AskService] Aborting screenshot analysis. Reason: ${signal.reason}`);
                reader.cancel(signal.reason).catch(() => { /* ignore */ });
            });

            // 7. Process streaming response
            await this._processScreenshotStream(reader, screenshotWin, sessionId, signal);

            return { success: true };

        } catch (error) {
            console.error('[AskService] Screenshot analysis error:', error);

            const screenshotWin = getWindowPool()?.get('screenshot');
            if (screenshotWin && !screenshotWin.isDestroyed()) {
                const errorMessage = error.message || 'Screenshot analysis failed';
                screenshotWin.webContents.send('screenshot-stream-error', { error: errorMessage });
            }

            return { success: false, error: error.message };
        }
    }

    _broadcastScreenshotState(state) {
        const windowPool = getWindowPool();
        if (!windowPool) return;

        ['screenshot', 'header', 'main'].forEach(winName => {
            const win = windowPool.get(winName);
            if (win && !win.isDestroyed()) {
                win.webContents.send('screenshot:stateUpdate', state);
            }
        });
    }

    async _processScreenshotStream(reader, win, sessionId, signal) {
        const decoder = new TextDecoder();
        let accumulatedText = '';
        let buffer = ''; // Buffer to handle split chunks

        try {
            let shouldStop = false;
            while (!shouldStop) {
                const { done, value } = await reader.read();

                if (signal.aborted) {
                    console.log('[AskService] Screenshot stream aborted by signal.');
                    break;
                }

                if (done) {
                    console.log('[AskService] Screenshot stream complete.');
                    break;
                }

                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                // Check if we are dealing with SSE or raw text
                // Simple heuristic: if we see "data:" or "event:" at the start of the buffer
                const isSSE = /^(data|event|id|retry):/m.test(buffer);

                if (isSSE) {
                    const lines = buffer.split(/\r?\n/);
                    // Keep the last line in buffer if it's not empty (it might be incomplete)
                    buffer = lines.pop() || ''; 

                    let currentEvent = null;
                    let currentData = '';

                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            currentEvent = line.slice(7).trim();
                        } else if (line.startsWith('data: ')) {
                            currentData = line.slice(6).trim();
                        } else if (line.trim() === '') {
                            // Empty line triggers the event dispatch
                            if (currentData) {
                                // Special case: [DONE]
                                if (currentData === '[DONE]') {
                                    shouldStop = true;
                                    break;
                                }

                                try {
                                    const json = JSON.parse(currentData);
                                    
                                    // Handle specific event types from server example
                                    if (currentEvent === 'token' || !currentEvent) {
                                        // Support both {token: "..."} (new) and choices format (openai)
                                        const token = json.token || json.choices?.[0]?.delta?.content || '';
                                        if (token) {
                                            accumulatedText += token;
                                            this._broadcastScreenshotState({
                                                isLoading: false,
                                                isStreaming: true,
                                                currentResponse: accumulatedText,
                                            });
                                        }
                                    } else if (currentEvent === 'status') {
                                        if (json.status === 'completed') {
                                            if (json.answer) {
                                                 accumulatedText = json.answer; 
                                            }
                                            this._broadcastScreenshotState({
                                                isLoading: false,
                                                isStreaming: true,
                                                currentResponse: accumulatedText,
                                            });
                                        } else if (json.status === 'error' || json.error) {
                                            throw new Error(typeof json.error === 'string' ? json.error : JSON.stringify(json.error));
                                        }
                                    } else if (currentEvent === 'error') {
                                        throw new Error(json.message || (typeof json.error === 'string' ? json.error : JSON.stringify(json.error)) || 'Screenshot stream reported an error event');
                                    }
                                    
                                    // Fallback for generic "data only" messages
                                    if (!currentEvent) {
                                         if (json.status === 'completed' && json.answer) {
                                             accumulatedText = json.answer;
                                             this._broadcastScreenshotState({
                                                isLoading: false,
                                                isStreaming: true,
                                                currentResponse: accumulatedText,
                                            });
                                         }
                                    }

                                } catch (e) {
                                    // If it's a JSON parse error, warn and continue (maybe just a glitch)
                                    if (e instanceof SyntaxError) {
                                        console.warn('[AskService] Failed to parse SSE JSON:', e, currentData);
                                    } else {
                                        // If it's a logic error (like we threw above), we should stop the stream and notify UI
                                        console.error('[AskService] Stream logic error:', e.message);
                                        shouldStop = true;
                                        // Send error state to UI
                                        const errorMsg = e.message || 'Unknown stream error';
                                        // We might want to append the error to the text or show a toast
                                        // For now, let's append it if no text exists, or just log it.
                                        // Better approach: Send a specific error event to UI if possible, 
                                        // but _broadcastScreenshotState currently only takes specific fields.
                                        // Let's try to use the error channel.
                                        
                                        const windowPool = getWindowPool();
                                        ['screenshot', 'header', 'main'].forEach(winName => {
                                            const w = windowPool?.get(winName);
                                            if (w && !w.isDestroyed()) {
                                                w.webContents.send('screenshot-stream-error', { error: errorMsg });
                                            }
                                        });
                                        break; // Break the inner loop
                                    }
                                }
                            }
                            // Reset for next event
                            currentEvent = null;
                            currentData = '';
                        }
                    }
                } else {
                    // Fallback: Raw text mode
                    // Since we consumed the chunk into buffer, and we determined it's NOT SSE,
                    // we treat the whole buffer as text content.
                    
                    // FIX: Filter out SSE comments (lines starting with ':') which might appear 
                    // if the server sends a heartbeat/comment before any actual data event.
                    // e.g. ":ok"
                    if (buffer.trim().startsWith(':')) {
                        // If the whole buffer is just comments, ignore it
                        // But careful not to ignore ":hello" if it's actual text content (unlikely for raw mode but possible)
                        // Generally in SSE context, lines starting with : are comments.
                        // If we are here, it implies we didn't see "data:" headers, but we might still be in an SSE stream that just started with a comment.
                        // Let's remove lines starting with :
                        const rawLines = buffer.split(/\r?\n/);
                        const filteredBuffer = rawLines.filter(l => !l.startsWith(':')).join('\n');
                        
                        // If filtering removed everything, just clear buffer and continue
                        if (!filteredBuffer && buffer.trim()) {
                             buffer = '';
                             continue; 
                        }
                        // If there's content left, treat it as text
                        accumulatedText += filteredBuffer;
                    } else {
                        accumulatedText += buffer; 
                    }

                    buffer = ''; // Clear buffer immediately in raw mode

                    this._broadcastScreenshotState({
                        isLoading: false,
                        isStreaming: true,
                        currentResponse: accumulatedText,
                    });
                }
            }

            // Save final response
            if (accumulatedText) {
                await askRepository.addAiMessage({
                    sessionId,
                    role: 'assistant',
                    content: accumulatedText
                });
            }

            // Mark streaming as complete
            this._broadcastScreenshotState({
                isLoading: false,
                isStreaming: false,
                currentResponse: accumulatedText,
            });

        } catch (error) {
            console.error('[AskService] Error processing screenshot stream:', error);
            
            const windowPool = getWindowPool();
            if (windowPool) {
                ['screenshot', 'header', 'main'].forEach(winName => {
                    const w = windowPool.get(winName);
                    if (w && !w.isDestroyed()) {
                        w.webContents.send('screenshot-stream-error', { error: error.message });
                    }
                });
            }
            throw error;
        }
    }



    /**
     * 
     * @param {string[]} conversationTexts
     * @returns {string}
     * @private
     */
    _formatConversationForPrompt(conversationTexts) {
        if (!conversationTexts || conversationTexts.length === 0) {
            return 'No conversation history available.';
        }
        return conversationTexts.slice(-30).join('\n');
    }

    _buildAskApiPayload({ sessionId, userPrompt, conversationHistory, screenshot }) {
        const payload = {
            sessionId: sessionId || null,
            question: (userPrompt || '').trim(),
            context: {
                conversationHistory: conversationHistory || '',
            },
        };

        if (screenshot) {
            const url = typeof screenshot.url === 'string' ? screenshot.url.trim() : '';
            if (url) {
                payload.attachments = {
                    screenshot: {
                        url,
                        width: typeof screenshot.width === 'number' ? screenshot.width : null,
                        height: typeof screenshot.height === 'number' ? screenshot.height : null,
                        mimeType: screenshot.mimeType || 'image/jpeg',
                    },
                };
            }
        }

        return payload;
    }

    async _uploadScreenshotToOss(screenshot) {
        if (!screenshot || !screenshot.buffer || !screenshot.buffer.length) {
            return null;
        }
        try {
            const mimeType = screenshot.mimeType || 'image/jpeg';
            const fileExtension = (mimeType.split('/')?.[1] || 'jpeg').replace('jpeg', 'jpg');
            const base64Data = screenshot.buffer.toString('base64');
            console.log('[AskService] Uploading screenshot via server API', {
                mimeType,
                fileExtension,
                bufferSize: screenshot.buffer.length,
            });

            const uploadResult = await ossApi.uploadScreenshot({
                data: base64Data,
                mimeType,
                fileExtension,
                objectPrefix: 'ask-screenshots',
            });

            if (!uploadResult?.fileUrl) {
                throw new Error('OSS upload API response missing fileUrl');
            }

            console.log('[AskService] Server upload completed', { fileUrl: uploadResult.fileUrl });

            return {
                url: uploadResult.fileUrl,
                width: screenshot.width || null,
                height: screenshot.height || null,
                mimeType,
            };
        } catch (error) {
            console.error('[AskService] Screenshot upload failed:', error);
            return null;
        }
    }

    /**
     * 
     * @param {string} userPrompt
     * @returns {Promise<{success: boolean, response?: string, error?: string}>}
     */
    async sendMessage(userPrompt, conversationHistoryRaw = [], opts = {}) {
        const trimmedPrompt = (userPrompt || '').trim();
        if (!trimmedPrompt) {
            const askWin = getWindowPool()?.get('ask');
            const errorMessage = '请输入要发送的问题内容';
            if (askWin && !askWin.isDestroyed()) {
                askWin.webContents.send('ask-response-stream-error', { error: errorMessage });
            }
            return { success: false, error: errorMessage };
        }

        internalBridge.emit('window:requestVisibility', { name: 'ask', visible: true });
        this.state = {
            ...this.state,
            isLoading: true,
            isStreaming: false,
            currentQuestion: trimmedPrompt,
            currentResponse: '',
            showTextInput: false,
        };
        this._broadcastState();

        if (this.abortController) {
            this.abortController.abort('New request received.');
        }
        this.abortController = new AbortController();
        const { signal } = this.abortController;


        let sessionId;

        try {
            console.log(`[AskService] 🤖 Processing message: ${trimmedPrompt.substring(0, 50)}...`);

            sessionId = await sessionRepository.getOrCreateActive('ask');
            await askRepository.addAiMessage({ sessionId, role: 'user', content: trimmedPrompt });
            console.log(`[AskService] DB: Saved user prompt to session ${sessionId}`);

            const screenshotResult = await captureScreenshot({ quality: 'medium' });
            if (!screenshotResult.success) {
                console.warn('[AskService] Screenshot capture failed:', screenshotResult.error);
            }

            let uploadedScreenshot = null;
            if (screenshotResult.success && screenshotResult.buffer?.length) {
                uploadedScreenshot = await this._uploadScreenshotToOss(screenshotResult);
            }

            const conversationHistory = this._formatConversationForPrompt(conversationHistoryRaw);
            const payload = this._buildAskApiPayload({
                sessionId,
                userPrompt: trimmedPrompt,
                conversationHistory,
                screenshot: uploadedScreenshot,
            });

            const reader = await askApi.startAskStream(payload, { signal });
            console.log('[AskService] Ask API reader:', reader)
            const askWin = getWindowPool()?.get('ask');

            if (!askWin || askWin.isDestroyed()) {
                console.error('[AskService] Ask window is not available to send stream to.');
                if (typeof reader.cancel === 'function') {
                    reader.cancel('ask-window-missing').catch(() => { });
                }
                return { success: false, error: 'Ask window is not available.' };
            }

            signal.addEventListener('abort', () => {
                console.log(`[AskService] Aborting stream reader. Reason: ${signal.reason}`);
                reader.cancel(signal.reason).catch(() => { /* ignore */ });
            });

            await this._processStream(reader, askWin, sessionId, signal);
            // Auto-close Ask window after successful stream if requested
            if (opts && opts.autoClose) {
                try {
                    internalBridge.emit('window:requestVisibility', { name: 'ask', visible: false });
                    this.state.isVisible = false;
                    this._broadcastState();
                } catch (_) { }
            }
            return { success: true };

        } catch (error) {
            console.error('[AskService] Error during message processing:', error);
            this.state = {
                ...this.state,
                isLoading: false,
                isStreaming: false,
                showTextInput: true,
            };
            this._broadcastState();

            const askWin = getWindowPool()?.get('ask');
            if (askWin && !askWin.isDestroyed()) {
                const streamError = error.message || 'Unknown error occurred';
                askWin.webContents.send('ask-response-stream-error', { error: streamError });
            }

            // On error, if requested, also close ask window to prevent dangling view
            if (opts && opts.autoClose) {
                try {
                    internalBridge.emit('window:requestVisibility', { name: 'ask', visible: false });
                    this.state.isVisible = false;
                    this._broadcastState();
                } catch (_) { }
            }
            return { success: false, error: error.message };
        }
    }

    /**
     * 
     * @param {ReadableStreamDefaultReader} reader
     * @param {BrowserWindow} askWin
     * @param {number} sessionId 
     * @param {AbortSignal} signal
     * @returns {Promise<void>}
     * @private
     */
    async _processStream(reader, askWin, sessionId, signal) {
        const decoder = new TextDecoder();
        let fullResponse = '';

        try {
            this.state.isLoading = false;
            this.state.isStreaming = true;
            this._broadcastState();

            let shouldStop = false;
            while (!shouldStop) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (!data) continue;
                    if (data === '[DONE]') {
                        shouldStop = true;
                        reader.cancel().catch(() => { });
                        break;
                    }

                    try {
                        const json = JSON.parse(data);
                        if (json.status === 'completed' && typeof json.answer === 'string') {
                            fullResponse = json.answer;
                            this.state.currentResponse = fullResponse;
                            this._broadcastState();
                            continue;
                        }
                        if (json.status === 'error' || json.error) {
                            throw new Error(json.error || 'Ask stream reported an error');
                        }
                        const token = json.token || json.choices?.[0]?.delta?.content || '';
                        if (token) {
                            fullResponse += token;
                            this.state.currentResponse = fullResponse;
                            this._broadcastState();
                        }
                    } catch (parseError) {
                        continue;
                    }
                }
            }
        } catch (streamError) {
            if (signal.aborted) {
                console.log(`[AskService] Stream reading was intentionally cancelled. Reason: ${signal.reason}`);
            } else {
                console.error('[AskService] Error while processing stream:', streamError);
                if (askWin && !askWin.isDestroyed()) {
                    askWin.webContents.send('ask-response-stream-error', { error: streamError.message });
                }
            }
        } finally {
            this.state.isStreaming = false;
            this.state.currentResponse = fullResponse;
            this._broadcastState();
            if (fullResponse) {
                try {
                    await askRepository.addAiMessage({ sessionId, role: 'assistant', content: fullResponse });
                    console.log(`[AskService] DB: Saved partial or full assistant response to session ${sessionId} after stream ended.`);
                } catch (dbError) {
                    console.error("[AskService] DB: Failed to save assistant response after stream ended:", dbError);
                }
            }
        }
    }

}

const askService = new AskService();

module.exports = askService;
