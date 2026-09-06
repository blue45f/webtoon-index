import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const projectArchiveSource = readFileSync(
  new URL("../studio-project-archive-orchestration-runtime.ts", import.meta.url),
  "utf8",
);
const jsonExportStart = projectArchiveSource.indexOf("async function handleExportProject()");
const jsonExportEnd = projectArchiveSource.indexOf(
  "async function handleExportProjectArchive(",
  jsonExportStart,
);
const jsonExportSource = projectArchiveSource.slice(jsonExportStart, jsonExportEnd);
const importStart = projectArchiveSource.indexOf("function handleImportProject(");
const importEnd = projectArchiveSource.indexOf(
  "async function handleImportProjectArchive(",
  importStart,
);
const jsonImportSource = projectArchiveSource.slice(importStart, importEnd);
const archiveExportStart = projectArchiveSource.indexOf(
  "async function handleExportProjectArchive(",
);
const archiveExportEnd = projectArchiveSource.indexOf(
  "function handleImportProject(",
  archiveExportStart,
);
const archiveExportSource = projectArchiveSource.slice(
  archiveExportStart,
  archiveExportEnd,
);

describe("Studio JSON VRM surface-paint availability boundary", () => {
  it("awaits the lazy JSON portability facade before starting the download", () => {
    expect(jsonExportStart).toBeGreaterThanOrEqual(0);
    expect(jsonExportSource).toMatch(
      /import\(\s*["']\.\/(?:vrm\/)?studio-vrm-texture-paint-project-library["']\)/u,
    );
    expect(jsonExportSource).toContain(
      "{ inspectStudioVrmTexturePaintJsonExport }",
    );
    const inspection = jsonExportSource.indexOf(
      "await inspectStudioVrmTexturePaintJsonExport(",
    );
    const download = jsonExportSource.indexOf("link.click()");
    const notice = jsonExportSource.indexOf(
      "if (texturePaintNotice) setProjectArchiveStatus(texturePaintNotice)",
    );
    expect(inspection).toBeGreaterThanOrEqual(0);
    expect(download).toBeGreaterThan(inspection);
    expect(notice).toBeGreaterThan(download);
    expect(jsonExportSource).not.toMatch(
      /inspectStudioVrmTexturePaintJsonExport\([\s\S]*?\)\.catch\(/u,
    );
  });

  it("keeps the availability audit behind the existing analyzable dynamic import", () => {
    expect(importStart).toBeGreaterThanOrEqual(0);
    expect(importEnd).toBeGreaterThan(importStart);
    expect(jsonImportSource).toContain(
      "{ auditStudioVrmTexturePaintJsonImport }",
    );
    expect(jsonImportSource).toMatch(
      /import\(\s*["']\.\/(?:vrm\/)?studio-vrm-texture-paint-project-library["']\)/u,
    );
    expect(jsonImportSource).toContain(
      "await auditStudioVrmTexturePaintJsonImport(loaded.project)",
    );
    expect(jsonImportSource).toContain(
      "hasStudioLinked3dPassProjectArchiveReferences(loaded.project)",
    );
    expect(jsonImportSource.indexOf(
      "hasStudioLinked3dPassProjectArchiveReferences(loaded.project)",
    )).toBeLessThan(jsonImportSource.indexOf(
      "await auditStudioVrmTexturePaintJsonImport(loaded.project)",
    ));
    expect(jsonImportSource).not.toContain(
      "await exportStudioVrmTexturePaintProjectLibrary({",
    );
    expect(jsonImportSource).not.toMatch(
      /auditStudioVrmTexturePaintJsonImport\([\s\S]*?\)\.catch\(/u,
    );
  });

  it("keeps the import mutation gates around the async portability audit and project apply", () => {
    const parse = jsonImportSource.indexOf(
      "const loaded = await parseStudioProjectDocument(text)",
    );
    const audit = jsonImportSource.indexOf(
      "await auditStudioVrmTexturePaintJsonImport(loaded.project)",
    );
    const postAuditMutationGate = jsonImportSource.indexOf(
      "if (!canApplyStudioMutation(mutationTicket)) return;",
      audit,
    );
    const apply = jsonImportSource.indexOf(
      "await applyStudioProjectSnapshot(loaded.project)",
      postAuditMutationGate,
    );
    const notice = jsonImportSource.indexOf(
      "if (texturePaintPresentation.notice)",
      apply,
    );
    const alertSuffix = jsonImportSource.indexOf(
      "texturePaintPresentation.alertSuffix",
      notice,
    );

    expect(parse).toBeGreaterThanOrEqual(0);
    expect(audit).toBeGreaterThan(parse);
    expect(postAuditMutationGate).toBeGreaterThan(audit);
    expect(apply).toBeGreaterThan(postAuditMutationGate);
    expect(notice).toBeGreaterThan(apply);
    expect(alertSuffix).toBeGreaterThan(notice);
  });

  it("passes the mobile archive budget into the paint bridge before archive building", () => {
    expect(archiveExportStart).toBeGreaterThanOrEqual(0);
    expect(archiveExportEnd).toBeGreaterThan(archiveExportStart);
    const paintExport = archiveExportSource.indexOf(
      "await prepareStudioVrmTexturePaintProjectArchiveExport({",
    );
    const archiveBuild = archiveExportSource.indexOf(
      "await buildStudioProjectArchiveWithVerifiedBg3dModels({",
    );
    expect(paintExport).toBeGreaterThanOrEqual(0);
    expect(archiveBuild).toBeGreaterThan(paintExport);
    expect(archiveExportSource.slice(paintExport, archiveBuild)).toContain(
      "limits: isMobile ? MOBILE_PROJECT_ARCHIVE_LIMITS : undefined",
    );
    expect(archiveExportSource.slice(archiveBuild)).toContain(
      "...texturePaintAttachments",
    );
  });
});
