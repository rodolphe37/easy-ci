import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { yaml } from "@codemirror/lang-yaml";
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ProviderId, ValidationProblem } from "@/lib/types";

export interface CiEditorHandle {
  goTo: (line: number, column?: number | null) => void;
  focus: () => void;
}

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
  "&": { backgroundColor: "transparent", color: "var(--fg)", fontSize: "13px", height: "100%" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.7" },
  ".cm-content": { padding: "14px 0", caretColor: "var(--accent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--fg-subtle)", border: "none" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 6px", minWidth: "36px" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--accent) 6%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--fg)" },
  ".cm-line": { padding: "0 18px 0 8px" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in oklab, var(--accent) 22%, transparent) !important" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in oklab, var(--running) 20%, transparent)" },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in oklab, var(--accent) 18%, transparent)", outline: "none" },
  ".cm-foldGutter .cm-gutterElement": { color: "var(--fg-subtle)", padding: "0 4px" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--failure)", textUnderlineOffset: "4px" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--running)", textUnderlineOffset: "4px" },
  ".cm-lint-marker-error": { content: "none" },
  ".cm-gutter-lint": { width: "14px" },
  ".cm-tooltip": { backgroundColor: "var(--elevated)", color: "var(--fg)", border: "1px solid var(--line-strong)", borderRadius: "10px", overflow: "hidden", boxShadow: "0 12px 40px -8px rgb(0 0 0 / 0.35)" },
  ".cm-tooltip-lint": { padding: "0" },
  ".cm-diagnostic": { padding: "6px 10px", fontFamily: "var(--font-sans)", fontSize: "12.5px", borderLeftWidth: "3px" },
  ".cm-diagnostic-error": { borderLeftColor: "var(--failure)" },
  ".cm-diagnostic-warning": { borderLeftColor: "var(--running)" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", fontSize: "12.5px", maxHeight: "240px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent-soft)", color: "var(--fg)" },
  ".cm-completionDetail": { fontFamily: "var(--font-sans)", color: "var(--fg-subtle)", marginLeft: "12px", fontStyle: "normal" },
  ".cm-panels": { backgroundColor: "var(--surface-2)", color: "var(--fg)", borderColor: "var(--line)" },
  ".cm-panel.cm-search": { padding: "8px 10px", fontFamily: "var(--font-sans)", fontSize: "12.5px" },
  ".cm-panel.cm-search input, .cm-panel.cm-search button": { borderRadius: "6px", border: "1px solid var(--line-strong)", backgroundColor: "var(--surface)", color: "var(--fg)", padding: "2px 6px" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in oklab, var(--running) 30%, transparent)" },
});

/** Mots-clés proposés en début de ligne, par plateforme. */
const KEYWORDS: Record<ProviderId, [string, string][]> = {
  github: [
    ["name", "nom du workflow ou de l'étape"], ["on", "déclencheurs"], ["jobs", "liste des jobs"], ["runs-on", "machine d'exécution"],
    ["steps", "étapes du job"], ["uses", "action à utiliser"], ["run", "commande shell"], ["with", "paramètres de l'action"],
    ["env", "variables d'environnement"], ["needs", "jobs dont celui-ci dépend"], ["if", "condition"], ["strategy", "matrice de build"],
    ["matrix", "combinaisons"], ["permissions", "droits du GITHUB_TOKEN"], ["concurrency", "exécutions concurrentes"],
    ["timeout-minutes", "durée maximale"], ["environment", "environnement de déploiement"], ["outputs", "sorties du job"],
    ["services", "conteneurs de service"], ["container", "conteneur du job"], ["continue-on-error", "ne pas bloquer en cas d'échec"],
    ["workflow_dispatch", "déclenchement manuel"], ["pull_request", "déclencheur pull request"], ["push", "déclencheur push"],
    ["schedule", "planification cron"], ["branches", "filtre de branches"], ["paths", "filtre de fichiers"], ["working-directory", "dossier de travail"],
  ],
  gitlab: [
    ["stages", "ordre des stages"], ["stage", "stage du job"], ["script", "commandes du job"], ["image", "image Docker"],
    ["before_script", "commandes préalables"], ["after_script", "commandes finales"], ["variables", "variables"], ["rules", "règles d'exécution"],
    ["needs", "dépendances"], ["artifacts", "fichiers conservés"], ["cache", "cache entre pipelines"], ["only", "restriction (obsolète)"],
    ["when", "moment d'exécution"], ["allow_failure", "échec non bloquant"], ["extends", "hérite d'un modèle"], ["include", "fichiers inclus"],
    ["services", "services Docker"], ["tags", "tags du runner"], ["environment", "environnement de déploiement"], ["parallel", "exécution parallèle"],
    ["trigger", "pipeline aval"], ["interruptible", "annulable"], ["timeout", "durée maximale"], ["retry", "nouvelles tentatives"],
    ["workflow", "règles du pipeline"], ["default", "valeurs par défaut"], ["if", "condition d'une règle"], ["paths", "fichiers"],
  ],
  bitbucket: [
    ["image", "image Docker"], ["pipelines", "pipelines"], ["default", "toutes les branches"], ["branches", "par branche"],
    ["pull-requests", "pull requests"], ["tags", "par tag"], ["custom", "pipelines manuels"], ["step", "étape"], ["name", "nom de l'étape"],
    ["script", "commandes"], ["caches", "caches"], ["artifacts", "fichiers transmis"], ["deployment", "environnement"],
    ["trigger", "manual ou automatic"], ["size", "taille du runner"], ["max-time", "durée maximale"], ["parallel", "étapes parallèles"],
    ["services", "services"], ["definitions", "définitions réutilisables"], ["after-script", "commandes finales"], ["pipe", "pipe Atlassian"],
  ],
};

