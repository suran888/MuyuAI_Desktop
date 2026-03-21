const { EventEmitter } = require('events');
const Store = require('electron-store');
const { PROVIDERS, getProviderClass } = require('../ai/factory');
const encryptionService = require('./encryptionService');
const providerSettingsRepository = require('../repositories/providerSettings');
const authService = require('./authService');
const ollamaModelRepository = require('../repositories/ollamaModel');

const MANAGED_PROVIDER_IDS = new Set(['openai-glass', 'openai_muyu']);
const DEFAULT_MANAGED_PROVIDER = (() => {
    const envProvider = process.env.MUYU_MANAGED_PROVIDER_ID;
    if (envProvider && MANAGED_PROVIDER_IDS.has(envProvider)) {
        return envProvider;
    }
    return MANAGED_PROVIDER_IDS.has('openai-glass') ? 'openai-glass' : Array.from(MANAGED_PROVIDER_IDS)[0];
})();

function resolveManagedProviderId(providerId) {
    if (providerId && MANAGED_PROVIDER_IDS.has(providerId)) {
        return providerId;
    }
    return DEFAULT_MANAGED_PROVIDER;
}

function isManagedProvider(providerId) {
    return MANAGED_PROVIDER_IDS.has(providerId);
}

class ModelStateService extends EventEmitter {
    constructor() {
        super();
        this.authService = authService;
        // electron-store is used only for legacy data migration.
        try {
            this.store = new Store({ name: 'pickle-glass-model-state' });
        } catch (error) {
            console.warn('[ModelStateService] ElectronStore unavailable, falling back to in-memory store:', error.message);
            const memoryStore = new Map();
            this.store = {
                get: (key) => memoryStore.get(key),
                set: (key, value) => memoryStore.set(key, value),
                delete: (key) => memoryStore.delete(key)
            };
        }
    }

    async initialize() {
        console.log('[ModelStateService] Initializing one-time setup...');
        await this._initializeEncryption();
        await this._runMigrations();
        await this._ensureLocalWhisperDefaults();
        await this._ensureDoubaoDefaults();
        // this.setupLocalAIStateSync(); // Disabled: not using local AI
        await this._autoSelectAvailableModels([], true);
        console.log('[ModelStateService] One-time setup complete.');
    }

    async _initializeEncryption() {
        try {
            const rows = await providerSettingsRepository.getRawApiKeys();
            if (rows.some(r => r.api_key && encryptionService.looksEncrypted(r.api_key))) {
                console.log('[ModelStateService] Encrypted keys detected, initializing encryption...');
                const userIdForMigration = this.authService.getCurrentUserId();
                await encryptionService.initializeKey(userIdForMigration);
            } else {
                console.log('[ModelStateService] No encrypted keys detected, skipping encryption initialization.');
            }
        } catch (err) {
            console.warn('[ModelStateService] Error while checking encrypted keys:', err.message);
        }
    }

    async _ensureLocalWhisperDefaults() {
        try {
            const DEFAULT_WHISPER_MODEL = 'whisper-base';
            let whisperSettings = await providerSettingsRepository.getByProvider('whisper');
            const updates = {};
            if (!whisperSettings) {
                await providerSettingsRepository.upsert('whisper', {
                    api_key: 'local',
                    selected_stt_model: DEFAULT_WHISPER_MODEL,
                    is_active_stt: 1,
                });
                whisperSettings = await providerSettingsRepository.getByProvider('whisper');
            } else {
                if (!whisperSettings.api_key) {
                    updates.api_key = 'local';
                }
                if (!whisperSettings.selected_stt_model || whisperSettings.selected_stt_model !== DEFAULT_WHISPER_MODEL) {
                    updates.selected_stt_model = DEFAULT_WHISPER_MODEL;
                }
                if (Object.keys(updates).length > 0) {
                    await providerSettingsRepository.upsert('whisper', {
                        ...whisperSettings,
                        ...updates,
                    });
                    whisperSettings = { ...whisperSettings, ...updates };
                }
            }

            const activeStt = await providerSettingsRepository.getActiveProvider('stt');
            if (!activeStt || !activeStt.provider) {
                await providerSettingsRepository.setActiveProvider('whisper', 'stt');
            }
        } catch (error) {
            console.warn('[ModelStateService] Failed to ensure Whisper defaults:', error.message);
        }
    }

