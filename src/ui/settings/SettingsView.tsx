import React, { useState, useEffect, useCallback, useRef } from 'react';

interface ProviderConfig {
  name: string;
  llmModels: Array<{ id: string; name: string }>;
  sttModels: Array<{ id: string; name: string; installed?: boolean }>;
}

interface OllamaModel {
  name: string;
  installed: boolean;
  installing?: boolean;
}

interface Preset {
  id: string;
  title: string;
  is_default: number;
}

export function SettingsView(props: any) {
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});
  const [firebaseUser, setFirebaseUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isContentProtectionOn, setIsContentProtectionOn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [providerConfig, setProviderConfig] = useState<Record<string, ProviderConfig>>({});
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({ openai: '', gemini: '', anthropic: '', whisper: '' });
  const [availableLlmModels, setAvailableLlmModels] = useState<Array<{ id: string; name: string }>>([]);
  const [availableSttModels, setAvailableSttModels] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedLlm, setSelectedLlm] = useState<string | null>(null);
  const [selectedStt, setSelectedStt] = useState<string | null>(null);
  const [isLlmListVisible, setIsLlmListVisible] = useState(false);
  const [isSttListVisible, setIsSttListVisible] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
  const [autoUpdateLoading, setAutoUpdateLoading] = useState(true);
  const [ollamaStatus, setOllamaStatus] = useState({ installed: false, running: false });
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [installingModels, setInstallingModels] = useState<Record<string, number>>({});

  const containerRef = useRef<HTMLDivElement>(null);

  const updateScrollHeight = useCallback(() => {
    const rawHeight = window.innerHeight || (window.screen ? window.screen.height : 0);
    const MIN_HEIGHT = 300;
    const maxHeight = Math.max(MIN_HEIGHT, rawHeight);

    if (containerRef.current) {
      containerRef.current.style.maxHeight = `${maxHeight}px`;
    }
  }, []);

  const loadAutoUpdateSetting = useCallback(async () => {
    if (!window.api) return;
    setAutoUpdateLoading(true);
    try {
      const settingsApi = (window.api as any).settingsView;
      const enabled = await settingsApi.getAutoUpdate();
      setAutoUpdateEnabled(enabled);
      console.log('Auto-update setting loaded:', enabled);
    } catch (e) {
      console.error('Error loading auto-update setting:', e);
      setAutoUpdateEnabled(true);
    }
    setAutoUpdateLoading(false);
  }, []);

  const loadLocalAIStatus = useCallback(async () => {
    try {
      const settingsApi = (window.api as any).settingsView;
      const ollamaStatus = await settingsApi.getOllamaStatus();
      if (ollamaStatus?.success) {
        setOllamaStatus({ installed: ollamaStatus.installed, running: ollamaStatus.running });
        setOllamaModels(ollamaStatus.models || []);
      }

      if (apiKeys?.whisper === 'local') {
        const whisperModelsResult = await settingsApi.getWhisperInstalledModels();
        if (whisperModelsResult?.success) {
          const installedWhisperModels = whisperModelsResult.models;
          setProviderConfig(prev => {
            const updated = { ...prev };
            if (updated.whisper) {
              updated.whisper.sttModels.forEach(m => {
                const installedInfo = installedWhisperModels.find((i: any) => i.id === m.id);
                if (installedInfo) {
                  m.installed = installedInfo.installed;
                }
              });
            }
            return updated;
          });
        }
      }
    } catch (error) {
      console.error('Error loading LocalAI status:', error);
    }
  }, [apiKeys]);

  const refreshModelData = useCallback(async () => {
    const settingsApi = (window.api as any).settingsView;
    const [availableLlm, availableStt, selected, storedKeys] = await Promise.all([
      settingsApi.getAvailableModels({ type: 'llm' }),
      settingsApi.getAvailableModels({ type: 'stt' }),
      settingsApi.getSelectedModels(),
      settingsApi.getAllKeys()
    ]);
    setAvailableLlmModels(availableLlm);
    setAvailableSttModels(availableStt);
    setSelectedLlm(selected.llm);
    setSelectedStt(selected.stt);
    setApiKeys(storedKeys);
  }, []);

  const refreshOllamaStatus = useCallback(async () => {
    const settingsApi = (window.api as any).settingsView;
    const ollamaStatusResult = await settingsApi.getOllamaStatus();
    if (ollamaStatusResult?.success) {
      setOllamaStatus({ installed: ollamaStatusResult.installed, running: ollamaStatusResult.running });
      setOllamaModels(ollamaStatusResult.models || []);
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    if (!window.api) return;
    setIsLoading(true);
    try {
      const settingsApi = (window.api as any).settingsView;
      const [userState, modelSettings, presetsData, contentProtection, shortcutsData] = await Promise.all([
        settingsApi.getCurrentUser(),
        settingsApi.getModelSettings(),
        settingsApi.getPresets(),
        settingsApi.getContentProtectionStatus(),
        settingsApi.getCurrentShortcuts()
      ]);

      if (userState && userState.isLoggedIn) setFirebaseUser(userState);

      if (modelSettings.success) {
        const { config, storedKeys, availableLlm, availableStt, selectedModels } = modelSettings.data;
        setProviderConfig(config);
        setApiKeys(storedKeys);
        setAvailableLlmModels(availableLlm);
        setAvailableSttModels(availableStt);
        setSelectedLlm(selectedModels.llm);
        setSelectedStt(selectedModels.stt);
      }

      setPresets(presetsData || []);
      setIsContentProtectionOn(contentProtection);
      setShortcuts(shortcutsData || {});

      if (presetsData && presetsData.length > 0) {
        const firstUserPreset = presetsData.find((p: Preset) => p.is_default === 0);
        if (firstUserPreset) setSelectedPreset(firstUserPreset);
      }

      loadLocalAIStatus();
    } catch (error) {
      console.error('Error loading initial settings data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [loadLocalAIStatus]);

  const handleToggleAutoUpdate = useCallback(async () => {
    if (!window.api || autoUpdateLoading) return;
    setAutoUpdateLoading(true);
    try {
      const settingsApi = (window.api as any).settingsView;
      const newValue = !autoUpdateEnabled;
      const result = await settingsApi.setAutoUpdate(newValue);
      if (result && result.success) {
        setAutoUpdateEnabled(newValue);
      } else {
        console.error('Failed to update auto-update setting');
      }
    } catch (e) {
      console.error('Error toggling auto-update:', e);
    }
    setAutoUpdateLoading(false);
  }, [autoUpdateEnabled, autoUpdateLoading]);

  const getProviderForModel = useCallback((type: 'llm' | 'stt', modelId: string) => {
    for (const [providerId, config] of Object.entries(providerConfig)) {
      const models = type === 'llm' ? config.llmModels : config.sttModels;
      if (models?.some(m => m.id === modelId)) {
        return providerId;
      }
    }
    return null;
  }, [providerConfig]);

  const installOllamaModel = useCallback(async (modelName: string) => {
    try {
      setInstallingModels(prev => ({ ...prev, [modelName]: 0 }));

      const progressHandler = (event: any, data: any) => {
        if (data.service === 'ollama' && data.model === modelName) {
          setInstallingModels(prev => ({ ...prev, [modelName]: data.progress || 0 }));
        }
      };

      const settingsApi = (window.api as any).settingsView;
      settingsApi.onLocalAIInstallProgress(progressHandler);

      try {
        const result = await settingsApi.pullOllamaModel(modelName);

        if (result.success) {
          console.log(`[SettingsView] Model ${modelName} installed successfully`);
          setInstallingModels(prev => {
            const updated = { ...prev };
            delete updated[modelName];
            return updated;
          });

          await refreshOllamaStatus();
          await refreshModelData();
        } else {
          throw new Error(result.error || 'Installation failed');
        }
      } finally {
        settingsApi.removeOnLocalAIInstallProgress(progressHandler);
      }
    } catch (error) {
      console.error(`[SettingsView] Error installing model ${modelName}:`, error);
      setInstallingModels(prev => {
        const updated = { ...prev };
        delete updated[modelName];
        return updated;
      });
    }
  }, [refreshOllamaStatus, refreshModelData]);

  const downloadWhisperModel = useCallback(async (modelId: string) => {
    setInstallingModels(prev => ({ ...prev, [modelId]: 0 }));

    try {
      const progressHandler = (event: any, data: any) => {
        if (data.service === 'whisper' && data.model === modelId) {
          setInstallingModels(prev => ({ ...prev, [modelId]: data.progress || 0 }));
        }
      };

      const settingsApi = (window.api as any).settingsView;
      settingsApi.onLocalAIInstallProgress(progressHandler);

      const result = await settingsApi.downloadWhisperModel(modelId);

      if (result.success) {
        setProviderConfig(prev => {
          const updated = { ...prev };
          if (updated.whisper?.sttModels) {
            const modelInfo = updated.whisper.sttModels.find(m => m.id === modelId);
            if (modelInfo) {
              modelInfo.installed = true;
            }
          }
          return updated;
        });

        setInstallingModels(prev => {
          const updated = { ...prev };
          delete updated[modelId];
          return updated;
        });

        await loadLocalAIStatus();
        await selectModel('stt', modelId);
      } else {
        setInstallingModels(prev => {
          const updated = { ...prev };
          delete updated[modelId];
          return updated;
        });
        alert(`Failed to download Whisper model: ${result.error}`);
      }

      settingsApi.removeOnLocalAIInstallProgress(progressHandler);
    } catch (error: any) {
      console.error(`[SettingsView] Error downloading Whisper model ${modelId}:`, error);
      setInstallingModels(prev => {
        const updated = { ...prev };
        delete updated[modelId];
        return updated;
      });
      alert(`Error downloading ${modelId}: ${error.message}`);
    }
  }, [loadLocalAIStatus]);

  const selectModel = useCallback(async (type: 'llm' | 'stt', modelId: string) => {
    const provider = getProviderForModel(type, modelId);

    if (provider === 'ollama') {
      const ollamaModel = ollamaModels.find(m => m.name === modelId);
      if (ollamaModel && !ollamaModel.installed && !ollamaModel.installing) {
        await installOllamaModel(modelId);
        return;
      }
    }

    if (provider === 'whisper' && type === 'stt') {
      const isInstalling = installingModels[modelId] !== undefined;
      const whisperModelInfo = providerConfig.whisper?.sttModels.find(m => m.id === modelId);

      if (whisperModelInfo && !whisperModelInfo.installed && !isInstalling) {
        await downloadWhisperModel(modelId);
        return;
      }
    }

    setSaving(true);
    const settingsApi = (window.api as any).settingsView;
    await settingsApi.setSelectedModel({ type, modelId });
    if (type === 'llm') setSelectedLlm(modelId);
    if (type === 'stt') setSelectedStt(modelId);
    setIsLlmListVisible(false);
    setIsSttListVisible(false);
    setSaving(false);
  }, [getProviderForModel, ollamaModels, installingModels, providerConfig, installOllamaModel, downloadWhisperModel]);

  const toggleModelList = useCallback(async (type: 'llm' | 'stt') => {
    const isVisible = type === 'llm' ? isLlmListVisible : isSttListVisible;
    const setVisible = type === 'llm' ? setIsLlmListVisible : setIsSttListVisible;

    if (!isVisible) {
      setSaving(true);
      await refreshModelData();
      setSaving(false);
    }

    setVisible(!isVisible);
  }, [isLlmListVisible, isSttListVisible, refreshModelData]);

  const handleSaveKey = useCallback(async (provider: string) => {
    const input = document.getElementById(`key-input-${provider}`) as HTMLInputElement;
    if (!input) return;
    const key = input.value;

    if (provider === 'ollama') {
      setSaving(true);
      const settingsApi = (window.api as any).settingsView;
      const ensureResult = await settingsApi.ensureOllamaReady();
      if (!ensureResult.success) {
        alert(`Failed to setup Ollama: ${ensureResult.error}`);
        setSaving(false);
        return;
      }

      const result = await settingsApi.validateKey({ provider, key: 'local' });

      if (result.success) {
        await refreshModelData();
        await refreshOllamaStatus();
      } else {
        alert(`Failed to connect to Ollama: ${result.error}`);
      }
      setSaving(false);
      return;
    }

    if (provider === 'whisper') {
      setSaving(true);
      const settingsApi = (window.api as any).settingsView;
      const result = await settingsApi.validateKey({ provider, key: 'local' });

      if (result.success) {
        await refreshModelData();
      } else {
        alert(`Failed to enable Whisper: ${result.error}`);
      }
      setSaving(false);
      return;
    }

    setSaving(true);
    const settingsApi = (window.api as any).settingsView;
    const result = await settingsApi.validateKey({ provider, key });

    if (result.success) {
      await refreshModelData();
    } else {
      alert(`Failed to save ${provider} key: ${result.error}`);
      input.value = apiKeys[provider] || '';
    }
    setSaving(false);
  }, [apiKeys, refreshModelData, refreshOllamaStatus]);

  const handleClearKey = useCallback(async (provider: string) => {
    console.log(`[SettingsView] handleClearKey: ${provider}`);
    setSaving(true);
    const settingsApi = (window.api as any).settingsView;
    await settingsApi.removeApiKey(provider);
    setApiKeys(prev => ({ ...prev, [provider]: '' }));
    await refreshModelData();
    setSaving(false);
  }, [refreshModelData]);

  const handleOllamaShutdown = useCallback(async () => {
    console.log('[SettingsView] Shutting down Ollama service...');

    if (!window.api) return;

    try {
      setOllamaStatus(prev => ({ ...prev, running: false }));

      const settingsApi = (window.api as any).settingsView;
      const result = await settingsApi.shutdownOllama(false);

      if (result.success) {
        console.log('[SettingsView] Ollama shut down successfully');
        await refreshOllamaStatus();
      } else {
        console.error('[SettingsView] Failed to shutdown Ollama:', result.error);
        await refreshOllamaStatus();
      }
    } catch (error) {
      console.error('[SettingsView] Error during Ollama shutdown:', error);
      await refreshOllamaStatus();
    }
  }, [refreshOllamaStatus]);

  const openShortcutEditor = useCallback(() => {
    const settingsApi = (window.api as any).settingsView;
    settingsApi.openShortcutSettingsWindow();
  }, []);

  const handleMoveLeft = useCallback(() => {
    console.log('Move Left clicked');
    const settingsApi = (window.api as any).settingsView;
    settingsApi.moveWindowStep('left');
  }, []);

  const handleMoveRight = useCallback(() => {
    console.log('Move Right clicked');
    const settingsApi = (window.api as any).settingsView;
    settingsApi.moveWindowStep('right');
  }, []);

  const handleToggleInvisibility = useCallback(async () => {
    console.log('Toggle Invisibility clicked');
    const settingsApi = (window.api as any).settingsView;
    const newStatus = await settingsApi.toggleContentProtection();
    setIsContentProtectionOn(newStatus);
  }, []);

  const handleQuit = useCallback(async () => {
    console.log('Quit clicked');

    const settingsApi = (window.api as any)?.settingsView;
    const stopSessionFn = settingsApi?.stopInterviewSession;
    if (stopSessionFn) {
      try {
        const result = await stopSessionFn();
        console.log('[SettingsView] stopInterviewSession result:', result);
        if (!result?.success && !result?.skipped) {
          console.warn('[SettingsView] Failed to stop interview session before quit:', result?.error);
        }
      } catch (error) {
        console.error('[SettingsView] Error when stopping interview session before quit:', error);
      }
    }

    if (settingsApi?.quitApplication) {
      settingsApi.quitApplication();
    } else {
      window.api?.common?.quitApplication?.();
    }
  }, []);

  const togglePresets = useCallback(() => {
    setShowPresets(prev => !prev);
  }, []);

  const handlePresetSelect = useCallback((preset: Preset) => {
    setSelectedPreset(preset);
    console.log('Selected preset:', preset);
  }, []);

  const handleMouseEnter = useCallback(() => {
    const settingsApi = (window.api as any).settingsView;
    settingsApi.cancelHideSettingsWindow();
    updateScrollHeight();
  }, [updateScrollHeight]);

  const handleMouseLeave = useCallback(() => {
    const settingsApi = (window.api as any).settingsView;
    settingsApi.hideSettingsWindow();
  }, []);

  // Set up IPC listeners
  useEffect(() => {
    if (!window.api) return;

    const userStateListener = (event: any, userState: any) => {
      console.log('[SettingsView] Received user-state-changed:', userState);
      if (userState && userState.isLoggedIn) {
        setFirebaseUser(userState);
      } else {
        setFirebaseUser(null);
      }
      loadAutoUpdateSetting();
      loadInitialData();
    };

    const presetsUpdatedListener = async () => {
      console.log('[SettingsView] Received presets-updated, refreshing presets');
      try {
        const settingsApi = (window.api as any).settingsView;
        const presetsData = await settingsApi.getPresets();
        setPresets(presetsData || []);

        const userPresets = (presetsData || []).filter((p: Preset) => p.is_default === 0);
        if (selectedPreset && !userPresets.find((p: Preset) => p.id === selectedPreset.id)) {
          setSelectedPreset(userPresets.length > 0 ? userPresets[0] : null);
        }
      } catch (error) {
        console.error('[SettingsView] Failed to refresh presets:', error);
      }
    };

    const shortcutListener = (event: any, keybinds: Record<string, string>) => {
      console.log('[SettingsView] Received updated shortcuts:', keybinds);
      setShortcuts(keybinds);
    };

    const settingsApi = (window.api as any).settingsView;
    settingsApi.onUserStateChanged(userStateListener);
    settingsApi.onPresetsUpdated(presetsUpdatedListener);
    settingsApi.onShortcutsUpdated(shortcutListener);

    return () => {
      settingsApi.removeOnUserStateChanged(userStateListener);
      settingsApi.removeOnPresetsUpdated(presetsUpdatedListener);
      settingsApi.removeOnShortcutsUpdated(shortcutListener);
    };
  }, [loadAutoUpdateSetting, loadInitialData, selectedPreset]);

  // Window resize
  useEffect(() => {
    const resizeHandler = () => {
      updateScrollHeight();
    };

    window.addEventListener('resize', resizeHandler);
    setTimeout(() => updateScrollHeight(), 100);

    return () => {
      window.removeEventListener('resize', resizeHandler);
    };
  }, [updateScrollHeight]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const installingModelsList = Object.keys(installingModels);
      if (installingModelsList.length > 0) {
        const settingsApi = (window.api as any).settingsView;
        installingModelsList.forEach(modelName => {
          settingsApi.cancelOllamaInstallation(modelName);
        });
      }
    };
  }, [installingModels]);

  // Load initial data
  useEffect(() => {
    loadInitialData();
    loadAutoUpdateSetting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getMainShortcuts = useCallback(() => {
    return [
      { name: 'Show / Hide', accelerator: shortcuts.toggleVisibility },
      { name: 'Ask Anything', accelerator: shortcuts.nextStep },
      { name: 'Scroll Up Response', accelerator: shortcuts.scrollUp },
      { name: 'Scroll Down Response', accelerator: shortcuts.scrollDown },
    ];
  }, [shortcuts]);

  const renderShortcutKeys = useCallback((accelerator?: string) => {
    if (!accelerator) return <span className="text-white/50 text-xs">N/A</span>;

    const keyMap: Record<string, string> = {
      'Cmd': '⌘', 'Command': '⌘', 'Ctrl': '⌃', 'Alt': '⌥', 'Shift': '⇧', 'Enter': '↵',
      'Up': '↑', 'Down': '↓', 'Left': '←', 'Right': '→'
    };

    if (accelerator.includes('↕')) {
      const keys = accelerator.replace('↕', '').split('+');
      keys.push('↕');
      return <>{keys.map((key, idx) => (
        <span key={idx} className="px-1.5 py-0.5 text-xs bg-white/10 border border-white/20 rounded text-white/90">
          {keyMap[key] || key}
        </span>
      ))}</>;
    }

    const keys = accelerator.split('+');
    return <>{keys.map((key, idx) => (
      <span key={idx} className="px-1.5 py-0.5 text-xs bg-white/10 border border-white/20 rounded text-white/90">
        {keyMap[key] || key}
      </span>
    ))}</>;
  }, []);

  const getModelName = useCallback((type: 'llm' | 'stt', id: string | null) => {
    if (!id) return 'Not Set';
    const models = type === 'llm' ? availableLlmModels : availableSttModels;
    const model = models.find(m => m.id === id);
    return model ? model.name : id;
  }, [availableLlmModels, availableSttModels]);

  if (isLoading) {
    return (
      <div className="flex flex-col w-full h-full bg-gradient-to-b from-muyu-dark-950 to-muyu-dark-900 rounded-muyu-lg overflow-hidden shadow-muyu-lg outline outline-1 outline-white/10 p-6">
        <div className="flex flex-col items-center justify-center flex-1 gap-4">
          <div className="w-8 h-8 border-4 border-muyu-purple-500/30 border-t-muyu-purple-500 rounded-full animate-spin"></div>
          <span className="text-white/70 text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  const loggedIn = !!firebaseUser;

  return (
    <div
      ref={containerRef}
      className="flex flex-col w-full h-full bg-gradient-to-b from-muyu-dark-950 to-muyu-dark-900 rounded-muyu-lg overflow-hidden shadow-muyu-lg outline outline-1 outline-white/10 p-6 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-white/5 [&::-webkit-scrollbar-track]:rounded [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb:hover]:bg-white/30"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white mb-2">幕语AI</h1>
          <div className="text-sm text-white/60">
            {firebaseUser
              ? `Account: ${firebaseUser.email || 'Logged In'}`
              : `Account: Not Logged In`
            }
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 pt-1.5 mt-1.5 mb-4">
        <button
          className="w-full px-5 py-2.5 bg-muyu-purple-500/20 border border-muyu-purple-500/40 rounded-lg text-muyu-purple-300 cursor-pointer transition-all hover:bg-muyu-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={openShortcutEditor}
        >
          Edit Shortcuts
        </button>
      </div>

      <div className="mb-4 space-y-2">
        {getMainShortcuts().map((shortcut, idx) => (
          <div key={idx} className="flex items-center justify-between py-2">
            <span className="text-sm text-white/90">{shortcut.name}</span>
            <div className="flex items-center gap-1">
              {renderShortcutKeys(shortcut.accelerator)}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-white/90">
            My Presets
            <span className="text-white/60 ml-1">({presets.filter(p => p.is_default === 0).length})</span>
          </span>
          <span
            className="text-white/60 cursor-pointer hover:text-white/90 transition-colors text-xs"
            onClick={togglePresets}
          >
            {showPresets ? '▼' : '▶'}
          </span>
        </div>

        <div className={showPresets ? 'space-y-1' : 'hidden'}>
          {presets.filter(p => p.is_default === 0).length === 0 ? (
            <div className="text-sm text-white/50 py-2">
              No custom presets yet.<br />
            </div>
          ) : (
            presets.filter(p => p.is_default === 0).map(preset => (
              <div
                key={preset.id}
                className={`px-3 py-2 rounded cursor-pointer transition-all ${selectedPreset?.id === preset.id
                  ? 'bg-muyu-purple-500/20 border border-muyu-purple-500/40'
                  : 'hover:bg-white/5'
                  }`}
                onClick={() => handlePresetSelect(preset)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/90">{preset.title}</span>
                  {selectedPreset?.id === preset.id && (
                    <span className="text-xs text-muyu-purple-300">Selected</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-auto space-y-2">
        <button
          className="w-full px-5 py-2.5 bg-muyu-purple-500/20 border border-muyu-purple-500/40 rounded-lg text-muyu-purple-300 cursor-pointer transition-all hover:bg-muyu-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleToggleAutoUpdate}
          disabled={autoUpdateLoading}
        >
          <span>Automatic Updates: {autoUpdateEnabled ? 'On' : 'Off'}</span>
        </button>

        <div className="flex gap-2">
          <button
            className="flex-1 px-5 py-2.5 bg-muyu-purple-500/20 border border-muyu-purple-500/40 rounded-lg text-muyu-purple-300 cursor-pointer transition-all hover:bg-muyu-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleMoveLeft}
          >
            <span>← Move</span>
          </button>
          <button
            className="flex-1 px-5 py-2.5 bg-muyu-purple-500/20 border border-muyu-purple-500/40 rounded-lg text-muyu-purple-300 cursor-pointer transition-all hover:bg-muyu-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleMoveRight}
          >
            <span>Move →</span>
          </button>
        </div>

        <button
          className="w-full px-5 py-2.5 bg-muyu-purple-500/20 border border-muyu-purple-500/40 rounded-lg text-muyu-purple-300 cursor-pointer transition-all hover:bg-muyu-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleToggleInvisibility}
        >
          <span>{isContentProtectionOn ? 'Disable Invisibility' : 'Enable Invisibility'}</span>
        </button>

        <div className="pt-2">
          <button
            className="w-full px-5 py-2.5 bg-red-500/20 border border-red-500/40 rounded-lg text-red-300 cursor-pointer transition-all hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleQuit}
          >
            <span>结束面试</span>
          </button>
        </div>
      </div>
    </div>
  );
}

