const { BrowserWindow } = require('electron');
const SttService = require('./stt/sttService');
const SummaryService = require('./summary/summaryService');
const LiveInsightsService = require('./liveInsightsService');
const authService = require('../common/services/authService');
const sessionRepository = require('../common/repositories/session');
const sttRepository = require('./stt/repositories');
const internalBridge = require('../../bridge/internalBridge');
const passcodeService = require('../common/services/passcodeService');

class ListenService {
    constructor() {
        this.sttService = new SttService();
        this.summaryService = new SummaryService();
        this.liveInsightsService = new LiveInsightsService({
            sendToRenderer: (channel, payload) => this.sendToRenderer(channel, payload),
            buildStreamPayload: (turn) => this._buildLiveInsightsRequestPayload(turn),
        });
        this.currentSessionId = null;
        this.isInitializingSession = false;
        this.turnSequence = 0;
        this.activeTurns = {};
        this.turnHistory = [];
        this.lastCompletedText = { Me: '', Them: '' };

        this.setupServiceCallbacks();
        console.log('[ListenService] Service instance created.');
    }

    setupServiceCallbacks() {
        // STT service callbacks
        this.sttService.setCallbacks({
            onTranscriptionComplete: (speaker, text) => {
                this.handleTranscriptionComplete(speaker, text);
            },
            onStatusUpdate: (status) => {
                this.sendToRenderer('update-status', status);
            },
            onPartialTranscript: (partial) => {
                this.handlePartialTranscript(partial);
            },
        });

        // Summary service callbacks
        this.summaryService.setCallbacks({
            onAnalysisComplete: (data) => {
                console.log('📊 Analysis completed:', data);
            },
            onStatusUpdate: (status) => {
                this.sendToRenderer('update-status', status);
            }
        });
    }

    resetTurnState() {
        this.turnSequence = 0;
        this.activeTurns = {};
        this.turnHistory = [];
        this.lastCompletedText = { Me: '', Them: '' };
        if (this.liveInsightsService) {
            this.liveInsightsService.reset();
        }
        try {
            console.log('[ListenService] Live insights turn state reset');
        } catch (e) { }
        this.sendToRenderer('listen:turn-state-reset', {});
    }

    _mapSpeakerForInsights(speaker) {
        if (speaker === 'Them') return 'Candidate';
        if (speaker === 'Me') return 'Interviewer';
        return speaker || 'Unknown';
    }

    _getInterviewSessionMetadata() {
        const sessionInfo = passcodeService.getActiveSessionInfo?.() || null;
        const sessionId = passcodeService.getActiveSessionId?.() || sessionInfo?.id || this.currentSessionId || null;
        const candidateProfile = sessionInfo?.candidateProfile || sessionInfo?.candidate_profile || sessionInfo?.candidate || null;
        const interviewTopic = sessionInfo?.interviewTopic || sessionInfo?.interview_topic || sessionInfo?.topic || null;

        return {
            sessionId,
            candidateProfile,
            interviewTopic,
        };
    }

    _buildRecentTranscript(currentTurnText = '') {
        const history = this.summaryService?.getConversationHistory?.() || [];
        const limit = 8;
        const recentHistory = history.slice(-limit).map(item => (item || '').trim()).filter(Boolean);
        const trimmedTurn = (currentTurnText || '').trim();
        if (trimmedTurn) {
            recentHistory.push(`them: ${trimmedTurn}`);
        }
        return recentHistory.join('\n');
    }

    _buildLiveInsightsRequestPayload(turn) {
        if (!turn) return null;
        const normalizedText = (turn.text || '').trim();
        const { sessionId, candidateProfile, interviewTopic } = this._getInterviewSessionMetadata();
        const recentTranscript = this._buildRecentTranscript(normalizedText);

        return {
            sessionId: sessionId || null,
            turn: {
                id: turn.id,
                speaker: this._mapSpeakerForInsights(turn.speaker),
                text: normalizedText,
                timestamp: turn.timestamp || Date.now(),
            },
            context: {
                recentTranscript: recentTranscript || '',
                candidateProfile: candidateProfile || null,
                interviewTopic: interviewTopic || null,
            },
        };
    }

    showLiveInsightsView() {
        // We no longer force show the listen window as it is integrated into MainView
        this.sendToRenderer('listen:set-view', { view: 'live', insightsMode: 'live' });
    }

