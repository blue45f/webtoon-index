import { describe, expect, it } from "vitest";

import {
  collectStudioManifestClosure,
  planStudioServiceWorkerPrecache,
  studioServiceWorkerBuildId,
  type StudioViteManifest,
} from "./studio-service-worker-precache-plan";

const MANIFEST: StudioViteManifest = {
  "index.html": {
    file: "assets/index-abc.js",
    src: "index.html",
    isEntry: true,
    imports: ["_react-runtime-def.js", "_i18n-ghi.js"],
    dynamicImports: ["apps/web/src/domains/creator/studio-router/StudioRouter.tsx"],
    css: ["assets/index-jkl.css"],
  },
  "_react-runtime-def.js": {
    file: "assets/react-runtime-def.js",
    imports: ["_react-mno.js"],
  },
  "_react-mno.js": { file: "assets/react-mno.js" },
  "_i18n-ghi.js": { file: "assets/i18n-ghi.js" },
  "apps/web/src/domains/creator/studio-router/StudioRouter.tsx": {
    file: "assets/StudioRouter-pqr.js",
    isDynamicEntry: true,
    imports: ["_studio-huge-stu.js"],
  },
  "_studio-huge-stu.js": { file: "assets/studio-huge-stu.js" },
} as unknown as StudioViteManifest;

const SIZES: Record<string, number> = {
  "/assets/index-abc.js": 197_822,
  "/assets/react-runtime-def.js": 225_069,
  "/assets/react-mno.js": 440,
  "/assets/i18n-ghi.js": 4_096,
  "/assets/index-jkl.css": 398_195,
  "/i18n/studio/mainMenu/ko.json": 92_000,
  "/i18n/studio/mainMenu/en.json": 89_363,
};

const sizeOf = (url: string): number | null => SIZES[url] ?? null;

describe("collectStudioManifestClosure", () => {
  it("walks static imports and CSS but never dynamic imports", () => {
    const urls = collectStudioManifestClosure(MANIFEST, "index.html");
    expect(urls).toContain("/assets/index-abc.js");
    expect(urls).toContain("/assets/react-mno.js");
    expect(urls).toContain("/assets/index-jkl.css");
    // Following dynamicImports is exactly how a precache list turns into a
    // cold-start regression, so it must not happen.
    expect(urls).not.toContain("/assets/StudioRouter-pqr.js");
    expect(urls).not.toContain("/assets/studio-huge-stu.js");
  });

  it("is cycle-safe and deduplicates", () => {
    const cyclic = {
      a: { file: "a.js", imports: ["b"] },
      b: { file: "b.js", imports: ["a"] },
    } as unknown as StudioViteManifest;
    expect(collectStudioManifestClosure(cyclic, "a")).toEqual(["/a.js", "/b.js"]);
  });

  it("returns nothing for an unknown entry", () => {
    expect(collectStudioManifestClosure(MANIFEST, "missing.html")).toEqual([]);
  });
});

describe("planStudioServiceWorkerPrecache", () => {
  it("splits the shell from the deferred warm set", () => {
    const plan = planStudioServiceWorkerPrecache({
      manifest: MANIFEST,
      appEntryKey: "index.html",
      warmUrls: ["/i18n/studio/mainMenu/ko.json", "/i18n/studio/mainMenu/en.json"],
      sizeOf,
    });
    expect(plan.violations).toEqual([]);
    expect(plan.shellUrls).toEqual(["/", "/studio"]);
    expect(plan.criticalUrls).toHaveLength(5);
    expect(plan.criticalBytes).toBe(825_622);
    expect(plan.warmUrls).toEqual(["/i18n/studio/mainMenu/ko.json", "/i18n/studio/mainMenu/en.json"]);
    expect(plan.warmBytes).toBe(181_363);
  });

  it("fails the build when the critical set outgrows its budget", () => {
    const plan = planStudioServiceWorkerPrecache({
      manifest: MANIFEST,
      appEntryKey: "index.html",
      sizeOf,
      budget: { criticalBytes: 1_024, warmBytes: 1_024 },
    });
    expect(plan.violations).toHaveLength(1);
    expect(plan.violations[0]).toContain("critical precache");
  });

  it("fails the build if the Studio route closure is ever added to warm", () => {
    // The regression this guards: someone "improves" offline support by warming
    // the 5.4 MB Studio closure and every catalog visitor starts paying for it.
    const plan = planStudioServiceWorkerPrecache({
      manifest: MANIFEST,
      appEntryKey: "index.html",
      warmUrls: collectStudioManifestClosure(
        MANIFEST,
        "apps/web/src/domains/creator/studio-router/StudioRouter.tsx",
      ),
      sizeOf: (url) => SIZES[url] ?? 3_000_000,
    });
    expect(plan.violations.some((v) => v.includes("warm precache"))).toBe(true);
  });

  it("reports a missing app entry as a violation, not a warning", () => {
    const plan = planStudioServiceWorkerPrecache({
      manifest: {} as StudioViteManifest,
      appEntryKey: "index.html",
      sizeOf,
    });
    expect(plan.violations[0]).toContain("missing from the Vite manifest");
  });

  it("never lists a critical URL again in warm", () => {
    const plan = planStudioServiceWorkerPrecache({
      manifest: MANIFEST,
      appEntryKey: "index.html",
      warmUrls: ["/assets/index-abc.js", "/i18n/studio/mainMenu/ko.json", "/i18n/studio/mainMenu/ko.json"],
      sizeOf,
    });
    expect(plan.warmUrls).toEqual(["/i18n/studio/mainMenu/ko.json"]);
  });

  it("warns rather than fails when a target is absent from disk", () => {
    const plan = planStudioServiceWorkerPrecache({
      manifest: MANIFEST,
      appEntryKey: "index.html",
      warmUrls: ["/i18n/studio/mainMenu/xx.json"],
      sizeOf,
    });
    expect(plan.violations).toEqual([]);
    expect(plan.warnings.some((w) => w.includes("/i18n/studio/mainMenu/xx.json"))).toBe(true);
  });
});

describe("studioServiceWorkerBuildId", () => {
  /** FNV-1a: order-sensitive, so an anagram of the URL list is a different id. */
  const digest = (value: string): string => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(16, "0");
  };

  it("is stable when the precache content is unchanged", () => {
    const plan = { criticalUrls: ["/a.js", "/b.css"], warmUrls: ["/c.json"] };
    expect(studioServiceWorkerBuildId(plan, digest)).toBe(
      studioServiceWorkerBuildId({ ...plan }, digest),
    );
  });

  it("changes when a precached URL changes", () => {
    // A rebuild that changes nothing observable must not tell browsers to
    // install a byte-identical worker.
    expect(
      studioServiceWorkerBuildId({ criticalUrls: ["/a-1.js"], warmUrls: [] }, digest),
    ).not.toBe(
      studioServiceWorkerBuildId({ criticalUrls: ["/a-2.js"], warmUrls: [] }, digest),
    );
  });
});
