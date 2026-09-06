/**
 * pointerup 긴급 저장의 "한 홉" 계약.
 *
 * 획을 놓자마자 탭을 떠나면, 긴급 저장은 내비게이션이 문서를 헐기 전에 durable 쓰기를
 * **발행**해야 한다. 이 경로에 async 홉이 하나라도 더 붙으면 쓰기가 unload task 뒤로 밀려
 * 조용히 사라진다 — 화면에는 저장된 것처럼 보이고 사용자만 그림을 잃는다.
 *
 * 실제 사고(2026-08-13): 2c53be24 가 leadership 가드를 이 콜백 안에서 동적 import 하도록
 * 바꾸면서 SQLite 긴급 저장이 사라졌다. 브라우저 게이트의 durability 스테이지가 869c79ac
 * 통과 / 2c53be24 실패로 이를 잡아냈지만, 그 게이트는 풀 빌드가 필요해 비싸다. 여기서
 * 소스 계약으로 한 번 더 못을 박아 되돌아오지 못하게 한다.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const STUDIO_PAGE_SOURCE = readStudioPageCompositionSource();
const AUTOSAVE_RUNTIME_SOURCE = readFileSync(
  new URL("./useStudioAutosaveDocumentRuntime.ts", import.meta.url),
  "utf8",
);

/** 긴급 저장 구현부만 잘라낸다 — 파일의 다른 동적 import 는 이 계약과 무관하다. */
function emergencyAutosaveImplementation(): string {
  const start = STUDIO_PAGE_SOURCE.indexOf(
    "persistPendingStrokeEmergencyAutosaveRef.current = (reason) => {",
  );
  expect(start, "pointerup 긴급 저장 구현부를 찾지 못했어요").toBeGreaterThan(-1);
  const end = STUDIO_PAGE_SOURCE.indexOf(
    "function applyStudioProjectSnapshotWithPreparedDocuments",
    start,
  );
  expect(end, "긴급 저장 구현부의 끝 경계를 찾지 못했어요").toBeGreaterThan(start);
  return STUDIO_PAGE_SOURCE.slice(start, end);
}

describe("pointerup emergency autosave write hop", () => {
  it("issues durable writes without awaiting a module import", () => {
    const implementation = emergencyAutosaveImplementation();
    // `await import(...)` 한 줄이 곧 유실이다. 필요한 모듈은 세션을 열 때 미리 잡아둔다.
    expect(
      implementation.includes("await import("),
      "긴급 저장 경로가 모듈 import 를 기다리면 pointerup 직후 이탈에서 쓰기가 유실돼요",
    ).toBe(false);
    // 위 단언이 공허하지 않은지 — 이 구현부는 정말로 durable 쓰기를 만든다.
    expect(implementation).toContain("durableWrites");
    expect(implementation).toContain("sqlite.write(");
  });

  it("keeps the follower guard by reading the pre-resolved leadership guard", () => {
    const implementation = emergencyAutosaveImplementation();
    // 홉을 줄이려고 가드 자체를 버리면 follower 탭이 선행 탭 문서를 덮는 포크가 되살아난다.
    expect(implementation).toContain("autosaveLeadershipGuardRef.current");
    expect(AUTOSAVE_RUNTIME_SOURCE).toContain(
      "autosaveLeadershipGuardRef.current = withStudioAutosaveDocumentLeadership",
    );
    expect(implementation).toContain("if (studioAutosaveDocumentBusy(cause)) return;");
    expect(implementation.indexOf("if (studioAutosaveDocumentBusy(cause)) return;")).toBeLessThan(
      implementation.indexOf("console.error(\"Pending stroke emergency autosave failed:\""),
    );
  });
});
