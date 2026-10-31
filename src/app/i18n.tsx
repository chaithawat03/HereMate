import { useCallback, useMemo } from 'react';
import { usePreferences } from '../ui/PreferencesProvider';
import { S, format, type StringKey } from './strings';
import { palette } from './theme';

/** Language, theme and palette for v2 screens, persisted by the existing PreferencesProvider. */
export function useV2() {
  const { theme, language, setTheme, setLanguage } = usePreferences();
  const c = useMemo(() => palette(theme), [theme]);
  const t = useCallback(
    (key: StringKey, args?: Record<string, string | number>) => format(S[language][key], args),
    [language],
  );
  return { t, lang: language, theme, c, setTheme, setLanguage };
}