    async _ensureDoubaoDefaults() {
        // 使用后端代理模式,不再检查客户端环境变量中的密钥
        // 只需要检查后端代理端点是否配置
        if (!process.env.STT_BACKEND_ENDPOINT) {
            console.warn('[ModelStateService] STT_BACKEND_ENDPOINT not configured, Doubao STT will not be available');
            return;
        }

        try {
            const DEFAULT_DOUBAO_MODEL = 'doubao-bigmodel';
            let doubaoSettings = await providerSettingsRepository.getByProvider('doubao');
            const updates = {};

            if (!doubaoSettings) {
                await providerSettingsRepository.upsert('doubao', {
                    api_key: 'backend_proxy', // 标记为使用后端代理
                    selected_stt_model: DEFAULT_DOUBAO_MODEL,
                    is_active_stt: 1
                });
            } else {
                if (doubaoSettings.api_key !== 'backend_proxy') {
                    updates.api_key = 'backend_proxy'; // 更新为后端代理模式
                }
                if (doubaoSettings.selected_stt_model !== DEFAULT_DOUBAO_MODEL) {
                    updates.selected_stt_model = DEFAULT_DOUBAO_MODEL;
                }
                if (Object.keys(updates).length > 0) {
                    await providerSettingsRepository.upsert('doubao', {
                        ...doubaoSettings,
                        ...updates
                    });
                }
            }

            const activeStt = await providerSettingsRepository.getActiveProvider('stt');
            if (!activeStt || activeStt.provider === 'whisper') {
                await providerSettingsRepository.setActiveProvider('doubao', 'stt');
            }
        } catch (error) {
            console.warn('[ModelStateService] Failed to ensure Doubao defaults:', error.message);
        }
    }

    async _runMigrations() {
        console.log('[ModelStateService] Checking for data migrations...');
        const userId = this.authService.getCurrentUserId();

        try {
            const sqliteClient = require('./sqliteClient');
            const db = sqliteClient.getDb();
            const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_model_selections'").get();

            if (tableExists) {
                const selections = db.prepare('SELECT * FROM user_model_selections WHERE uid = ?').get(userId);
                if (selections) {
                    console.log('[ModelStateService] Migrating from user_model_selections table...');
                    if (selections.llm_model) {
                        const llmProvider = this.getProviderForModel(selections.llm_model, 'llm');
                        if (llmProvider) {
                            await this.setSelectedModel('llm', selections.llm_model);
                        }
                    }
                    if (selections.stt_model) {
                        const sttProvider = this.getProviderForModel(selections.stt_model, 'stt');
                        if (sttProvider) {
                            await this.setSelectedModel('stt', selections.stt_model);
                        }
                    }
                    db.prepare('DROP TABLE user_model_selections').run();
                    console.log('[ModelStateService] user_model_selections migration complete.');
                }
            }
        } catch (error) {
            console.error('[ModelStateService] user_model_selections migration failed:', error);
        }

        try {
            const legacyData = this.store.get(`users.${userId}`);
            if (legacyData && legacyData.apiKeys) {
                console.log('[ModelStateService] Migrating from electron-store...');
                for (const [provider, apiKey] of Object.entries(legacyData.apiKeys)) {
                    if (apiKey && PROVIDERS[provider]) {
                        await this.setApiKey(provider, apiKey);
                    }
                }
                if (legacyData.selectedModels?.llm) {
                    await this.setSelectedModel('llm', legacyData.selectedModels.llm);
                }
                if (legacyData.selectedModels?.stt) {
                    await this.setSelectedModel('stt', legacyData.selectedModels.stt);
                }
                this.store.delete(`users.${userId}`);
                console.log('[ModelStateService] electron-store migration complete.');
            }
        } catch (error) {
            console.error('[ModelStateService] electron-store migration failed:', error);
        }
    }

