import { describe, expect, it } from "vitest";

import { resolveStudioRasterToolAvailability } from "./render/studio-raster-tool-availability";
import { resolveStudioInspectorRasterToolPolicy } from "./studio-inspector-raster-tool-policy";

describe("Studio Inspector raster entry policy", () => {
  it("keeps a direct image target immediately selectable", () => {
    const policy = resolveStudioInspectorRasterToolPolicy(
      resolveStudioRasterToolAvailability("pixel-marquee", {
        selectedType: "image",
      }),
    );

    expect(policy).toMatchObject({
      selectable: true,
      state: "ready",
      statusLabel: "즉시 실행",
      actionLabel: "선택 이미지에서 바로 실행",
      targetLabel: "선택 이미지",
      unavailableReason: null,
    });
  });

  it.each(["pixel-marquee", "pixel-lasso", "magic-wand"] as const)(
    "treats a faithful vector-only %s target as a selectable composite command",
    (tool) => {
      const policy = resolveStudioInspectorRasterToolPolicy(
        resolveStudioRasterToolAvailability(tool, {
          selectedType: "draw",
          visibleVectorDrawCount: 1,
          exactRenderableVisibleCount: 1,
        }),
      );

      expect(policy).toMatchObject({
        selectable: true,
        state: "prepare-page-composite",
        statusLabel: "합성본 준비",
        actionLabel: "페이지 합성본 준비 후 실행",
        targetLabel: "현재 페이지 합성본",
        unavailableReason: null,
      });
    },
  );

  it("keeps filter and vector fill launchers enabled with truthful preparation labels", () => {
    const filter = resolveStudioInspectorRasterToolPolicy(
      resolveStudioRasterToolAvailability("filter", {
        selectedType: "draw",
        exactRenderableVisibleCount: 1,
      }),
    );
    const fill = resolveStudioInspectorRasterToolPolicy(
      resolveStudioRasterToolAvailability("paint-bucket", {
        selectedType: "draw",
        visibleVectorDrawCount: 1,
      }),
    );

    expect(filter).toMatchObject({
      selectable: true,
      state: "prepare-page-composite",
      actionLabel: "페이지 합성본 준비 후 실행",
    });
    expect(fill).toMatchObject({
      selectable: true,
      state: "prepare-vector-fill",
      actionLabel: "벡터 채색 레이어 준비 후 실행",
    });
  });

  it.each([
    [
      "empty",
      resolveStudioRasterToolAvailability("pixel-marquee", {}),
      "편집할 표시 콘텐츠가 없습니다",
      "콘텐츠 추가",
    ],
    [
      "selected lock",
      resolveStudioRasterToolAvailability("pixel-marquee", {
        selectedType: "image",
        selectedMutationBlockedReason:
          "선택한 레이어의 잠금을 해제한 뒤 변경할 수 있어요.",
      }),
      "선택한 레이어의 잠금을 해제한 뒤 변경할 수 있어요.",
      "레이어 잠금·권한 확인",
    ],
    [
      "review lock",
      resolveStudioRasterToolAvailability("pixel-marquee", {
        documentMutationBlockedReason: "검토 잠금을 해제한 뒤 변경할 수 있어요.",
      }),
      "검토 잠금을 해제한 뒤 변경할 수 있어요.",
      "편집 잠금 확인",
    ],
    [
      "shared document",
      resolveStudioRasterToolAvailability("pixel-marquee", {
        documentMutationBlockedReason:
          "공동 문서 편집 권한이 없어 변경할 수 없어요.",
      }),
      "공동 문서 편집 권한이 없어 변경할 수 없어요.",
      "편집 잠금 확인",
    ],
    [
      "unsupported fidelity",
      resolveStudioRasterToolAvailability("pixel-marquee", {
        selectedType: "draw",
        exactRenderableVisibleCount: 1,
        unsupportedVisibleCount: 1,
      }),
      "화면과 똑같이",
      null,
    ],
  ] as const)(
    "keeps the exact %s blocker instead of misreporting a missing image",
    (_label, availability, reason, recoveryLabel) => {
      const policy = resolveStudioInspectorRasterToolPolicy(availability);

      expect(policy.selectable).toBe(false);
      expect(policy.state).toBe("blocked");
      expect(policy.description).toContain(reason);
      expect(policy.unavailableReason).toContain(reason);
      if (recoveryLabel) expect(policy.actionLabel).toBe(recoveryLabel);
      else expect(policy.statusLabel).toBe("사용 불가");
    },
  );
});
