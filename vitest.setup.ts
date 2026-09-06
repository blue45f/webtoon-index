import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterAll } from "vitest";
import { APP_I18N_NAMESPACES, STUDIO_I18N_NAMESPACES } from "@/shared/lib/i18n-asset-manifest";
import { registerI18nLocaleEntries, setAppI18nAssetSource } from "@/shared/lib/i18n";
import { parseStudioI18nDictionary, STUDIO_I18N_ASSET_LOCALES } from "@/src/domains/creator/studio-i18n-loader";
import "@/src/domains/catalog/references/reference-i18n";

const WEB_PUBLIC = path.resolve(process.cwd(), "apps/web/public");
for (const locale of STUDIO_I18N_ASSET_LOCALES) {
  const merged: Record<string, string> = {};
  for (const namespace of STUDIO_I18N_NAMESPACES) {
    const source = readFileSync(path.join(WEB_PUBLIC, "i18n", "studio", namespace, `${locale}.json`), "utf8");
    const dictionary = parseStudioI18nDictionary(source);
    if (!dictionary) throw new Error(`Invalid Studio test translation asset: ${locale}/${namespace}`);
    Object.assign(merged, dictionary);
  }
  registerI18nLocaleEntries(locale, merged);
}

setAppI18nAssetSource(async (assetLocale) => {
  const merged: Record<string, string> = {};
  for (const namespace of APP_I18N_NAMESPACES) {
    const assetPath = path.join(WEB_PUBLIC, "i18n", "app", namespace, `${assetLocale}.json`);
    if (!existsSync(assetPath)) return null;
    Object.assign(merged, JSON.parse(readFileSync(assetPath, "utf8")));
  }
  return JSON.stringify(merged);
});
//
// The timer is captured here, at setup time, because a test file that installs fake timers and
// never restores them would otherwise leave this hook awaiting a `setTimeout` that never fires —
// which is exactly how the first attempt at this hung StudioCompanionReferenceDisplay for 30s.
const scheduleRealMacrotask = globalThis.setTimeout;

if (typeof document !== "undefined") {
  afterAll(async () => {
    await new Promise((resolve) => { scheduleRealMacrotask(resolve, 0); });
  });
}
