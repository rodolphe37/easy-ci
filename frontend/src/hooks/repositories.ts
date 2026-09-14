import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import i18n from "@/i18n";
import { api, ApiError } from "@/lib/api";
import type { ProviderId } from "@/lib/types";
import { useSettings } from "./session";

/** Ajout, retrait, masquage des dépôts suivis (identifiés par leur clé « fournisseur:chemin »). */
export function useRepositoryActions() {
  const queryClient = useQueryClient();
  const { settings, update } = useSettings();

  const add = useMutation({
    mutationFn: ({ reference, provider }: { reference: string; provider?: ProviderId }) => api.addRepository(reference, provider),
    onSuccess: ({ repository, settings: saved }) => {
      queryClient.setQueryData(["settings"], saved);
      void queryClient.invalidateQueries({ queryKey: ["repositories", repository.provider] });
      toast.success(i18n.t("repositories.added", { name: repository.full_name }), { description: i18n.t("repositories.addedDescription") });
    },
  });

  const remove = useMutation({
    mutationFn: api.removeRepository,
    onSuccess: (saved, key) => {
      queryClient.setQueryData(["settings"], saved);
      void queryClient.invalidateQueries({ queryKey: ["repositories", key.split(":", 1)[0]] });
      toast(i18n.t("repositories.untracked", { name: key.slice(key.indexOf(":") + 1) }));
    },
    onError: (error) => toast.error(i18n.t("common.actionFailed"), { description: error instanceof ApiError ? error.message : String(error) }),
  });

  const hidden = settings?.hidden_repositories ?? [];

  const hide = (key: string) => {
    if (hidden.some((item) => item.toLowerCase() === key.toLowerCase())) return;
    update({ hidden_repositories: [...hidden, key] });
    toast(i18n.t("repositories.hidden", { name: key.slice(key.indexOf(":") + 1) }), {
      description: i18n.t("repositories.hiddenDescription"),
      action: { label: i18n.t("common.undo"), onClick: () => update({ hidden_repositories: hidden }) },
    });
  };

  const unhide = (key: string) => update({ hidden_repositories: hidden.filter((item) => item.toLowerCase() !== key.toLowerCase()) });

  return { add, remove, hide, unhide };
}
