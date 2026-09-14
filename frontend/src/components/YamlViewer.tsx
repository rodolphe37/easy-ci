import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";

// Couleurs via variables CSS : le thème clair/sombre s'applique sans recréer l'éditeur.
const highlight = HighlightStyle.define([
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: "var(--accent)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--ansi-green)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--ansi-magenta)" },
  { tag: tags.comment, color: "var(--fg-subtle)", fontStyle: "italic" },
  { tag: [tags.punctuation, tags.separator, tags.squareBracket, tags.brace], color: "var(--fg-subtle)" },
  { tag: [tags.keyword, tags.meta, tags.labelName], color: "var(--ansi-cyan)" },
  { tag: tags.typeName, color: "var(--ansi-yellow)" },
]);

const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--fg)", fontSize: "12.5px", height: "100%" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.65" },
  ".cm-content": { padding: "12px 0", caretColor: "var(--accent)" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--fg-subtle)", border: "none", paddingLeft: "8px" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 4px", minWidth: "32px" },
  ".cm-activeLine": { backgroundColor: "var(--accent-soft)" },
  ".cm-line": { padding: "0 16px" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--accent-soft) !important" },
});

export function YamlViewer({ content, highlightLine }: { content: string; highlightLine?: number | null }) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!container.current) return;
    view.current = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          yaml(),
          syntaxHighlighting(highlight),
          theme,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({ tabindex: "0" }),
        ],
      }),
    });
    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, []);

  // Mise à jour du contenu sans recréer la vue : la position de défilement est conservée (aperçu en direct).
  useEffect(() => {
    const current = view.current;
    if (!current || current.state.doc.toString() === content) return;
    current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: content } });
  }, [content]);

  useEffect(() => {
    if (!view.current || !highlightLine) return;
    const line = view.current.state.doc.line(Math.min(highlightLine, view.current.state.doc.lines));
    view.current.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
  }, [highlightLine, content]);

  return <div ref={container} className="scrollbar-thin h-full overflow-auto [&_.cm-editor]:h-full" />;
}
