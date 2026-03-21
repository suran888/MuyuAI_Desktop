import React, { useState, useEffect, useCallback } from 'react';
import { useIpcListener } from '../hooks';

const commonSystemShortcuts = new Set([
  'Cmd+Q', 'Cmd+W', 'Cmd+A', 'Cmd+S', 'Cmd+Z', 'Cmd+X', 'Cmd+C', 'Cmd+V', 'Cmd+P', 'Cmd+F', 'Cmd+G', 'Cmd+H', 'Cmd+M', 'Cmd+N', 'Cmd+O', 'Cmd+T',
  'Ctrl+Q', 'Ctrl+W', 'Ctrl+A', 'Ctrl+S', 'Ctrl+Z', 'Ctrl+X', 'Ctrl+C', 'Ctrl+V', 'Ctrl+P', 'Ctrl+F', 'Ctrl+G', 'Ctrl+H', 'Ctrl+M', 'Ctrl+N', 'Ctrl+O', 'Ctrl+T'
]);

const displayNameMap: Record<string, string> = {
  nextStep: 'Ask Anything',
  moveUp: 'Move Up Window',
  moveDown: 'Move Down Window',
  scrollUp: 'Scroll Up Response',
  scrollDown: 'Scroll Down Response',
  toggleVisibility: 'Toggle Visibility',
};

interface Feedback {
  type: 'error' | 'success';
  msg: string;
}

interface ParsedAccelerator {
  accel?: string;
  error?: string;
}