    showTranscriptView() {
        const { windowPool } = require('../../window/windowManager');
        const transcriptWindow = windowPool?.get('transcript');
        if (!transcriptWindow || transcriptWindow.isDestroyed()) {
            internalBridge.emit('window:requestVisibility', { name: 'transcript', visible: true });
        } else if (!transcriptWindow.isVisible()) {
            internalBridge.emit('window:requestVisibility', { name: 'transcript', visible: true });
        }
        // this.sendToRenderer('listen:set-view', { view: 'transcript' });
    }

    toggleTranscriptView() {
        const { windowPool } = require('../../window/windowManager');
        const transcriptWindow = windowPool?.get('transcript');
        if (!transcriptWindow || transcriptWindow.isDestroyed()) {
            internalBridge.emit('window:requestVisibility', { name: 'transcript', visible: true });
            return;
        }

        if (transcriptWindow.isVisible()) {
            internalBridge.emit('window:requestVisibility', { name: 'transcript', visible: false });
        } else {
            internalBridge.emit('window:requestVisibility', { name: 'transcript', visible: true });
        }
    }

    serializeTurn(turn) {
        if (!turn) return null;
        return {
            id: turn.id,
            speaker: turn.speaker,
            partialText: turn.partialText || '',
            finalText: turn.finalText || '',
            status: turn.status,
            startedAt: turn.startedAt,
            updatedAt: turn.updatedAt,
            completedAt: turn.completedAt || null,
            provider: turn.provider || null,
        };
    }

    startNewTurn(speaker) {
        const normalizedSpeaker = speaker === 'Me' ? 'Me' : 'Them';
        const turn = {
            id: `turn-${++this.turnSequence}`,
            speaker: normalizedSpeaker,
            partialText: '',
            finalText: '',
            status: 'in_progress',
            startedAt: Date.now(),
            updatedAt: Date.now(),
            completedAt: null,
            provider: null,
            trimPrefix: this.lastCompletedText[normalizedSpeaker] || '',
        };
        this.activeTurns[normalizedSpeaker] = turn;
        this.emitTurnUpdate(turn, {
            event: 'started',
            emitTranscript: false,
            timestamp: turn.startedAt,
        });
        return turn;
    }

    getOrCreateActiveTurn(speaker) {
        const normalizedSpeaker = speaker === 'Me' ? 'Me' : 'Them';
        let turn = this.activeTurns[normalizedSpeaker];
        if (!turn || turn.status === 'completed') {
            turn = this.startNewTurn(normalizedSpeaker);
        }
        return turn;
    }

    normalizeTextForSpeaker(speaker, rawText, turn) {
        if (rawText === null || typeof rawText === 'undefined') return '';
        const text = typeof rawText === 'string' ? rawText : String(rawText);
        const normalizedSpeaker = speaker === 'Me' ? 'Me' : 'Them';
        const prefix = (turn && turn.trimPrefix) || this.lastCompletedText[normalizedSpeaker] || '';

        if (!prefix) return text;
        if (text === prefix) return '';

        if (text.startsWith(prefix)) {
            const trimmed = text.slice(prefix.length).replace(/^[\s,，。、。！？!?.-]+/, '');
            return trimmed;
        }

        return text;
    }



    emitTurnUpdate(turn, extras = {}) {
        if (!turn) return;

        const timestamp = extras.timestamp || Date.now();
        const text = typeof extras.text === 'string'
            ? extras.text
            : ((turn.status === 'completed' ? turn.finalText : turn.partialText) || '');
        const provider = extras.provider || turn.provider || null;
        const isFinal = extras.isFinal ?? (turn.status === 'completed');
        const isPartial = extras.isPartial ?? !isFinal;
        const event = extras.event || (isFinal ? 'finalized' : 'partial');
        const emitTranscript = extras.emitTranscript !== false;
        const hasText = typeof text === 'string' && text.trim().length > 0;

        const serializedTurn = this.serializeTurn(turn);
        if (!serializedTurn) return;

        const turnPayload = {
            ...serializedTurn,
            text,
            event,
            timestamp,
        };

        this.sendToRenderer('listen:turn-update', turnPayload);

        if (emitTranscript && hasText) {
            const transcriptPayload = {
                speaker: turn.speaker,
                turnId: turn.id,
                text,
                timestamp,
                isPartial,
                isFinal,
                provider,
                event,
            };
            this.sendToRenderer('listen:partial-transcript', transcriptPayload);

            // Also broadcast to stt-update channel for SttView
            this.sendToRenderer('stt-update', {
                speaker: turn.speaker,
                text,
                isFinal,
                isPartial
            });
        }
    }

