import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  DEFAULT_PREFERENCES, PREFERENCES_STORAGE_KEY, palettes, parsePreferences, translate,
  type Language, type Palette, type ThemeMode, type TranslationKey,
} from './preferencesModel';

type PreferenceContextValue = {
  theme: ThemeMode;
  language: Language;
  colors: Palette;
  t: (key: TranslationKey, args?: Record<string, string | number>) => string;
  setTheme: (value: ThemeMode) => void;
  setLanguage: (value: Language) => void;
};

const PreferenceContext = createContext<PreferenceContextValue | null>(null);

export function PreferencesProvider({children}: {children: React.ReactNode}) {
  const [prefs, setPrefs] = useState(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(PREFERENCES_STORAGE_KEY).then(raw => {
      if (active) setPrefs(parsePreferences(raw));
    }).catch(() => {
      // Storage can be unavailable; stay in safe, light/Thai defaults.
    }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  // Only persist AFTER loading, to avoid overwriting the previous selection.
  useEffect(() => {
    if (loaded) void AsyncStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(prefs)).catch(() => {
      // UI still works if local storage is temporarily unavailable.
    });
  }, [prefs, loaded]);

  const context = useMemo<PreferenceContextValue>(() => ({
    theme: prefs.theme, language: prefs.language, colors: palettes[prefs.theme],
    t: (key, args) => translate(prefs.language, key, args),
    setTheme: theme => setPrefs(previous => ({...previous, theme})),
    setLanguage: language => setPrefs(previous => ({...previous, language})),
  }), [prefs]);

  // Prevent showing the wrong saved language/theme during startup or account sign-in.
  if (!loaded) return <View style={{flex:1, backgroundColor:palettes.light.background}} />;
  return <PreferenceContext.Provider value={context}>{children}</PreferenceContext.Provider>;
}

export function usePreferences(): PreferenceContextValue {
  const context = useContext(PreferenceContext);
  if (!context) throw new Error('PreferencesProvider missing');
  return context;
}

/** Always visible outside authentication so Guest, Google and Demo use the same controls. */
export function PreferenceControls() {
  const {theme, language, colors, setTheme, setLanguage, t} = usePreferences();
  const s = useMemo(() => StyleSheet.create({
    row:{flexDirection:'row',justifyContent:'flex-end',alignItems:'center',gap:8,backgroundColor:colors.background,paddingHorizontal:14,paddingVertical:7,flexWrap:'wrap'},
    group:{flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:colors.line,borderRadius:14,overflow:'hidden'},
    button:{paddingHorizontal:12,paddingVertical:8,backgroundColor:colors.surface},
    selected:{backgroundColor:colors.accent},
    text:{color:colors.text,fontSize:12,fontWeight:'700'},
    selectedText:{color:colors.accentOn},
  }), [colors]);
  return <View style={s.row}>
    <View style={s.group}>
      {(['light','dark'] as const).map(mode=>
        <Pressable key={mode} accessibilityRole="button" accessibilityState={{selected:theme===mode}}
          accessibilityLabel={t(mode)} onPress={() => setTheme(mode)}
          style={[s.button,theme===mode&&s.selected]}>
          <Text style={[s.text,theme===mode&&s.selectedText]}>{mode==='light'?'☀ ': '☾ '}{t(mode)}</Text>
        </Pressable>
      )}
    </View>
    <View style={s.group}>
      {(['th','en'] as const).map(code=>
        <Pressable key={code} accessibilityRole="button" accessibilityState={{selected:language===code}}
          accessibilityLabel={code.toUpperCase()} onPress={() => setLanguage(code)}
          style={[s.button,language===code&&s.selected]}>
          <Text style={[s.text,language===code&&s.selectedText]}>{code.toUpperCase()}</Text>
        </Pressable>
      )}
    </View>
  </View>;
}