function keywordCompletion(provider: ProviderId) {
  const options = KEYWORDS[provider].map(([label, detail]) => ({ label, detail, type: "property", apply: `${label}: ` }));
  return (context: CompletionContext) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    // Uniquement là où une clé est attendue : début de ligne (après indentation ou « - »).
    const match = before.match(/^\s*(?:-\s+)?([A-Za-z_-]*)$/);
    if (!match) return null;
    const word = match[1];
    if (!word && !context.explicit) return null;
    return { from: context.pos - word.length, options, validFor: /^[A-Za-z_-]*$/ };
  };
}

export const CiEditor = forwardRef<
  CiEditorHandle,
  {
    value: string;
    provider: ProviderId;
    problems: ValidationProblem[];
    onChange: (value: string) => void;
    onSave: () => void;
    /** Changer de fichier recrée l'éditeur (historique d'annulation propre au fichier). */
    documentKey: string;
  }
>(({ value, provider, problems, onChange, onSave, documentKey }, ref) => {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };

  useEffect(() => {
    if (!container.current) return;
    const editor = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          foldGutter({ openText: "▾", closedText: "▸" }),
          lintGutter(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          indentOnInput(),
          indentUnit.of("  "),
          EditorState.tabSize.of(2),
          bracketMatching(),
          closeBrackets(),
          highlightSelectionMatches(),
          search({ top: true }),
          autocompletion({ override: [keywordCompletion(provider)], icons: false }),
          yaml(),
          syntaxHighlighting(highlight),
          theme,
          placeholder("Contenu du fichier YAML…"),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (callbacks.current.onSave(), true) },
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...searchKeymap,
            ...historyKeymap,
            indentWithTab,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    editor.focus();
    return () => {
      editor.destroy();
      view.current = null;
    };
    // L'éditeur n'est recréé qu'au changement de document ; les frappes restent locales à CodeMirror.
  }, [documentKey, provider]);

  // Remplacement externe du contenu (rechargement depuis le disque, annulation des modifications).
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    }
  }, [value]);

  // Diagnostics de validation → soulignés et marges.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const doc = editor.state.doc;
    const diagnostics: Diagnostic[] = problems
      .filter((problem) => problem.line !== null)
      .map((problem) => {
        const line = doc.line(Math.min(Math.max(problem.line ?? 1, 1), doc.lines));
        const from = Math.min(line.from + Math.max((problem.column ?? 1) - 1, 0), line.to);
        const wordEnd = line.text.slice(from - line.from).search(/[\s:,\]]|$/);
        const to = Math.max(from + Math.max(wordEnd, 1), from + 1);
        return { from, to: Math.min(to, line.to === line.from ? line.to : line.to), severity: problem.severity, message: problem.message };
      })
      .filter((diagnostic) => diagnostic.to >= diagnostic.from);
    editor.dispatch(setDiagnostics(editor.state, diagnostics));
  }, [problems, documentKey]);

  useImperativeHandle(ref, () => ({
    goTo: (lineNumber, column) => {
      const editor = view.current;
      if (!editor) return;
      const line = editor.state.doc.line(Math.min(Math.max(lineNumber, 1), editor.state.doc.lines));
      const position = Math.min(line.from + Math.max((column ?? 1) - 1, 0), line.to);
      editor.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: "center" }) });
      editor.focus();
    },
    focus: () => view.current?.focus(),
  }));

  return <div ref={container} className="scrollbar-thin h-full overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto" />;
});
CiEditor.displayName = "CiEditor";
