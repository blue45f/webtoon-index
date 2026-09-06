import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const studioPage = [
  // 984251d8c 가 퀵슬롯 배선을 이 훅으로 빼냈다. 추출본을 앞에 둬야 거기서 시작한 순서 비교가
  // 호스트 쪽 토큰까지 그대로 이어진다.
  new URL("./useStudioBrushQuickSlots.ts", import.meta.url),
  new URL("../StudioCuttoonEditorHost.tsx", import.meta.url),
  new URL("../studio-page-editor-runtime-loaders.ts", import.meta.url),
  new URL("../studio-page-shell-runtime.ts", import.meta.url),
]
  .map((url) => readFileSync(url, "utf8"))
  .join("\n");

describe("StudioPage brush quick slots SQLite product boundary", () => {
  it("removes localStorage v1/v2 from the live product call path", () => {
    expect(studioPage).not.toContain("loadStudioBrushSlotsState");
    expect(studioPage).not.toContain("saveStudioBrushSlotsState");
    expect(studioPage).not.toContain("toonspectrum-studio-brush-slots:v1");
    expect(studioPage).not.toContain("toonspectrum-studio-brush-slots:v2");
    expect(studioPage).toContain("state: emptyStudioBrushSlots()");
  });

  it("loads the product singleton behind the lazy SQLite module boundary", () => {
    expect(studioPage).toMatch(
      /import\(\s*"\.\/(?:brush\/)?studio-brush-slots-sqlite-repository"\s*\)/u,
    );
    expect(studioPage).toContain("getProductStudioBrushQuickSlotsSqliteRepository().load(");
    expect(studioPage).toContain("repository.save(");
    expect(studioPage).not.toContain(
      'from "./studio-brush-slots-sqlite-repository";',
    );
  });

  it("uses a stable owner and bounded deterministic browser/device profile", () => {
    // 984251d8c 이후 스코프는 useStudioBrushQuickSlots 안에서 만들어지고, 호스트는 계정 id 만 준다.
    expect(studioPage).toContain("ownerScope: studioAuthUserId,");
    expect(studioPage).toContain('ownerScope: ownerScope ?? "guest",');
    expect(studioPage).toContain(
      "const [deviceProfile] = useState(studioBrushQuickSlotsDeviceProfile);",
    );
    expect(studioPage).toContain(".slice(0, 80).join(\"\") || \"unknown\"");
    expect(studioPage).toContain("browser-v1:${browserFamily}:${platform}:touch-");
    expect(studioPage).not.toContain("crypto.randomUUID()}:touch-");
  });

  it("fences late hydration behind both scope and local mutation generations", () => {
    const hydration = studioPage.indexOf("hydrationGenerationRef.current !== generation");
    const mutation = studioPage.indexOf(
      "mutationGenerationRef.current !== mutationGeneration",
      hydration,
    );
    const scope = studioPage.indexOf(
      "scopeRef.current.key !== request.key",
      mutation,
    );
    const projectionCommit = studioPage.indexOf(
      "setProjection(nextProjection);",
      scope,
    );
    expect(hydration).toBeGreaterThan(0);
    expect(mutation).toBeGreaterThan(hydration);
    expect(scope).toBeGreaterThan(mutation);
    expect(projectionCommit).toBeGreaterThan(scope);
  });

  it("serializes mutations, preserves dirty slots, and carries the SQLite revision", () => {
    expect(studioPage).toContain(
      "const operation = mutationTailRef.current.then(persist, persist);",
    );
    expect(studioPage).toContain("dirtyGenerationsByScopeRef");
    expect(studioPage).toContain("applyDirtySlots(durable, activeDirtySlots)");
    expect(studioPage).toContain("durable.revision");
    expect(studioPage).toContain("dirtyGenerations[slotIndex] === marker");
  });

  it("reloads and retries once on revision conflict without overwriting unrelated slots", () => {
    const conflict = studioPage.indexOf('cause.code !== "conflict"');
    const reload = studioPage.indexOf("await repository.load(request.scope)", conflict);
    const filter = studioPage.indexOf("const retryDirtySlots = activeDirtySlots.filter(", reload);
    const retry = studioPage.indexOf("applyDirtySlots(latest, retryDirtySlots)", filter);
    expect(conflict).toBeGreaterThan(0);
    expect(reload).toBeGreaterThan(conflict);
    expect(filter).toBeGreaterThan(reload);
    expect(retry).toBeGreaterThan(filter);
    expect(studioPage).toContain(
      "다른 탭의 브러시 슬롯 변경을 다시 불러와 안전하게 병합했어요.",
    );
  });

  it("announces assignment success only from the verified persistence path", () => {
    // 커밋 본문은 훅 안의 `commit` 이고, 호스트는 그것을 commitStudioBrushSlotsMutation 으로 받는다.
    const persistenceFunction = studioPage.slice(
      studioPage.indexOf("  function commit("),
      studioPage.indexOf("return { commitStudioBrushSlotsMutation: commit,"),
    );
    expect(persistenceFunction).toContain("saved = await repository.save(");
    expect(persistenceFunction).toContain("announceRef.current(options.successMessage)");
    expect(persistenceFunction.indexOf("saved = await repository.save("))
      .toBeLessThan(persistenceFunction.lastIndexOf(
        "announceRef.current(options.successMessage)",
      ));
    expect(studioPage).toContain(
      "현재 슬롯은 이 화면에만 유지되며 저장 완료로 처리하지 않았어요.",
    );
  });

  it("soft-degrades multi-tab OPFS ownership without dumping Worker lock text to setError", () => {
    expect(studioPage).toContain("isStudioLocalDatabaseOwnershipBusyError(cause)");
    expect(studioPage).toContain("STUDIO_BRUSH_QUICK_SLOTS_OWNERSHIP_BUSY_HINT");
    expect(studioPage).toContain("ownershipBusyAnnouncedRef");
    const hydrateCatch = studioPage.slice(
      studioPage.indexOf(".catch((cause: unknown) => {", studioPage.indexOf("getProductStudioBrushQuickSlotsSqliteRepository().load(")),
      studioPage.indexOf("  function commit("),
    );
    expect(hydrateCatch).toContain("isStudioLocalDatabaseOwnershipBusyError(cause)");
    expect(hydrateCatch).toContain(
      "announceRef.current(STUDIO_BRUSH_QUICK_SLOTS_OWNERSHIP_BUSY_HINT)",
    );
    // Ownership busy must return before the generic setError that embeds cause.message.
    const ownershipGuard = hydrateCatch.indexOf("isStudioLocalDatabaseOwnershipBusyError(cause)");
    const hardError = hydrateCatch.indexOf("브러시 퀵 슬롯을 불러오지 못했어요:");
    expect(ownershipGuard).toBeGreaterThan(0);
    expect(hardError).toBeGreaterThan(ownershipGuard);
  });
});
