import { describe, expect, it } from "vitest";

import {
  REFERENCE_ERROR_MESSAGE_KEYS,
  REFERENCE_FIELD_LABEL_KEYS,
  REFERENCE_GUIDE_SECTIONS,
  REFERENCE_JOURNEY_STEPS,
  REFERENCE_METADATA_LABEL_KEYS,
  REFERENCE_NOTICE_KEYS,
  REFERENCE_VIEW_TAB_KEYS,
} from "./reference-i18n";

import { i18nDict } from "@/shared/lib/i18n";

// lib/__tests__/i18n.test.ts only recognises translator calls whose key is a quoted literal.
// Keys the UI selects through these maps at runtime are invisible to that scan, so this is the
// gate that keeps a missing translation from reaching the screen as a raw key.
const runtimeSelectedKeys = [
  ...Object.values(REFERENCE_ERROR_MESSAGE_KEYS),
  ...Object.values(REFERENCE_FIELD_LABEL_KEYS),
  ...Object.values(REFERENCE_METADATA_LABEL_KEYS),
  ...Object.values(REFERENCE_VIEW_TAB_KEYS),
  ...Object.values(REFERENCE_NOTICE_KEYS),
  ...REFERENCE_JOURNEY_STEPS.flatMap(({ title, body }) => [title, body]),
  ...REFERENCE_GUIDE_SECTIONS.flatMap(({ title, body }) => [title, body]),
];

function refKeys(locale: string): string[] {
  return Object.keys(i18nDict[locale] ?? {}).filter((key) => key.startsWith("ref.")).sort();
}

describe("reference library dictionary", () => {
  it("resolves every runtime-selected key in both shell locales", () => {
    const missing = runtimeSelectedKeys.filter((key) => !i18nDict.ko[key] || !i18nDict.en[key]);
    expect(missing).toEqual([]);
  });

  it("publishes the same ref.* key surface for ko and en", () => {
    expect(refKeys("en")).toEqual(refKeys("ko"));
    expect(refKeys("ko").length).toBeGreaterThan(0);
  });
});
