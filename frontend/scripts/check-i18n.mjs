// Vérifie l'internationalisation de l'interface :
//  1. aucun texte français écrit en dur dans les composants (tout passe par t() / i18n.t()) ;
//  2. les catalogues de chaque langue ont exactement les mêmes clés et les mêmes variables {{…}}.
// Usage : npm run i18n:check  (option --list pour afficher tous les textes détectés)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseAst } from "rolldown/parseAst"; // analyseur JavaScript/TypeScript déjà fourni par Vite

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const LOCALES = join(SRC, "i18n", "locales");
// La documentation intégrée est rédigée par langue dans des fichiers dédiés.
const EXCLUDED = [/components\/docs\/sections\.\w+\.tsx$/, /i18n\//];

const FRENCH = /[àâçéèêëîïôûùüÿœÀÂÇÉÈÊÎÔÛ«»]|\b(le|la|les|des|du|une|pour|avec|dans|sur|aucun|aucune|est|pas|vos|votre|puis|ou|et|en cours|depuis|erreurs?|avertissements?|annuler|enregistrer|relancer|dossiers?|fichiers?|valide|commiter|envoyer|suivant|jamais|toujours)\b/i;
// Noms propres et textes identiques dans toutes les langues.
const UNTRANSLATED = new Set(["Easy CI", "GitHub", "GitLab", "Bitbucket", "GitHub Actions", "GitLab CI/CD", "Bitbucket Pipelines", "Push", "Diff", "Lint", "Build", "Tests", "Job", "Jobs", "Pipeline", "Pipelines", "Workflows", "YAML", "CI", "Git", "HEAD", "Esc", "API", "SSH", "HTTPS", "Docker", "matrix"]);
const IGNORED_ATTRIBUTES = new Set(["className", "href", "to", "src", "type", "id", "key", "role", "variant", "size", "side", "align", "name", "autoComplete", "value"]);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|mts)$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

const problems = [];
for (const path of files(SRC)) {
  const rel = relative(SRC, path);
  if (EXCLUDED.some((pattern) => pattern.test(rel))) continue;
  const code = readFileSync(path, "utf8");
  const program = parseAst(code, { lang: path.endsWith(".tsx") ? "tsx" : "ts" }, path);
  const lineOf = (offset) => code.slice(0, offset).split("\n").length;
  const report = (node, text) => problems.push(`${rel}:${lineOf(node.start)}: ${JSON.stringify(text.trim().slice(0, 90))}`);
  const callee = (node) => (node?.type === "CallExpression" ? code.slice(node.callee.start, node.callee.end) : "");

  const visit = (node, parent) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "ImportDeclaration" || node.type.startsWith("TS")) return;
    if (node.type === "JSXText") {
      if (/[A-Za-zÀ-ÿ]{2,}/.test(node.value) && !UNTRANSLATED.has(node.value.trim())) report(node, node.value);
    } else if ((node.type === "Literal" && typeof node.value === "string") || node.type === "TemplateLiteral") {
      const text = node.type === "Literal" ? node.value : node.quasis.map((q) => q.value.cooked).join("{}");
      const attribute = parent?.type === "JSXAttribute" ? parent.name.name : null;
      const call = callee(parent);
      const translated = /(^|\.)t$/.test(call) || call === "cn";
      if (!(attribute && IGNORED_ATTRIBUTES.has(attribute)) && !translated && FRENCH.test(text)) report(node, text);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "parent") continue;
      if (Array.isArray(value)) value.forEach((child) => visit(child, node));
      else if (value && typeof value === "object") visit(value, node);
    }
  };
  visit(program, null);
}

// Cohérence des catalogues
const flatten = (object, prefix = "") =>
  Object.entries(object).flatMap(([key, value]) => (typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]));
const base = key => key.replace(/_(zero|one|two|few|many|other)$/, "");
const variables = (text) => [...text.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)].map((m) => m[1]).sort().join(",");
const catalogs = Object.fromEntries(
  readdirSync(LOCALES).filter((name) => name.endsWith(".json")).map((name) => [name.replace(".json", ""), new Map(flatten(JSON.parse(readFileSync(join(LOCALES, name), "utf8"))))]),
);
const reference = catalogs.fr;
for (const [language, catalog] of Object.entries(catalogs)) {
  if (language === "fr") continue;
  const referenceBases = new Set([...reference.keys()].map(base));
  const catalogBases = new Set([...catalog.keys()].map(base));
  for (const key of referenceBases) if (!catalogBases.has(key)) problems.push(`locales/${language}.json : clé manquante « ${key} »`);
  for (const key of catalogBases) if (!referenceBases.has(key)) problems.push(`locales/${language}.json : clé inconnue « ${key} »`);
  for (const [key, text] of reference) {
    const other = catalog.get(key) ?? catalog.get(`${base(key)}_other`);
    if (other !== undefined && variables(other) !== variables(text)) problems.push(`locales/${language}.json : variables différentes pour « ${key} »`);
    if (other !== undefined && !String(other).trim()) problems.push(`locales/${language}.json : traduction vide pour « ${key} »`);
  }
}

if (problems.length) {
  console.error(`${problems.length} problème(s) d'internationalisation :\n${problems.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Internationalisation : aucun texte en dur, catalogues cohérents.");
}
