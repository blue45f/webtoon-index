// Regenerates lib/i18n-locale-catalog.ts from the shipped app dictionaries.
//
// The catalog is the app shell's only compiled knowledge about locales it does not bundle:
// which ones have an asset, and how much of each asset is actually translated. Both facts are
// measured here from apps/web/public/i18n/app/<namespace>/<locale>.json — never authored by hand — so the language picker
// cannot advertise a locale as translated when it renders English.
//
//   node scripts/generate-app-i18n-catalog.mjs
//
// apps/web/src/shared/lib/__tests__/i18n-locale-assets.test.ts fails when the committed catalog drifts from disk.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const assetDirectory = path.join(repoRoot, "apps", "web", "public", "i18n", "app");
const catalogPath = path.join(repoRoot, "apps", "web", "lib", "i18n-locale-catalog.ts");

/** Locales compiled into the app shell so the fallback chain never awaits I/O. */
const BUILT_IN_LOCALES = ["ko", "en"];
const REFERENCE_LOCALE = "en";
const TRANSLATED_LOCALE_THRESHOLD = 0.5;

export function readAppLocaleDictionaries(directory = assetDirectory) {
  const dictionaries = new Map();
  for (const fileName of readdirSync(directory).sort()) {
    if (!fileName.endsWith(".json")) continue;
    const locale = fileName.slice(0, -".json".length);
    dictionaries.set(locale, JSON.parse(readFileSync(path.join(directory, fileName), "utf8")));
  }
  return dictionaries;
}

/**
 * Share of English keys whose value differs from the English source string.
 * A floor rather than a certificate — a legitimately identical string counts as untranslated —
 * but decisive at the extremes.
 */
export function measureTranslatedRatio(dictionary, reference) {
  const referenceKeys = Object.keys(reference);
  if (referenceKeys.length === 0) return 0;
  let distinct = 0;
  for (const key of referenceKeys) {
    const value = dictionary[key];
    if (value !== undefined && value !== reference[key]) distinct++;
  }
  return Math.round((distinct / referenceKeys.length) * 10000) / 10000;
}

export function buildCatalogSource(dictionaries) {
  const reference = dictionaries.get(REFERENCE_LOCALE);
  if (!reference) {
    throw new Error(`Missing reference locale asset "${REFERENCE_LOCALE}".`);
  }
  for (const locale of BUILT_IN_LOCALES) {
    if (!dictionaries.has(locale)) {
      throw new Error(`Built-in locale "${locale}" has no published asset.`);
    }
  }

  const locales = [...dictionaries.keys()].sort();
  const ratios = new Map(
    locales.map((locale) => [
      locale,
      locale === REFERENCE_LOCALE ? 1 : measureTranslatedRatio(dictionaries.get(locale), reference),
    ]),
  );

  const lines = [
    "// GENERATED FILE — do not hand-edit.",
    "//",
    "// Source of truth: apps/web/public/i18n/app/<namespace>/<locale>.json.",
    "// Regenerate with `node scripts/generate-app-i18n-catalog.mjs`.",
    "// apps/web/src/shared/lib/__tests__/i18n-locale-assets.test.ts fails when this catalog drifts from the assets.",
    "",
    "/** Locales compiled into the app shell so the fallback chain never awaits I/O. */",
    `export const APP_I18N_BUILT_IN_LOCALES = [${BUILT_IN_LOCALES.map((locale) => JSON.stringify(locale)).join(", ")}] as const;`,
    "",
    "/** Every locale that has a `apps/web/public/i18n/app/<namespace>/<locale>.json` asset. */",
    "export const APP_I18N_ASSET_LOCALES = [",
    ...locales.map((locale) => `  ${JSON.stringify(locale)},`),
    "] as const;",
    "",
    "/**",
    " * Measured share of English keys whose value in this locale differs from the English source",
    " * string. It is a floor, not a certificate: a legitimately identical string (a brand name,",
    ' * "OK") counts as untranslated. It is still decisive at the extremes — a locale sitting at',
    " * 0.02 renders as English across 98% of the product surface.",
    " */",
    "export const APP_I18N_LOCALE_TRANSLATED_RATIO: Readonly<Record<string, number>> = {",
    ...locales.map((locale) => `  ${JSON.stringify(locale)}: ${ratios.get(locale)},`),
    "};",
    "",
    "/**",
    " * At or above this ratio a locale may be presented as a translated language. Below it the UI",
    " * must say so, because the user is really getting English with a handful of localized labels.",
    " */",
    `export const APP_I18N_TRANSLATED_LOCALE_THRESHOLD = ${TRANSLATED_LOCALE_THRESHOLD};`,
    "",
  ];
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const source = buildCatalogSource(readAppLocaleDictionaries());
  writeFileSync(catalogPath, source, "utf8");
  process.stdout.write(`wrote ${path.relative(repoRoot, catalogPath)}\n`);
}
