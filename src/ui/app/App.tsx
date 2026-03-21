import React, { useState, useEffect } from 'react';
import { MainInterfaceContainer } from '../components/MainInterfaceContainer';
import { AskView } from '../ask/AskView';
import { SettingsView } from '../settings/SettingsView';
import { ShortCutSettingsView } from '../settings/ShortCutSettingsView';
import { TranscriptView } from '../transcript/TranscriptView';
import { ScreenshotView } from '../screenshot/ScreenshotView';
import '../listen/audioCore/renderer.js';

type ViewType =
  | 'main'
  | 'listen'
  | 'ask'
  | 'settings'
  | 'shortcut-settings'
  | 'transcript'
  | 'screenshot'
  | 'history'
  | 'help'
  | 'setup';

interface AppProps {
  initialView?: ViewType;
}

export function App({ initialView }: AppProps = {}) {
  const [currentView, setCurrentView] = useState<ViewType>(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return (urlParams.get('view') as ViewType) || initialView || 'listen';
  });

  const [selectedProfile, setSelectedProfile] = useState(() =>
    localStorage.getItem('selectedProfile') || 'interview'
  );

  const [selectedLanguage, setSelectedLanguage] = useState(() => {
    let lang = localStorage.getItem('selectedLanguage') || 'en';
    // Language format migration for legacy users
    if (lang.includes('-')) {
      const newLang = lang.split('-')[0];
      console.warn(`[Migration] Correcting language format from "${lang}" to "${newLang}".`);
      localStorage.setItem('selectedLanguage', newLang);
      lang = newLang;
    }
    return lang;
  });

  const [isClickThrough, setIsClickThrough] = useState(false);

  // Listen for click-through toggle events
  useEffect(() => {
    if (!window.api) return;

    const handleClickThroughToggle = (_: any, isEnabled: boolean) => {
      setIsClickThrough(isEnabled);
    };

    window.api.muyuApp.onClickThroughToggled(handleClickThroughToggle);

    return () => {
      window.api.muyuApp.removeAllClickThroughListeners();
    };
  }, []);

  // Persist settings to localStorage
  useEffect(() => {
    localStorage.setItem('selectedProfile', selectedProfile);
  }, [selectedProfile]);

  useEffect(() => {
    localStorage.setItem('selectedLanguage', selectedLanguage);
  }, [selectedLanguage]);

  // Render the appropriate view
  const renderView = () => {
    switch (currentView) {
      case 'main':
        return <MainInterfaceContainer />;

      case 'listen':
        // ListenView functionality has been moved to MainView
        return <MainInterfaceContainer />;

      case 'ask':
        return <AskView />;

      case 'settings':
        return (
          <SettingsView
            selectedProfile={selectedProfile}
            selectedLanguage={selectedLanguage}
            onProfileChange={setSelectedProfile}
            onLanguageChange={setSelectedLanguage}
          />
        );

      case 'shortcut-settings':
        return <ShortCutSettingsView />;

      case 'transcript':
        return <TranscriptView />;

      case 'screenshot':
        return <ScreenshotView />;

      case 'history':
        return <div>History View (TODO)</div>;

      case 'help':
        return <div>Help View (TODO)</div>;

      case 'setup':
        return <div>Setup View (TODO)</div>;

      default:
        return <div>Unknown view: {currentView}</div>;
    }
  };

  return (
    <div className="block w-full h-full text-[var(--text-color)] bg-transparent rounded-[19px]">
      {renderView()}
    </div>
  );
}

