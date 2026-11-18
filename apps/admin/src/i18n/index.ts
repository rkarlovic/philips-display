import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Locale } from '@slidecast/shared';
import hr from './hr.json';
import en from './en.json';

const STORAGE_KEY = 'slidecast.locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'hr' || saved === 'en') return saved;
  } catch {
    // storage unavailable
  }
  return 'hr';
}

void i18n.use(initReactI18next).init({
  resources: { hr: { translation: hr }, en: { translation: en } },
  lng: initialLocale(),
  fallbackLng: 'hr',
  interpolation: { escapeValue: false },
});

export function setLocale(locale: Locale): void {
  void i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

export default i18n;
