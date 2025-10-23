export type ThemeOption = 'light' | 'dark';

export const SUPPORTED_THEMES: readonly ThemeOption[] = ['light', 'dark'];

export const DEFAULT_THEME: ThemeOption = 'light';

export const LEGACY_LIGHT_THEMES: readonly string[] = ['default', 'earth', 'ocean', 'sand'];

export const THEME_STORAGE_KEY = 'theme';
