import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  StudioProjectArchiveIncompleteVrmError,
  assertCompleteStudioVrmProjectArchive,
} from "./studio-project-archive-orchestration-runtime";

describe("studio project archive VRM completeness gate", () => {
  it("accepts only a complete VRM attachment result", () => {
    expect(() => assertCompleteStudioVrmProjectArchive({
      isComplete: true,
      missing: [],
      diagnostics: [],
    })).not.toThrow();

    expect(() => assertCompleteStudioVrmProjectArchive({
      isComplete: true,
      missing: [{}],
      diagnostics: [],
    })).toThrow(StudioProjectArchiveIncompleteVrmError);
  });

  it("throws a typed, bounded summary and never reflects an unbounded diagnostic list", () => {
    const diagnostics = Array.from({ length: 8 }, (_, index) => ({
      code: index === 0 ? "LOCAL_MODEL_LICENSE_RESTRICTED" : `CODE_${index}`,
      message: index === 0
        ? `license\u0000 blocked ${"x".repeat(1_000)}`
        : `diagnostic ${index}`,
    }));

    try {
      assertCompleteStudioVrmProjectArchive({
        isComplete: false,
        missing: [{}, {}],
        diagnostics,
      });
      throw new Error("expected completeness gate failure");
    } catch (cause) {
      expect(cause).toBeInstanceOf(StudioProjectArchiveIncompleteVrmError);
      expect(cause).toMatchObject({
        code: "vrm-archive-incomplete",
        missingCount: 2,
      });
      const message = cause instanceof Error ? cause.message : String(cause);
      expect(message).toContain("LOCAL_MODEL_LICENSE_RESTRICTED");
      expect(message).toContain("외 5건");
      expect(message).not.toContain("CODE_7");
      expect(message).not.toContain("\u0000");
      expect(Array.from(message).length).toBeLessThan(800);
    }
  });

  it("preflights before materialization and gates the final filter-mask projection", () => {
    const source = readFileSync(
      new URL("./studio-project-archive-orchestration-runtime.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("async function handleExportProjectArchive()");
    const end = source.indexOf("async function handleImportProject(", start);
    const exportFlow = source.slice(start, end);
    const preflightVrm = exportFlow.indexOf(
      "let vrmArchive = await prepareStudioVrmProjectArchiveExport(",
    );
    const preflightComplete = exportFlow.indexOf(
      "assertCompleteStudioVrmProjectArchive(vrmArchive)",
    );
    const prepareReference = exportFlow.indexOf(
      "await prepareStudioReferenceBoardArchiveExport(project)",
    );
    const prepareFilterMask = exportFlow.indexOf(
      "await prepareStudioFilterMaskSurfaceArchiveExport",
    );
    const projectedVrm = exportFlow.indexOf(
      "vrmArchive = await prepareStudioVrmProjectArchiveExport(",
      prepareFilterMask,
    );
    const projectedComplete = exportFlow.indexOf(
      "assertCompleteStudioVrmProjectArchive(vrmArchive)",
      preflightComplete + 1,
    );
    const prepareTexture = exportFlow.indexOf(
      "await prepareStudioVrmTexturePaintProjectArchiveExport",
    );
    const buildArchive = exportFlow.indexOf(
      "await buildStudioProjectArchiveWithVerifiedBg3dModels",
    );

    expect(preflightVrm).toBeGreaterThan(-1);
    expect(preflightComplete).toBeGreaterThan(preflightVrm);
    expect(prepareFilterMask).toBeGreaterThan(preflightComplete);
    expect(projectedVrm).toBeGreaterThan(prepareFilterMask);
    expect(projectedComplete).toBeGreaterThan(projectedVrm);
    expect(prepareReference).toBeGreaterThan(projectedComplete);
    expect(prepareTexture).toBeGreaterThan(projectedComplete);
    expect(buildArchive).toBeGreaterThan(projectedComplete);
    expect(exportFlow).toContain("...vrmArchive.attachments");
  });

  it("binds one explicit receipt to source and projected VRM gates before any archive build", () => {
    const source = readFileSync(
      new URL("./studio-project-archive-orchestration-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /(?:globalThis|window)\s*\.\s*(?:confirm|prompt)\s*(?:\?\.)?\s*\(/u,
    );
    const start = source.indexOf("async function handleExportProjectArchive()");
    const end = source.indexOf("async function handleImportProject(", start);
    const exportFlow = source.slice(start, end);
    const mutationTicket = exportFlow.indexOf("captureStudioMutationTicket()");
    const attestationPlan = exportFlow.indexOf(
      "await prepareStudioVrmProjectArchiveUseContextAttestation(",
    );
    const prompt = exportFlow.indexOf(
      "await requestStudioVrmProjectArchiveUseContext(attestationPlan)",
      attestationPlan,
    );
    const exactPlanCheck = exportFlow.indexOf(
      "studioVrmArchiveAttestationInputMatchesPlan(attestationInput, attestationPlan)",
      prompt,
    );
    const neutralCancel = exportFlow.indexOf(
      "if (attestationInput === null)",
      prompt,
    );
    const receipt = exportFlow.indexOf(
      "createStudioVrmProjectArchiveUseContextReceipt(attestationInput)",
      exactPlanCheck,
    );
    const postPromptTicket = exportFlow.indexOf(
      "!canApplyStudioMutation(exportMutationTicket)",
      receipt,
    );
    const postPromptSnapshot = exportFlow.indexOf(
      "currentVrmFingerprint !== sourceVrmFingerprint",
      postPromptTicket,
    );
    const sourceGate = exportFlow.indexOf(
      "let vrmArchive = await prepareStudioVrmProjectArchiveExport(",
      postPromptSnapshot,
    );
    const projectedGate = exportFlow.indexOf(
      "vrmArchive = await prepareStudioVrmProjectArchiveExport(",
      exportFlow.indexOf("if (project !== sourceProject)", sourceGate),
    );
    const buildArchive = exportFlow.indexOf(
      "await buildStudioProjectArchiveWithVerifiedBg3dModels",
      projectedGate,
    );

    expect(mutationTicket).toBeGreaterThan(-1);
    expect(attestationPlan).toBeGreaterThan(mutationTicket);
    expect(prompt).toBeGreaterThan(attestationPlan);
    expect(exportFlow.slice(attestationPlan, prompt)).toContain(
      "if (!requestStudioVrmProjectArchiveUseContext)",
    );
    expect(neutralCancel).toBeGreaterThan(prompt);
    expect(exactPlanCheck).toBeGreaterThan(neutralCancel);
    expect(exportFlow.slice(neutralCancel, exactPlanCheck)).toContain('tone: "warn"');
    expect(exportFlow.slice(neutralCancel, exactPlanCheck)).toContain("setError(null)");
    expect(exportFlow.slice(neutralCancel, exactPlanCheck)).toContain("return;");
    expect(receipt).toBeGreaterThan(exactPlanCheck);
    expect(postPromptTicket).toBeGreaterThan(receipt);
    expect(postPromptSnapshot).toBeGreaterThan(postPromptTicket);
    expect(sourceGate).toBeGreaterThan(postPromptSnapshot);
    expect(projectedGate).toBeGreaterThan(sourceGate);
    expect(buildArchive).toBeGreaterThan(projectedGate);
    expect(exportFlow.slice(sourceGate, buildArchive).match(/vrmUseContextReceipt/gu))
      .toHaveLength(2);
    expect(exportFlow.slice(prompt, sourceGate)).toContain(
      "if (!studioVrmArchiveAttestationInputMatchesPlan(attestationInput, attestationPlan))",
    );
  });

  it("keeps VRM archive import read-only until the final mutation-scoped install/apply seam", () => {
    const source = readFileSync(
      new URL("./studio-project-archive-orchestration-runtime.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("async function handleImportProjectArchive(");
    const end = source.indexOf("return {", start);
    const importFlow = source.slice(start, end);
    const prepare = importFlow.indexOf("restoreStudioVrmProjectArchiveImport(restoredResult)");
    const finalInstallSeam = importFlow.indexOf("const installAndApply = async");
    const preInstallTicket = importFlow.indexOf(
      "if (!canApplyStudioMutation(mutationTicket)) return false;",
      finalInstallSeam,
    );
    const commit = importFlow.indexOf(
      "installPreparedStudioVrmProjectArchiveImportAndApply(",
      preInstallTicket,
    );
    const projectApply = importFlow.indexOf(
      "applyStudioProjectSnapshotWithPreparedDocuments(",
      commit,
    );

    expect(prepare).toBeGreaterThan(-1);
    expect(finalInstallSeam).toBeGreaterThan(prepare);
    expect(preInstallTicket).toBeGreaterThan(finalInstallSeam);
    expect(commit).toBeGreaterThan(preInstallTicket);
    expect(projectApply).toBeGreaterThan(commit);
  });

  it("stages every durable archive authority and nests exact compensation around the final ticket gate", () => {
    const source = readFileSync(
      new URL("./studio-project-archive-orchestration-runtime.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("async function handleImportProjectArchive(");
    const end = source.indexOf(
      "const installed = await runStudioProjectArchiveFinalInstallExclusive",
      start,
    );
    const importFlow = source.slice(start, end);
    const prepareReference = importFlow.indexOf("prepareStudioReferenceBoardArchiveImport(result)");
    const prepareVrm = importFlow.indexOf("restoreStudioVrmProjectArchiveImport(restoredResult)");
    const prepareTexture = importFlow.indexOf("prepareStudioVrmTexturePaintProjectArchiveImport({");
    const prepareBg3d = importFlow.indexOf("prepareStudioBg3dProjectArchiveImport(");
    const finalSeam = importFlow.indexOf("const installAndApply = async");
    const installReference = importFlow.indexOf(
      "installPreparedStudioReferenceBoardArchiveImportAndApply(",
      finalSeam,
    );
    const installTexture = importFlow.indexOf(
      "installPreparedStudioVrmTexturePaintProjectArchiveImportAndApply(",
      installReference,
    );
    const installVrm = importFlow.indexOf(
      "installPreparedStudioVrmProjectArchiveImportAndApply(",
      installTexture,
    );
    const installBg3d = importFlow.indexOf(
      "installPreparedStudioBg3dProjectArchiveModelsAndApply(",
      installVrm,
    );
    const applyProject = importFlow.indexOf(
      "applyStudioProjectSnapshotWithPreparedDocuments(",
      installBg3d,
    );

    expect([
      prepareReference,
      prepareVrm,
      prepareTexture,
      prepareBg3d,
      finalSeam,
      installReference,
      installTexture,
      installVrm,
      installBg3d,
      applyProject,
    ]).toEqual([...[
      prepareReference,
      prepareVrm,
      prepareTexture,
      prepareBg3d,
      finalSeam,
      installReference,
      installTexture,
      installVrm,
      installBg3d,
      applyProject,
    ]].sort((left, right) => left - right));
    expect(prepareReference).toBeGreaterThan(-1);
    expect(importFlow).not.toContain("restoreStudioReferenceBoardArchiveImport(result)");
    expect(importFlow).not.toContain("importStudioVrmTexturePaintProjectLibrary({");
    expect(importFlow).not.toContain("installStudioBg3dProjectArchiveModelsAndApply(");
    expect(importFlow.slice(finalSeam).match(/canApplyStudioMutation\(mutationTicket\)/gu)?.length)
      .toBeGreaterThanOrEqual(5);
    expect(importFlow.slice(installReference)).toContain(
      "{ didApply: (value) => value !== false }",
    );
  });

  it("holds one origin-wide transaction across linked restore, nested installs, apply, and rollback", () => {
    const source = readFileSync(
      new URL("./studio-project-archive-orchestration-runtime.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("async function handleImportProjectArchive(");
    const end = source.indexOf("if (!projectApplied || installed === false", start);
    const importFlow = source.slice(start, end);
    const lock = importFlow.indexOf(
      "const installed = await runStudioProjectArchiveFinalInstallExclusive(async () => {",
    );
    const ticket = importFlow.indexOf(
      "if (!canApplyStudioMutation(mutationTicket)) return false;",
      lock,
    );
    const linkedRestore = importFlow.indexOf(
      "await restoreStudioLinked3dPassProjectArchiveImport({",
      lock,
    );
    const nestedInstall = importFlow.indexOf("apply: installAndApply", linkedRestore);
    const directInstall = importFlow.indexOf(
      ": await installAndApply(portableResult.project)",
      nestedInstall,
    );
    const lockClose = importFlow.indexOf("\n      });", directInstall);

    expect(lock).toBeGreaterThan(-1);
    expect(ticket).toBeGreaterThan(lock);
    expect(linkedRestore).toBeGreaterThan(ticket);
    expect(nestedInstall).toBeGreaterThan(linkedRestore);
    expect(directInstall).toBeGreaterThan(nestedInstall);
    expect(lockClose).toBeGreaterThan(directInstall);
    expect(importFlow.slice(lock, lockClose)).toContain(
      "hasStudioLinked3dPassProjectArchiveReferences(portableResult.project)",
    );
  });
});
