import { useColorScheme } from 'react-native';

// Same token values as the web app (apps/web/src/styles/tokens.css).
const light = {
  bg: '#eef0f3',
  surface: '#ffffff',
  surface2: '#f5f6f8',
  surface3: '#eceef1',
  text: '#1d2126',
  text2: '#565d66',
  text3: '#6f7680',
  border: '#dfe2e6',
  borderStrong: '#c7cbd1',
  accent: '#1765cc',
  accentSoft: '#e6effc',
  onAccent: '#ffffff',
  explore: '#0b7d56',
  exploreSoft: '#e3f3ec',
  exploreLine: '#13985f',
  danger: '#c5221f',
  dangerSoft: '#fce8e6',
  warning: '#9a5b00',
  warningSoft: '#fdf1dc',
};

const dark: typeof light = {
  bg: '#15171a',
  surface: '#202327',
  surface2: '#272b30',
  surface3: '#30353b',
  text: '#e8eaed',
  text2: '#aeb4bb',
  text3: '#969ca4',
  border: '#363b41',
  borderStrong: '#4a5057',
  accent: '#7eb0f9',
  accentSoft: '#1e3452',
  onAccent: '#0c1a2e',
  explore: '#62d19f',
  exploreSoft: '#173a2b',
  exploreLine: '#49c28c',
  danger: '#f28b82',
  dangerSoft: '#3c1f1d',
  warning: '#f6c26b',
  warningSoft: '#3a2c12',
};

export type Theme = typeof light & { dark: boolean };

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? { ...dark, dark: true } : { ...light, dark: false };
}

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32 } as const;
export const radius = { panel: 16, control: 10, pill: 999 } as const;
