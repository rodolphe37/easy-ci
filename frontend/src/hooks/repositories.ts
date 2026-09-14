import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
      toast.success(`${repository.full_name} ajouté`, { description: "Ses pipelines vont être analysés." });
    },
  });

  const remove = useMutation({
    mutationFn: api.removeRepository,
    onSuccess: (saved, key) => {
      queryClient.setQueryData(["settings"], saved);
      void queryClient.invalidateQueries({ queryKey: ["repositories", key.split(":", 1)[0]] });
      toast(`${key.slice(key.indexOf(":") + 1)} n'est plus suivi`);
    },
    onError: (error) => toast.error("Action impossible", { description: error instanceof ApiError ? error.message : String(error) }),
  });

  const hidden = settings?.hidden_repositories ?? [];

  const hide = (key: string) => {
    if (hidden.some((item) => item.toLowerCase() === key.toLowerCase())) return;
    update({ hidden_repositories: [...hidden, key] });
    toast(`${key.slice(key.indexOf(":") + 1)} est masqué`, {
      description: "Retrouvez-le dans Paramètres › Dépôts suivis.",
      action: { label: "Annuler", onClick: () => update({ hidden_repositories: hidden }) },
    });
  };

  const unhide = (key: string) => update({ hidden_repositories: hidden.filter((item) => item.toLowerCase() !== key.toLowerCase()) });

  return { add, remove, hide, unhide };
}