    // setupLocalAIStateSync() {
    //     const localAIManager = require('./localAIManager');
    //     localAIManager.on('state-changed', (service, status) => {
    //         this.handleLocalAIStateChange(service, status);
    //     });
    // }

    async handleLocalAIStateChange(service, state) {
        // console.log(`[ModelStateService] LocalAI state changed: ${service}`, state);
        if (!state.installed || !state.running) {
            const types = service === 'ollama' ? ['llm'] : service === 'whisper' ? ['stt'] : [];
            await this._autoSelectAvailableModels(types);
        }
        this.emit('state-updated', await this.getLiveState());
    }

    async getLiveState() {
        const providerSettings = await providerSettingsRepository.getAll();
        const apiKeys = {};
        Object.keys(PROVIDERS).forEach(provider => {
            const setting = providerSettings.find(s => s.provider === provider);
            apiKeys[provider] = setting?.api_key || null;
        });

        const activeSettings = await providerSettingsRepository.getActiveSettings();
        const selectedModels = {
            llm: activeSettings.llm?.selected_llm_model || null,
            stt: activeSettings.stt?.selected_stt_model || null
        };

        return { apiKeys, selectedModels };
    }

    async _autoSelectAvailableModels(forceReselectionForTypes = [], isInitialBoot = false) {
        console.log(`[ModelStateService] Running auto-selection. Force re-selection for: [${forceReselectionForTypes.join(', ')}]`);
        const { apiKeys, selectedModels } = await this.getLiveState();
        const types = ['llm', 'stt'];

        for (const type of types) {
            const currentModelId = selectedModels[type];
            let isCurrentModelValid = false;
            const forceReselection = forceReselectionForTypes.includes(type);

            if (currentModelId && !forceReselection) {
                const provider = this.getProviderForModel(currentModelId, type);
                const apiKey = apiKeys[provider];
                if (provider && apiKey) {
                    isCurrentModelValid = true;
                }
            }

            if (!isCurrentModelValid) {
                console.log(`[ModelStateService] No valid ${type.toUpperCase()} model selected or selection forced. Finding an alternative...`);
                const availableModels = await this.getAvailableModels(type);
                if (availableModels.length > 0) {
                    let preferredModel = null;
                    if (type === 'stt') {
                        preferredModel = availableModels.find(model => this.getProviderForModel(model.id, type) === 'doubao');
                        if (!preferredModel) {
                            const whisperPriority = ['whisper-base', 'whisper-small', 'whisper-medium', 'whisper-tiny'];
                            for (const target of whisperPriority) {
                                const candidate = availableModels.find(model => model.id === target);
                                if (candidate) {
                                    preferredModel = candidate;
                                    break;
                                }
                            }
                            if (!preferredModel) {
                                preferredModel = availableModels.find(model => this.getProviderForModel(model.id, type) === 'whisper');
                            }
                        }
                    }
                    const apiModel = availableModels.find(model => {
                        const provider = this.getProviderForModel(model.id, type);
                        return provider && provider !== 'ollama' && provider !== 'whisper';
                    });
                    const newModel = preferredModel || apiModel || availableModels[0];
                    await this.setSelectedModel(type, newModel.id);
                    console.log(`[ModelStateService] Auto-selected ${type.toUpperCase()} model: ${newModel.id}`);
                } else {
                    await providerSettingsRepository.setActiveProvider(null, type);
                    if (!isInitialBoot) {
                        this.emit('state-updated', await this.getLiveState());
                    }
                }
            }
        }
    }

