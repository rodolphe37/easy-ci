import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

export const LANGUAGES = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export type LanguagePreference = LanguageCode | "system";

/** Le choix manuel est mémorisé localement pour afficher la bonne langue dès le démarrage, avant la lecture des préférences. */
export const LANGUAGE_STORAGE_KEY = "easy-ci.language";

// Le catalogue anglais doit avoir exactement la forme du catalogue français (vérifié à la compilation et par tests/test_i18n.py).
const english: typeof fr = en;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { fr: { translation: fr }, en: { translation: english } },
    supportedLngs: LANGUAGES.map((language) => language.code),
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    fallbackLng: "en",
    detection: { order: ["localStorage", "navigator"], lookupLocalStorage: LANGUAGE_STORAGE_KEY, caches: [] },
    interpolation: { escapeValue: false }, // React échappe déjà le contenu
    returnNull: false,
  });

export function currentLanguage(): LanguageCode {
  return i18n.resolvedLanguage === "fr" ? "fr" : "en";
}

/** Applique la préférence (« system » : langue du système) et la mémorise pour le prochain démarrage. */
export function applyLanguagePreference(preference: LanguagePreference | undefined) {
  try {
    if (preference && preference !== "system") localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
    else localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  } catch {
    // stockage indisponible : la langue sera détectée à nouveau au prochain démarrage
  }
  const target = preference && preference !== "system" ? preference : systemLanguage();
  if (i18n.resolvedLanguage !== target) void i18n.changeLanguage(target);
}

export function systemLanguage(): LanguageCode {
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const candidate of candidates) {
    const code = candidate?.slice(0, 2).toLowerCase();
    if (code === "fr" || code === "en") return code;
  }
  return "en";
}

export default i18n;
