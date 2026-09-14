import { Check, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlays";
import { Button, SegmentedControl } from "@/components/ui/primitives";
import { useSettings } from "@/hooks/session";
import { LANGUAGES, type LanguagePreference } from "@/i18n";

/** Choix de la langue : suivre le système ou forcer une langue. Enregistré dans les préférences. */
export function LanguageSegmented() {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  return (
    <SegmentedControl<LanguagePreference>
      value={settings?.language ?? "system"}
      onChange={(language) => update({ language })}
      options={[{ value: "system", label: t("language.system") }, ...LANGUAGES.map((language) => ({ value: language.code, label: language.label }))]}
    />
  );
}

/** Variante compacte (écran de connexion) : icône et menu. */
export function LanguageMenu() {
  const { t, i18n } = useTranslation();
  const { settings, update } = useSettings();
  const preference = settings?.language ?? "system";
  const current = LANGUAGES.find((language) => language.code === i18n.resolvedLanguage) ?? LANGUAGES[1];
  const choose = (language: LanguagePreference) => update({ language });

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t("language.label")}>
          <Languages className="size-3.5" /> {current.label}
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem icon={preference === "system" ? <Check /> : <span className="size-4" />} onSelect={() => choose("system")}>
          {t("language.system")}
        </MenuItem>
        <MenuSeparator />
        {LANGUAGES.map((language) => (
          <MenuItem key={language.code} icon={preference === language.code ? <Check /> : <span className="size-4" />} onSelect={() => choose(language.code)}>
            {language.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