    async setManagedVirtualKey(providerId, virtualKey) {
        const targetProvider = resolveManagedProviderId(providerId);
        console.log(`[ModelStateService] Setting managed virtual key for ${targetProvider}.`);

        const previousSettings = await providerSettingsRepository.getByProvider(targetProvider);
        const wasPreviouslyConfigured = !!previousSettings?.api_key;

        await this.setApiKey(targetProvider, virtualKey);

        if (virtualKey) {
            if (!wasPreviouslyConfigured) {
                console.log(`[ModelStateService] First-time setup for ${targetProvider}, setting default models.`);
                const llmModel = PROVIDERS[targetProvider]?.llmModels?.[0];
                const sttModel = PROVIDERS[targetProvider]?.sttModels?.[0];
                if (llmModel) await this.setSelectedModel('llm', llmModel.id);
                if (sttModel) await this.setSelectedModel('stt', sttModel.id);
            } else {
                console.log(`[ModelStateService] ${targetProvider} key updated, existing selections preserved.`);
            }
        } else {
            const selected = await this.getSelectedModels();
            const llmProvider = selected?.llm ? this.getProviderForModel(selected.llm, 'llm') : null;
            const sttProvider = selected?.stt ? this.getProviderForModel(selected.stt, 'stt') : null;

            const typesToReselect = [];
            if (llmProvider === targetProvider) typesToReselect.push('llm');
            if (sttProvider === targetProvider) typesToReselect.push('stt');

            if (typesToReselect.length > 0) {
                console.log('[ModelStateService] Managed provider token removed, re-selecting models for:', typesToReselect.join(', '));
                await this._autoSelectAvailableModels(typesToReselect);
            }
        }
    }



    async setApiKey(provider, key) {
        console.log(`[ModelStateService] setApiKey for ${provider}`);
        if (!provider) {
            throw new Error('Provider is required');
        }

        // Managed providers use their own auth keys, so skip validation.
        if (!isManagedProvider(provider)) {
            const validationResult = await this.validateApiKey(provider, key);
            if (!validationResult.success) {
                console.warn(`[ModelStateService] API key validation failed for ${provider}: ${validationResult.error}`);
                return validationResult;
            }
        }

        const finalKey = (provider === 'ollama' || provider === 'whisper') ? 'local' : key;
        const existingSettings = await providerSettingsRepository.getByProvider(provider) || {};
        await providerSettingsRepository.upsert(provider, { ...existingSettings, api_key: finalKey });

        // Since a key was added/changed, check if the provider's model can be auto-selected
        await this._autoSelectAvailableModels([]);

        this.emit('state-updated', await this.getLiveState());
        this.emit('settings-updated');
        return { success: true };
    }

    async getAllApiKeys() {
        const allSettings = await providerSettingsRepository.getAll();
        const apiKeys = {};
        allSettings.forEach(s => {
            if (!isManagedProvider(s.provider)) {
                apiKeys[s.provider] = s.api_key;
            }
        });
        return apiKeys;
    }

    async removeApiKey(provider) {
        const setting = await providerSettingsRepository.getByProvider(provider);
        if (setting && setting.api_key) {
            await providerSettingsRepository.upsert(provider, { ...setting, api_key: null });
            await this._autoSelectAvailableModels(['llm', 'stt']);
            this.emit('state-updated', await this.getLiveState());
            this.emit('settings-updated');
            return true;
        }
        return false;
    }



    /**
* Check whether at least one valid API key is set.
     */
    async hasValidApiKey() {
        const allSettings = await providerSettingsRepository.getAll();
        return allSettings.some(s => s.api_key && s.api_key.trim().length > 0);
    }

    getProviderForModel(arg1, arg2) {
        // Compatibility: support both (type, modelId) old order and (modelId, type) new order
        let type, modelId;
        if (arg1 === 'llm' || arg1 === 'stt') {
            type = arg1;
            modelId = arg2;
        } else {
            modelId = arg1;
            type = arg2;
        }
        if (!modelId || !type) return null;
        for (const providerId in PROVIDERS) {
            const models = type === 'llm' ? PROVIDERS[providerId].llmModels : PROVIDERS[providerId].sttModels;
            if (models && models.some(m => m.id === modelId)) {
                return providerId;
            }
        }
        if (type === 'llm') {
            const installedModels = ollamaModelRepository.getInstalledModels();
            if (installedModels.some(m => m.name === modelId)) return 'ollama';
        }
        return null;
    }

    async getSelectedModels() {
        const active = await providerSettingsRepository.getActiveSettings();
        return {
            llm: active.llm?.selected_llm_model || null,
            stt: active.stt?.selected_stt_model || null,
        };
    }

