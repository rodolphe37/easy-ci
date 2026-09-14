import { useTranslation } from "react-i18next";
import type { ProviderId } from "@/lib/types";
import * as en from "./sections.en";
import * as fr from "./sections.fr";

/** Documentation intégrée dans la langue de l'interface (rédigée séparément pour chaque langue). */
function content(language: string | undefined) {
  return language === "fr" ? fr : en;
}

export function useDocSections() {
  const { i18n } = useTranslation();
  return content(i18n.resolvedLanguage).DOC_SECTIONS;
}

export function ProviderGuide({ provider }: { provider: ProviderId }) {
  const { i18n } = useTranslation();
  const Guide = content(i18n.resolvedLanguage).ProviderGuide;
  return <Guide provider={provider} />;
}