export function ShortCutSettingsView() {
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [capturingKey, setCapturingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});

  // Load shortcuts handler
  const handleLoadShortcuts = useCallback((event: any, keybinds: Record<string, string>) => {
    setShortcuts(keybinds);
    setIsLoading(false);
  }, []);

  useIpcListener(
    window.api.shortcutSettingsView.onLoadShortcuts,
    window.api.shortcutSettingsView.removeOnLoadShortcuts,
    handleLoadShortcuts,
    [handleLoadShortcuts]
  );

  const parseAccelerator = useCallback((e: React.KeyboardEvent): ParsedAccelerator | null => {
    const parts: string[] = [];
    if (e.metaKey) parts.push('Cmd');
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    const isModifier = ['Meta', 'Control', 'Alt', 'Shift'].includes(e.key);
    if (isModifier) return null;

    const keyMap: Record<string, string> = {
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      ' ': 'Space'
    };

    parts.push(e.key.length === 1 ? e.key.toUpperCase() : (keyMap[e.key] || e.key));
    const accel = parts.join('+');

    // Validation
    if (parts.length === 1) return { error: 'Invalid shortcut: needs a modifier' };
    if (parts.length > 4) return { error: 'Invalid shortcut: max 4 keys' };
    if (commonSystemShortcuts.has(accel)) return { error: 'Invalid shortcut: system reserved' };
    
    return { accel };
  }, []);

  const handleKeydown = useCallback((e: React.KeyboardEvent, shortcutKey: string) => {
    e.preventDefault();
    e.stopPropagation();

    const result = parseAccelerator(e);
    if (!result) return; // Only modifier keys pressed

    const { accel, error } = result;
    if (error) {
      setFeedback(prev => ({ ...prev, [shortcutKey]: { type: 'error', msg: error } }));
      return;
    }

    // Success
    if (accel) {
      setShortcuts(prev => ({ ...prev, [shortcutKey]: accel }));
      setFeedback(prev => ({ ...prev, [shortcutKey]: { type: 'success', msg: 'Shortcut set' } }));
      setCapturingKey(null);
    }
  }, [parseAccelerator]);

  const startCapture = useCallback((key: string) => {
    setCapturingKey(key);
    setFeedback(prev => {
      const newFeedback = { ...prev };
      delete newFeedback[key];
      return newFeedback;
    });
  }, []);

  const disableShortcut = useCallback((key: string) => {
    setShortcuts(prev => ({ ...prev, [key]: '' }));
    setFeedback(prev => ({ ...prev, [key]: { type: 'success', msg: 'Shortcut disabled' } }));
  }, []);

  const stopCapture = useCallback(() => {
    setCapturingKey(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!window.api) return;
    setFeedback({});
    const result = await window.api.shortcutSettingsView.saveShortcuts(shortcuts);
    if (!result.success) {
      alert('Failed to save shortcuts: ' + result.error);
    }
  }, [shortcuts]);

  const handleClose = useCallback(() => {
    if (!window.api) return;
    setFeedback({});
    window.api.shortcutSettingsView.closeShortcutSettingsWindow();
  }, []);

  const handleResetToDefault = useCallback(async () => {
    if (!window.api) return;
    const confirmation = confirm("Are you sure you want to reset all shortcuts to their default values?");
    if (!confirmation) return;

    try {
      const defaultShortcuts = await window.api.shortcutSettingsView.getDefaultShortcuts();
      setShortcuts(defaultShortcuts);
    } catch (error) {
      alert('Failed to load default settings.');
    }
  }, []);

  const formatShortcutName = useCallback((name: string): string => {
    if (displayNameMap[name]) {
      return displayNameMap[name];
    }
    const result = name.replace(/([A-Z])/g, " $1");
    return result.charAt(0).toUpperCase() + result.slice(1);
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col w-full h-full bg-muyu-dark-800 rounded-muyu p-6 text-white font-sans">
        <div className="flex items-center justify-center flex-1 text-white/70 text-sm">
          Loading Shortcuts...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-muyu-dark-800 rounded-muyu p-6 text-white font-sans relative">
      <button 
        className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 rounded transition-colors text-2xl leading-none cursor-pointer border-none bg-transparent"
        onClick={handleClose} 
        title="Close"
      >
        &times;
      </button>
      
      <h1 className="text-xl font-semibold mb-6 text-white">
        Edit Shortcuts
      </h1>

      <div className="flex-1 overflow-y-auto mb-6 space-y-1">
        {Object.keys(shortcuts).map(key => (
          <div key={key}>
            <div className="flex items-center gap-2 py-2">
              <span className="flex-1 text-sm text-white/90">
                {formatShortcutName(key)}
              </span>

              <button 
                className="px-3 py-1 text-2xs bg-white/10 hover:bg-white/20 border border-white/20 rounded text-white transition-colors cursor-pointer"
                onClick={() => startCapture(key)}
              >
                Edit
              </button>
              
              <button 
                className="px-3 py-1 text-2xs bg-white/10 hover:bg-white/20 border border-white/20 rounded text-white transition-colors cursor-pointer"
                onClick={() => disableShortcut(key)}
              >
                Disable
              </button>

              <input
                readOnly
                className={`
                  w-48 px-3 py-1.5 text-sm bg-black/20 border rounded text-white
                  cursor-pointer transition-all
                  ${capturingKey === key 
                    ? 'border-blue-500 ring-2 ring-blue-500/50' 
                    : 'border-white/20 hover:border-white/30'
                  }
                `}
                value={shortcuts[key] || ''}
                placeholder={capturingKey === key ? 'Press new shortcut…' : 'Click to edit'}
                onClick={() => startCapture(key)}
                onKeyDown={(e) => handleKeydown(e, key)}
                onBlur={stopCapture}
              />
            </div>

            {feedback[key] ? (
              <div className={`
                text-2xs px-2 py-1 mt-1 rounded
                ${feedback[key].type === 'error' 
                  ? 'bg-red-500/20 text-red-300 border border-red-500/30' 
                  : 'bg-green-500/20 text-green-300 border border-green-500/30'
                }
              `}>
                {feedback[key].msg}
              </div>
            ) : (
              <div className="h-1"></div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-4 border-t border-white/10">
        <button 
          className="px-4 py-2 text-sm bg-white/10 hover:bg-white/15 border border-white/20 rounded text-white transition-colors cursor-pointer"
          onClick={handleClose}
        >
          Cancel
        </button>
        
        <button 
          className="px-4 py-2 text-sm bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded text-red-300 transition-colors cursor-pointer"
          onClick={handleResetToDefault}
        >
          Reset to Default
        </button>
        
        <button 
          className="ml-auto px-4 py-2 text-sm bg-blue-500 hover:bg-blue-600 border border-blue-600 rounded text-white transition-colors cursor-pointer"
          onClick={handleSave}
        >
          Save
        </button>
      </div>
    </div>
  );
}