    async setSelectedModel(type, modelId) {
        const provider = this.getProviderForModel(modelId, type);
        if (!provider) {
            console.warn(`[ModelStateService] No provider found for model ${modelId}`);
            return false;
        }

        const existingSettings = await providerSettingsRepository.getByProvider(provider) || {};
        const newSettings = { ...existingSettings };

        if (type === 'llm') {
            newSettings.selected_llm_model = modelId;
        } else {
            newSettings.selected_stt_model = modelId;
        }

        await providerSettingsRepository.upsert(provider, newSettings);
        await providerSettingsRepository.setActiveProvider(provider, type);

        console.log(`[ModelStateService] Selected ${type} model: ${modelId} (provider: ${provider})`);

        if (type === 'llm' && provider === 'ollama') {
            require('./localAIManager').warmUpModel(modelId).catch(err => console.warn(err));
        }

        this.emit('state-updated', await this.getLiveState());
        this.emit('settings-updated');
        return true;
    }

    async getAvailableModels(type) {
        const allSettings = await providerSettingsRepository.getAll();
        const available = [];
        const modelListKey = type === 'llm' ? 'llmModels' : 'sttModels';

        for (const setting of allSettings) {
            if (!setting.api_key) continue;

            const providerId = setting.provider;
            if (providerId === 'ollama' && type === 'llm') {
                const installed = ollamaModelRepository.getInstalledModels();
                available.push(...installed.map(m => ({ id: m.name, name: m.name })));
            } else if (PROVIDERS[providerId]?.[modelListKey]) {
                available.push(...PROVIDERS[providerId][modelListKey]);
            }
        }
        return [...new Map(available.map(item => [item.id, item])).values()];
    }

    async getCurrentModelInfo(type) {
        const activeSetting = await providerSettingsRepository.getActiveProvider(type);
        if (!activeSetting) return null;

        const model = type === 'llm' ? activeSetting.selected_llm_model : activeSetting.selected_stt_model;
        if (!model) return null;

        return {
            provider: activeSetting.provider,
            model: model,
            apiKey: activeSetting.api_key,
        };
    }

    // --- Handlers and utility methods ---

    async validateApiKey(provider, key) {
        if (!key || (key.trim() === '' && provider !== 'ollama' && provider !== 'whisper')) {
            return { success: false, error: 'API key cannot be empty.' };
        }
        const ProviderClass = getProviderClass(provider);
        if (!ProviderClass || typeof ProviderClass.validateApiKey !== 'function') {
            return { success: true };
        }
        try {
            return await ProviderClass.validateApiKey(key);
        } catch (error) {
            return { success: false, error: 'An unexpected error occurred during validation.' };
        }
    }

    getProviderConfig() {
        const config = {};
        for (const key in PROVIDERS) {
            const { handler, ...rest } = PROVIDERS[key];
            config[key] = rest;
        }
        return config;
    }

    async handleRemoveApiKey(provider) {
        const success = await this.removeApiKey(provider);
        if (success) {
            const selectedModels = await this.getSelectedModels();
            if (!selectedModels.llm && !selectedModels.stt) {
                this.emit('force-show-apikey-header');
            }
        }
        return success;
    }

    /*-------------- Compatibility Helpers --------------*/
    async handleValidateKey(provider, key) {
        return await this.setApiKey(provider, key);
    }

    async handleSetSelectedModel(type, modelId) {
        return await this.setSelectedModel(type, modelId);
    }

    async areProvidersConfigured() {
        const allSettings = await providerSettingsRepository.getAll();
        const apiKeyMap = {};
        allSettings.forEach(s => apiKeyMap[s.provider] = s.api_key);
        // LLM
        const hasLlmKey = Object.entries(apiKeyMap).some(([provider, key]) => {
            if (!key) return false;
            if (provider === 'whisper') return false; // Whisper has no LLM
            return PROVIDERS[provider]?.llmModels?.length > 0;
        });
        // STT
        const hasSttKey = Object.entries(apiKeyMap).some(([provider, key]) => {
            if (!key) return false;
            if (provider === 'ollama') return false; // Ollama has no STT
            return PROVIDERS[provider]?.sttModels?.length > 0 || provider === 'whisper';
        });
        return hasLlmKey && hasSttKey;
    }
}

const modelStateService = new ModelStateService();
module.exports = modelStateService;
