import "i18next";
import type fr from "./locales/fr.json";

// Clés de traduction typées : une clé absente du catalogue français est une erreur de compilation.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof fr };
    returnNull: false;
  }
}
