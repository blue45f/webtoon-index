import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 스컬프트 코어의 결정성·격리 계약을 **소스 정적 검사**로 잠근다.
 * 런타임 테스트는 "이번 실행에서 안 불렸다" 만 보여주지만, 이 검사는 코드에 아예 없다는 것을 본다.
 * (레포 선례: studio-3d-insert-controller-boundary.test.ts 등)
 */

const HERE = fileURLToPath(new URL("./", import.meta.url));

function sculptCoreFiles(): string[] {
  return readdirSync(HERE)
    .filter((name) => name.startsWith("studio-sculpt-"))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();
}

function readSource(name: string): string {
  return readFileSync(`${HERE}${name}`, "utf8");
}

/** 주석과 문자열 리터럴을 지운 코드 본문(문서에 적힌 금지어를 오탐하지 않도록). */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

describe("sculpt core — 결정성 경계", () => {
  it("모듈 8개가 전부 존재한다(파일이 조용히 사라지면 다른 테스트가 무의미해진다)", () => {
    expect(sculptCoreFiles()).toEqual([
      "studio-sculpt-brush.ts",
      "studio-sculpt-falloff.ts",
      "studio-sculpt-history.ts",
      "studio-sculpt-mesh.ts",
      "studio-sculpt-render-bridge.ts",
      "studio-sculpt-spatial-hash.ts",
      "studio-sculpt-stroke.ts",
      "studio-sculpt-symmetry.ts",
    ]);
  });

  it("어떤 코어 모듈도 Math.random / Date.now / performance.now / new Date 를 쓰지 않는다", () => {
    const offenders: string[] = [];
    for (const name of sculptCoreFiles()) {
      const code = codeOnly(readSource(name));
      for (const pattern of [
        /\bMath\s*\.\s*random\b/,
        /\bDate\s*\.\s*now\b/,
        /\bperformance\s*\.\s*now\b/,
        /\bnew\s+Date\b/,
      ]) {
        if (pattern.test(code)) offenders.push(`${name}: ${pattern.source}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("코어가 three / konva / react / WebGPU 디바이스에 의존하지 않는다(헤드리스 계약)", () => {
    const offenders: string[] = [];
    for (const name of sculptCoreFiles()) {
      const source = readSource(name);
      const imports = source.match(/from\s+"([^"]+)"/g) ?? [];
      for (const statement of imports) {
        const module = statement.slice(statement.indexOf('"') + 1, -1);
        if (!module.startsWith(".")) offenders.push(`${name}: bare import ${module}`);
      }
      const code = codeOnly(source);
      for (const pattern of [
        /\bnavigator\s*\.\s*gpu\b/,
        /\bGPUDevice\b/,
        /\bdocument\s*\.\s*createElement\b/,
        /\bOffscreenCanvas\b/,
        /\bnew\s+THREE\b/,
      ]) {
        if (pattern.test(code)) offenders.push(`${name}: ${pattern.source}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("코어의 상대 임포트는 스컬프트 모듈과 타입 전용 계약 파일로만 향한다", () => {
    const allowedNonSculpt = new Set(["./bg3d/studio-bg3d-geometry-worker-protocol"]);
    const offenders: string[] = [];
    for (const name of sculptCoreFiles()) {
      const source = readSource(name);
      const matches = source.matchAll(/(import\s+(type\s+)?)[\s\S]*?from\s+"(\.[^"]+)"/g);
      for (const match of matches) {
        const target = match[3];
        if (target.startsWith("./studio-sculpt-")) continue;
        if (!allowedNonSculpt.has(target)) {
          offenders.push(`${name}: ${target}`);
          continue;
        }
        // 허용된 계약 파일은 반드시 타입 전용이어야 한다(런타임 결합 금지).
        const isTypeOnly = new RegExp(
          `import\\s+type\\s+\\{[^}]*\\}\\s*from\\s+"${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
        ).test(source);
        if (!isTypeOnly) offenders.push(`${name}: ${target} is not type-only`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("모든 코어 모듈이 한글 docstring 으로 시작하고 한계를 명시한다", () => {
    for (const name of sculptCoreFiles()) {
      const source = readSource(name);
      expect({ name, startsWithDoc: source.startsWith("/**") }).toEqual({
        name,
        startsWithDoc: true,
      });
      const header = source.slice(0, source.indexOf("*/"));
      expect({ name, hasLimits: header.includes("한계") || header.includes("아닌 것") }).toEqual({
        name,
        hasLimits: true,
      });
    }
  });
});