    finalizeTurn(speaker, text, meta = {}) {
        if (!text || text.trim() === '') return null;

        const normalizedSpeaker = speaker === 'Me' ? 'Me' : 'Them';
        let turn = this.activeTurns[normalizedSpeaker];
        if (!turn) {
            turn = this.startNewTurn(normalizedSpeaker);
        }

        const timestamp = meta.timestamp || Date.now();
        const provider = meta.provider || turn.provider || null;

        const mergedFinal = text;
        turn.partialText = mergedFinal;
        turn.finalText = mergedFinal;
        turn.status = 'completed';
        turn.updatedAt = timestamp;
        turn.completedAt = timestamp;
        if (provider) {
            turn.provider = provider;
        }

        this.turnHistory.push(this.serializeTurn(turn));
        if (this.turnHistory.length > 100) {
            this.turnHistory.shift();
        }

        delete this.activeTurns[normalizedSpeaker];

        this.emitTurnUpdate(turn, {
            text: mergedFinal,
            timestamp,
            isPartial: false,
            isFinal: true,
            provider,
            event: 'finalized',
        });

        this.lastCompletedText[normalizedSpeaker] = mergedFinal;

        if (normalizedSpeaker === 'Them' && this.liveInsightsService) {
            this.liveInsightsService.handleTranscriptUpdate({
                id: turn.id,
                speaker: normalizedSpeaker,
                text,
                timestamp,
                isFinal: true,
            }).catch(err => {
                console.error('[ListenService] Live insights final turn failed:', err);
            });
        }

        return turn;
    }

    getTurnState() {
        const activeTurns = Object.values(this.activeTurns || {})
            .map(turn => this.serializeTurn(turn))
            .filter(Boolean);
        const turnHistory = (this.turnHistory || []).map(item => ({ ...item }));
        return {
            activeTurns,
            turnHistory,
        };
    }

    sendToRenderer(channel, data) {
        const { windowPool } = require('../../window/windowManager');
        const listenWindow = windowPool?.get('listen');
        const mainWindow = windowPool?.get('main');
        const transcriptWindow = windowPool?.get('transcript');

        if (listenWindow && !listenWindow.isDestroyed()) {
            listenWindow.webContents.send(channel, data);
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(channel, data);
        }
        if (transcriptWindow && !transcriptWindow.isDestroyed()) {
            transcriptWindow.webContents.send(channel, data);
        }
    }

    initialize() {
        this.setupIpcHandlers();
        console.log('[ListenService] Initialized and ready.');
    }

    async handleListenRequest(listenButtonText) {
        const { windowPool } = require('../../window/windowManager');
        const listenWindow = windowPool.get('listen');
        const header = windowPool.get('header');

        try {
            switch (listenButtonText) {
                case 'Listen':
                    console.log('[ListenService] changeSession to "Listen"');
                    // internalBridge.emit('window:requestVisibility', { name: 'listen', visible: true });
                    {
                        const ok = await this.initializeSession();
                        if (!ok) {
                            throw new Error('Listen session initialization failed');
                        }
                        this.sendToRenderer('session-state-changed', { isActive: true });
                        this.showLiveInsightsView();
                    }
                    break;

                case 'Stop':
                    console.log('[ListenService] changeSession to "Stop"');
                    await this.closeSession();
                    this.sendToRenderer('session-state-changed', { isActive: false });
                    break;

                case 'Done':
                    console.log('[ListenService] changeSession to "Done"');
                    // internalBridge.emit('window:requestVisibility', { name: 'listen', visible: false });
                    this.sendToRenderer('session-state-changed', { isActive: false });
                    break;

                default:
                    throw new Error(`[ListenService] unknown listenButtonText: ${listenButtonText}`);
            }

            header.webContents.send('listen:changeSessionResult', { success: true });

        } catch (error) {
            console.error('[ListenService] error in handleListenRequest:', error);
            header.webContents.send('listen:changeSessionResult', { success: false });
            throw error;
        }
    }

    async handleManualInput(text, speaker = 'Them') {
        if (!this.isSessionActive()) {
            // If no session is active, try to initialize one implicitly or throw error
            // For better UX, let's try to auto-initialize if not active, or at least ensure DB session exists
            if (!this.currentSessionId) {
                await this.initializeNewSession();
            }
        }
        
        // Treat manual input as a complete transcription
        await this.handleTranscriptionComplete(speaker, text);
        return { success: true };
    }

