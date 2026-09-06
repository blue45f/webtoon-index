/**
 * Verification: every former lite-ops (44) SSOT row is backed by domain-ops
 * and exercises with multi-field domain metrics (not count-echo).
 */
// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { exerciseStudioDccCatalogFeature } from "./hybrid-dcc/studio-dcc-catalog-feature-dispatch";
import {
  STUDIO_DCC_SECTION6_CATALOG,
  type StudioSection6CatalogEntry,
} from "./hybrid-dcc/studio-dcc-section6-full-catalog";

const CONFIGURED_SCRATCH = process.env.GROK_SCRATCH ?? process.env.SCRATCH;
const SCRATCH = CONFIGURED_SCRATCH
  ?? mkdtempSync(join(tmpdir(), "toonspectrum-domain-ops-upgrade-"));

afterAll(() => {
  if (!CONFIGURED_SCRATCH) rmSync(SCRATCH, { force: true, recursive: true });
});

function domainOpsEntries(): readonly StudioSection6CatalogEntry[] {
  return STUDIO_DCC_SECTION6_CATALOG.filter(
    (e) => e.module.includes("domain-ops") || e.module.includes("lite-ops"),
  );
}

describe("domain-ops 44 upgrade verification", () => {
  it("enumerates exactly 44 former lite-ops IDs on domain-ops modules", () => {
    const rows = domainOpsEntries();
    expect(rows).toHaveLength(44);
    for (const row of rows) {
      expect(row.module).toContain("domain-ops");
      expect(row.apis.length).toBeGreaterThan(0);
      expect(row.kernelStatus).toBe("kernel-shipped");
    }
  });

  it("exercises every domain-ops ID with multi-field evidence and writes matrix", async () => {
    mkdirSync(SCRATCH, { recursive: true });
    const rows = domainOpsEntries();
    const matrix: string[] = ["id\tkernelStatus\tmodule\tapis\tpriority\tevidenceKeys\tnumericCount\tstringCount\tok"];
    const logLines: string[] = [
      "# lite-ops-upgrade.log",
      `# generated ${new Date().toISOString()}`,
      `# count=${rows.length}`,
      "",
    ];
    const fails: string[] = [];

    for (const entry of rows) {
      const result = await exerciseStudioDccCatalogFeature(entry.id);
      const evidence = result.evidence ?? {};
      const numericKeys = Object.entries(evidence).filter(
        ([, v]) => typeof v === "number" && Number.isFinite(v as number),
      );
      const stringKeys = Object.entries(evidence).filter(
        ([, v]) => typeof v === "string" && (v as string).length > 0,
      );
      const boolKeys = Object.entries(evidence).filter(([, v]) => typeof v === "boolean");
      const evidenceKeys = Object.keys(evidence).join(",");
      let ok = true;
      const reasons: string[] = [];
      if (!result.ok) {
        ok = false;
        reasons.push("not-ok");
      }
      if (numericKeys.length < 2) {
        ok = false;
        reasons.push(`numeric=${numericKeys.length}<2`);
      }
      // hash/id or ≥3 numerics (geometry structure)
      if (stringKeys.length < 1 && boolKeys.length < 1 && numericKeys.length < 3) {
        ok = false;
        reasons.push("need-hash-or-bool-or-3-numeric");
      }
      // ban pure count-echo: only when no structural hash/string and all numerics are identical tiny counts
      if (stringKeys.length < 1 && numericKeys.length >= 2) {
        const values = numericKeys.map(([, v]) => v as number);
        const allSame = values.every((v) => v === values[0]);
        if (allSame && values[0]! <= 2) {
          ok = false;
          reasons.push("count-echo-suspect");
        }
      }
      if (!ok) fails.push(`${entry.id}:${reasons.join(",")}`);

      matrix.push(
        [
          entry.id,
          entry.kernelStatus,
          entry.module,
          entry.apis.join("|"),
          entry.priority,
          evidenceKeys,
          String(numericKeys.length),
          String(stringKeys.length),
          ok ? "pass" : "fail",
        ].join("\t"),
      );
      logLines.push(
        [
          entry.id,
          ok ? "PASS" : "FAIL",
          `module=${entry.module}`,
          `api=${entry.apis[0]}`,
          `numeric=${numericKeys.length}`,
          `strings=${stringKeys.length}`,
          `keys=${evidenceKeys}`,
          reasons.length ? `reasons=${reasons.join(";")}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
      );
    }

    const matrixPath = resolve(SCRATCH, "domain-ops-44-matrix.tsv");
    const logPath = resolve(SCRATCH, "lite-ops-upgrade.log");
    writeFileSync(matrixPath, `${matrix.join("\n")}\n`, "utf8");
    writeFileSync(logPath, `${logLines.join("\n")}\n`, "utf8");

    expect(fails, `domain-ops upgrade fails: ${fails.join(" | ")}`).toEqual([]);
    expect(matrix.length - 1).toBe(44);
  }, 120_000);
});
