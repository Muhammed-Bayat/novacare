import { useEffect, useState } from 'react';

const displayNameStorageKey = 'novaCareDisplayName';

function readStoredDisplayName(): string | undefined {
  const stored = window.localStorage.getItem(displayNameStorageKey)?.trim();
  return stored || undefined;
}

export function useStoredDisplayName(fallbackDisplayName: string): [string, (nextDisplayName: string) => void] {
  const [displayName, setDisplayName] = useState(() => readStoredDisplayName() ?? fallbackDisplayName);

  useEffect(() => {
    if (!readStoredDisplayName()) setDisplayName(fallbackDisplayName);
  }, [fallbackDisplayName]);

  function saveDisplayName(nextDisplayName: string) {
    const savedDisplayName = nextDisplayName.trim() || fallbackDisplayName;
    setDisplayName(savedDisplayName);
    window.localStorage.setItem(displayNameStorageKey, savedDisplayName);
  }

  return [displayName, saveDisplayName];
}
