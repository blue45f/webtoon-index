import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";


const studioPage = readStudioPageCompositionSource();
// 의도된 변경(2026-08, B-04): 게시 패키지 내보내기·manifest 다운로드가 StudioPage.tsx 에서
// export/studio-publish-package-export.ts 로 추출되어, 런타임 동적 import 소유권도 함께 이동했다.
const publishPackageExport = readFileSync(
  new URL("./export/studio-publish-package-export.ts", import.meta.url),
  "utf8"
);
const packagePlanner = readFileSync(
  new URL("./studio-publish-package.ts", import.meta.url),
  "utf8"
);
const manifestRuntime = readFileSync(
  new URL("./studio-publish-package-manifest-runtime.ts", import.meta.url),
  "utf8"
);

describe("Studio publish manifest runtime boundary", () => {
  it("keeps manifest migration and archive reconciliation out of the drawing route", () => {
    expect(packagePlanner).not.toContain("export function parseStudioPublishPackageManifest");
    expect(packagePlanner).not.toContain("export function finalizeStudioPublishPackageManifest");
    expect(packagePlanner).not.toContain("export function serializeStudioPublishPackageManifest");
    expect(manifestRuntime).toContain("export function parseStudioPublishPackageManifest");
    expect(manifestRuntime).toContain("export function finalizeStudioPublishPackageManifest");
    expect(manifestRuntime).toContain("export function serializeStudioPublishPackageManifest");
  });

  it("loads the runtime only from explicit async export and download actions", () => {
    expect(studioPage).not.toMatch(
      /from\s+["']\.\/studio-publish-package-manifest-runtime["']/u
    );
    expect(studioPage).not.toMatch(
      /import\(["']\.\/studio-publish-package-manifest-runtime["']\)/u
    );
    expect(publishPackageExport).not.toMatch(
      /from\s+["']\.\.\/studio-publish-package-manifest-runtime["']/u
    );
    expect(
      publishPackageExport.match(/import\(["']\.\.\/studio-publish-package-manifest-runtime["']\)/gu)
    ).toHaveLength(2);
    expect(studioPage).not.toMatch(
      /import\s*\{[^}]*?(?:finalize|serialize)StudioPublishPackageManifest[^}]*?\}\s*from\s*["']\.\/studio-publish-package["']/u
    );
    expect(publishPackageExport).not.toMatch(
      /import\s*\{[^}]*?(?:finalize|serialize)StudioPublishPackageManifest[^}]*?\}\s*from\s*["']\.\.\/studio-publish-package["']/u
    );
  });
});
