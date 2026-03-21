/**
 * Format shortcut accelerator keys to readable symbols
 */
export function formatShortcutLabel(accelerator?: string): string {
  if (!accelerator) return '';
  
  const keyMap: Record<string, string> = {
    Cmd: '⌘',
    Command: '⌘',
    Ctrl: '⌃',
    Control: '⌃',
    Alt: '⌥',
    Option: '⌥',
    Shift: '⇧',
    Enter: '↵',
    Backspace: '⌫',
    Delete: '⌦',
    Tab: '⇥',
    Escape: '⎋',
    Up: '↑',
    Down: '↓',
    Left: '←',
    Right: '→',
  };
  
  return accelerator
    .split('+')
    .map(key => keyMap[key] || key)
    .join(' ');
}

/**
 * Format elapsed time in seconds to MM:SS format
 */
export function formatElapsedTime(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Get speaker class name for styling
 */
export function getSpeakerClass(speaker: string): string {
  return speaker.toLowerCase() === 'me' ? 'me' : 'them';
}

/**
 * Calculate remaining time in minutes
 */
export function calculateRemainingMinutes(totalSeconds: number, elapsedSeconds: number): number {
  return Math.max(0, Math.ceil((totalSeconds - elapsedSeconds) / 60));
}

