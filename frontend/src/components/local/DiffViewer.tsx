import { cn } from "@/lib/utils";

interface DiffLine {
  kind: "add" | "remove" | "context" | "hunk" | "meta";
  text: string;
  oldNumber?: number;
  newNumber?: number;
}

function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const raw of diff.replace(/\n$/, "").split("\n")) {
    if (raw.startsWith("diff --git") || raw.startsWith("index ") || raw.startsWith("--- ") || raw.startsWith("+++ ") || raw.startsWith("new file") || raw.startsWith("deleted file")) {
      lines.push({ kind: "meta", text: raw });
      continue;
    }
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      lines.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("+")) {
      lines.push({ kind: "add", text: raw.slice(1), newNumber: newLine++ });
    } else if (raw.startsWith("-")) {
      lines.push({ kind: "remove", text: raw.slice(1), oldNumber: oldLine++ });
    } else if (raw.startsWith("\\")) {
      lines.push({ kind: "meta", text: raw });
    } else {
      lines.push({ kind: "context", text: raw.slice(1), oldNumber: oldLine++, newNumber: newLine++ });
    }
  }
  return lines;
}

/** Diff unifié lisible : numéros de ligne des deux versions, ajouts en vert, suppressions en rouge. */
export function DiffViewer({ diff, className }: { diff: string; className?: string }) {
  const lines = parseUnifiedDiff(diff).filter((line) => line.kind !== "meta");
  const added = lines.filter((line) => line.kind === "add").length;
  const removed = lines.filter((line) => line.kind === "remove").length;

  return (
    <div className={cn("overflow-hidden rounded-xl border border-line", className)}>
      <div className="flex items-center gap-3 border-b border-line bg-surface-2/60 px-3 py-1.5 text-[12px]">
        <span className="font-medium text-success tabular">+{added}</span>
        <span className="font-medium text-failure tabular">−{removed}</span>
        <span className="ml-auto text-fg-subtle">
          <span className="text-failure">−</span> distant · <span className="text-success">+</span> local
        </span>
      </div>
      <div className="scrollbar-thin max-h-[420px] overflow-auto bg-log py-1 font-mono text-[12px] leading-5">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, index) =>
              line.kind === "hunk" ? (
                <tr key={index} className="bg-accent-soft/60 text-fg-subtle">
                  <td colSpan={4} className="px-3 py-0.5 text-[11.5px] select-none">
                    {line.text}
                  </td>
                </tr>
              ) : (
                <tr key={index} className={cn(line.kind === "add" && "bg-success/10", line.kind === "remove" && "bg-failure/10")}>
                  <td className="w-10 pr-2 text-right align-top text-fg-subtle/70 select-none">{line.oldNumber ?? ""}</td>
                  <td className="w-10 pr-2 text-right align-top text-fg-subtle/70 select-none">{line.newNumber ?? ""}</td>
                  <td
                    className={cn(
                      "w-4 text-center align-top select-none",
                      line.kind === "add" ? "text-success" : line.kind === "remove" ? "text-failure" : "text-fg-subtle",
                    )}
                  >
                    {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : ""}
                  </td>
                  <td className="pr-4 break-all whitespace-pre-wrap text-fg">{line.text || " "}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