    async handleTranscriptionComplete(speaker, text) {
        console.log(`[ListenService] Transcription complete: ${speaker} - ${text}`);

        const normalizedSpeaker = speaker === 'Me' ? 'Me' : 'Them';
        const activeTurn = this.activeTurns[normalizedSpeaker];
        const cleanedText = this.normalizeTextForSpeaker(speaker, text, activeTurn);
        const aggregatedText = cleanedText;

        this.finalizeTurn(speaker, aggregatedText, {
            timestamp: Date.now(),
            provider: this.sttService?.modelInfo?.provider || null,
        });

        // Save to database
        await this.saveConversationTurn(speaker, aggregatedText);

        // Add to summary service for analysis
        this.summaryService.addConversationTurn(speaker, aggregatedText);
    }

    handlePartialTranscript(partial) {
        if (!partial || !partial.text) return;

        const speaker = partial.speaker === 'Me' ? 'Me' : 'Them';
        if (speaker === 'Me') {
            console.log('[ListenService] Me partial:', { text: partial.text, isFinal: partial.isFinal });
        }
        const timestamp = partial.timestamp || Date.now();
        const provider = partial.provider || this.sttService?.modelInfo?.provider || null;

        const turn = this.getOrCreateActiveTurn(speaker);
        const normalizedText = this.normalizeTextForSpeaker(speaker, partial.text, turn);
        const mergedPartial = normalizedText;
        const hasMeaningfulText = mergedPartial && mergedPartial.trim().length > 0;
        const partialChanged = mergedPartial !== turn.partialText;

        if (!partialChanged && !partial.isFinal) {
            return;
        }

        turn.partialText = mergedPartial;
        turn.updatedAt = timestamp;
        if (provider) {
            turn.provider = provider;
        }

        if (!hasMeaningfulText && !partial.isFinal) {
            return;
        }

        if (partial.isFinal) {
            this.finalizeTurn(speaker, mergedPartial, {
                timestamp,
                provider
            });
            return;
        }

        try {
            console.log('[ListenService] Updating partial transcript', {
                speaker,
                text: mergedPartial.slice(0, 120),
                turnId: turn.id,
            });
        } catch (e) { }

        this.emitTurnUpdate(turn, {
            text: mergedPartial,
            timestamp,
            isPartial: partial.isPartial ?? true,
            isFinal: partial.isFinal ?? false,
            provider,
            event: partial.isFinal ? 'finalized' : 'partial',
        });
    }

    async saveConversationTurn(speaker, transcription) {
        if (!this.currentSessionId) {
            console.error('[DB] Cannot save turn, no active session ID.');
            return;
        }
        if (transcription.trim() === '') return;

        try {
            await sessionRepository.touch(this.currentSessionId);
            await sttRepository.addTranscript({
                sessionId: this.currentSessionId,
                speaker: speaker,
                text: transcription.trim(),
            });
            console.log(`[DB] Saved transcript for session ${this.currentSessionId}: (${speaker})`);
        } catch (error) {
            console.error('Failed to save transcript to DB:', error);
        }
    }

    async initializeNewSession() {
        try {
            // The UID is no longer passed to the repository method directly.
            // The adapter layer handles UID injection. We just ensure a user is available.
            const user = authService.getCurrentUser();
            if (!user) {
                // This case should ideally not happen as authService initializes a default user.
                throw new Error("Cannot initialize session: auth service not ready.");
            }

            this.currentSessionId = await sessionRepository.getOrCreateActive('listen');
            console.log(`[DB] New listen session ensured: ${this.currentSessionId}`);

            // Set session ID for summary service
            this.summaryService.setSessionId(this.currentSessionId);

            // Reset conversation history
            this.summaryService.resetConversationHistory();
            this.resetTurnState();

            console.log('New conversation session started:', this.currentSessionId);
            return true;
        } catch (error) {
            console.error('Failed to initialize new session in DB:', error);
            this.currentSessionId = null;
            return false;
        }
    }

