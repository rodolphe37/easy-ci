import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/hooks/local";
import { api } from "@/lib/api";
import { Button, Input } from "../ui/primitives";

/** Saisie d'un chemin de dossier, avec le sélecteur natif quand l'app desktop le permet. */
export function FolderField({
  value,
  onChange,
  pickerAvailable,
  pickerTitle,
  placeholder = "~/Developer",
  id,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  pickerAvailable: boolean;
  pickerTitle: string;
  placeholder?: string;
  id?: string;
  autoFocus?: boolean;
}) {
  const [picking, setPicking] = useState(false);

  const pick = async () => {
    setPicking(true);
    try {
      const selected = await api.pickFolder(pickerTitle);
      if (selected) onChange(selected);
    } catch (error) {
      toast.error("Sélection impossible", { description: errorMessage(error) });
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="flex gap-2">
      <Input
        id={id}
        autoFocus={autoFocus}
        icon={<FolderOpen />}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 flex-1 font-mono [&_input]:font-mono [&_input]:text-[12.5px]"
        spellCheck={false}
        autoComplete="off"
      />
      {pickerAvailable ? (
        <Button type="button" onClick={() => void pick()} loading={picking} className="h-9">
          Parcourir…
        </Button>
      ) : null}
    </div>
  );
}