    async initializeSession(language = 'zh') {
        if (this.isInitializingSession) {
            console.log('Session initialization already in progress.');
            return false;
        }

        // Prevent multiple sessions
        if (this.currentSessionId) {
            console.log('A session is already active.');
            return false;
        }

        this.isInitializingSession = true;
        this.sendToRenderer('session-initializing', true);
        this.sendToRenderer('update-status', 'Initializing sessions...');

        let initSucceeded = false;

        try {
            // Initialize database session
            this.currentSessionId = await sessionRepository.getOrCreateActive('listen');
            console.log(`[DB] New listen session ensured: ${this.currentSessionId}`);

            /* ---------- STT Initialization Retry Logic ---------- */
            const MAX_RETRY = 10;
            const RETRY_DELAY_MS = 300;   // 0.3 seconds

            let sttReady = false;
            for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
                try {
                    await this.sttService.initializeSttSessions(language);
                    sttReady = true;
                    break;                         // Exit on success
                } catch (err) {
                    console.warn(
                        `[ListenService] STT init attempt ${attempt} failed: ${err.message}`
                    );
                    if (attempt < MAX_RETRY) {
                        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                    }
                }
            }
            if (!sttReady) throw new Error('STT init failed after retries');
            /* ------------------------------------------- */

            console.log('✅ Listen service initialized successfully.');

            this.sendToRenderer('update-status', 'Connected. Ready to listen.');

            initSucceeded = true;
            this.sendToRenderer('change-listen-capture-state', { status: "start" });

            return true;
        } catch (error) {
            console.error('❌ Failed to initialize listen service:', error);
            this.sendToRenderer('update-status', 'Initialization failed.');
            return false;
        } finally {
            this.isInitializingSession = false;
            this.sendToRenderer('session-initializing', false);
            if (!initSucceeded) {
                this.sendToRenderer('change-listen-capture-state', { status: "stop" });
            }
        }
    }

    async sendMicAudioContent(data, mimeType) {
        return await this.sttService.sendMicAudioContent(data, mimeType);
    }

    async startMacOSAudioCapture() {
        if (process.platform !== 'darwin') {
            throw new Error('macOS audio capture only available on macOS');
        }
        return await this.sttService.startMacOSAudioCapture();
    }

    async stopMacOSAudioCapture() {
        this.sttService.stopMacOSAudioCapture();
    }

    isSessionActive() {
        return this.sttService.isSessionActive();
    }

    async closeSession() {
        try {
            this.sendToRenderer('change-listen-capture-state', { status: "stop" });
            // Close STT sessions
            await this.sttService.closeSessions();

            await this.stopMacOSAudioCapture();

            // End database session
            if (this.currentSessionId) {
                await sessionRepository.end(this.currentSessionId);
                console.log(`[DB] Session ${this.currentSessionId} ended.`);
            }

            // Reset state
            this.currentSessionId = null;
            this.summaryService.resetConversationHistory();
            this.resetTurnState();

            console.log('Listen service session closed.');
            return { success: true };
        } catch (error) {
            console.error('Error closing listen service session:', error);
            return { success: false, error: error.message };
        }
    }

    getCurrentSessionData() {
        return {
            sessionId: this.currentSessionId,
            conversationHistory: this.summaryService.getConversationHistory(),
            totalTexts: this.summaryService.getConversationHistory().length,
            analysisData: this.summaryService.getCurrentAnalysisData(),
        };
    }

    getConversationHistory() {
        return this.summaryService.getConversationHistory();
    }

    _createHandler(asyncFn, successMessage, errorMessage) {
        return async (...args) => {
            try {
                const result = await asyncFn.apply(this, args);
                if (successMessage) console.log(successMessage);
                // `startMacOSAudioCapture` does not return a { success, error } object on success,
                // so we return a success object here for consistent handler responses.
                // Other functions already return a success object.
                return result && typeof result.success !== 'undefined' ? result : { success: true };
            } catch (e) {
                console.error(errorMessage, e);
                return { success: false, error: e.message };
            }
        };
    }

    // Use `_createHandler` to dynamically create handlers.
    handleSendMicAudioContent = this._createHandler(
        this.sendMicAudioContent,
        null,
        'Error sending user audio:'
    );

    handleStartMacosAudio = this._createHandler(
        async () => {
            if (process.platform !== 'darwin') {
                return { success: false, error: 'macOS audio capture only available on macOS' };
            }
            if (this.sttService.isMacOSAudioRunning?.()) {
                return { success: false, error: 'already_running' };
            }
            await this.startMacOSAudioCapture();
            return { success: true, error: null };
        },
        'macOS audio capture started.',
        'Error starting macOS audio capture:'
    );

    handleStopMacosAudio = this._createHandler(
        this.stopMacOSAudioCapture,
        'macOS audio capture stopped.',
        'Error stopping macOS audio capture:'
    );

    handleUpdateGoogleSearchSetting = this._createHandler(
        async (enabled) => {
            console.log('Google Search setting updated to:', enabled);
        },
        null,
        'Error updating Google Search setting:'
    );
}

const listenService = new ListenService();
module.exports = listenService;
