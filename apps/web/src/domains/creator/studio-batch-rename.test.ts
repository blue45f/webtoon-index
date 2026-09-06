import { describe, expect, it } from "vitest";

import { planStudioBatchRename } from "./studio-batch-rename";

import type { El } from "./studio-element-model";

function image(id: string, x: number, y: number, name?: string): Extract<El, { type: "image" }> {
  return {
    id,
    type: "image",
    src: "data:image/png;base64,AA==",
    x,
    y,
    width: 40,
    height: 20,
    rotation: 0,
    name,
  };
}

function text(id: string, x: number, y: number, name?: string): Extract<El, { type: "text" }> {
  return {
    id,
    type: "text",
    x,
    y,
    text: "대사",
    width: 120,
    rotation: 0,
    fontSize: 24,
    fill: "#111111",
    name,
  };
}

describe("studio batch rename", () => {
  it("applies template tokens in visible layer order with padding and one immutable snapshot", () => {
    const bottom = image("bottom", 100, 100, "배경");
    const middle = text("middle", 0, 0, "대사");
    const top = image("top", 50, 50, "효과");
    const outside = image("outside", 200, 200, "유지");
    const plan = planStudioBatchRename(
      [bottom, middle, top, outside],
      ["bottom", "middle", "top"],
      {
        mode: "template",
        template: "{type} 컷-{n} ({name})",
        order: "layer-top",
        start: 7,
        step: 2,
        digits: 3,
      },
    );

    expect(plan.kind).toBe("changed");
    if (plan.kind !== "changed") return;
    expect(plan.previews.map((preview) => [preview.id, preview.nextName])).toEqual([
      ["top", "이미지 컷-007 (효과)"],
      ["middle", "텍스트 컷-009 (대사)"],
      ["bottom", "이미지 컷-011 (배경)"],
    ]);
    expect(plan.next.find((element) => element.id === "top")?.name).toBe("이미지 컷-007 (효과)");
    expect(plan.next[3]).toBe(outside);
    expect(plan.announcement).toBe("3개 레이어 이름 변경");
  });

  it("can number by canvas top-to-bottom independently from z-order", () => {
    const bottomInLayers = image("a", 100, 300, "A");
    const middleInLayers = image("b", 200, 20, "B");
    const topInLayers = image("c", 20, 120, "C");
    const plan = planStudioBatchRename(
      [bottomInLayers, middleInLayers, topInLayers],
      ["a", "b", "c"],
      { mode: "template", template: "컷 {n}", order: "canvas-top", digits: 1 },
    );

    expect(plan.kind).toBe("changed");
    if (plan.kind !== "changed") return;
    expect(plan.previews.map((preview) => preview.id)).toEqual(["b", "c", "a"]);
    expect(plan.previews.map((preview) => preview.nextName)).toEqual(["컷 1", "컷 2", "컷 3"]);
  });

  it("replaces all matches case-insensitively and can preserve case-sensitive non-matches", () => {
    const a = image("a", 0, 0, "Panel PANEL panel");
    const b = image("b", 0, 30, "panel B");
    const insensitive = planStudioBatchRename(
      [a, b],
      ["a", "b"],
      { mode: "replace", search: "panel", replacement: "컷" },
    );

    expect(insensitive.kind).toBe("changed");
    if (insensitive.kind !== "changed") return;
    expect(insensitive.next.map((element) => element.name)).toEqual(["컷 컷 컷", "컷 B"]);

    const sensitive = planStudioBatchRename(
      [a, b],
      ["a", "b"],
      { mode: "replace", search: "PANEL", replacement: "컷", caseSensitive: true },
    );
    expect(sensitive.kind).toBe("changed");
    if (sensitive.kind !== "changed") return;
    expect(sensitive.next[0]?.name).toBe("Panel 컷 panel");
    expect(sensitive.next[1]).toBe(b);
  });

  it("treats replacement metacharacters and current names as literal text", () => {
    const a = image("a", 0, 0, "$& 원본");
    const b = image("b", 0, 20, "Panel B");
    const template = planStudioBatchRename(
      [a, b],
      ["a", "b"],
      {
        mode: "template",
        template: "{name} {n}",
        order: "layer-bottom",
        start: -1,
        step: 2,
        digits: 2,
      },
    );
    expect(template.kind).toBe("changed");
    if (template.kind !== "changed") return;
    expect(template.previews.map((preview) => preview.nextName)).toEqual([
      "$& 원본 -01",
      "Panel B 01",
    ]);

    const replacement = planStudioBatchRename(
      [a, b],
      ["a", "b"],
      { mode: "replace", search: "panel", replacement: "$&" },
    );
    expect(replacement.kind).toBe("changed");
    if (replacement.kind !== "changed") return;
    expect(replacement.next[1]?.name).toBe("$& B");
  });

  it("warns only when a changed result collides with another layer name", () => {
    const a = image("a", 0, 0, "A");
    const b = image("b", 0, 20, "B");
    const existingDuplicate1 = image("c", 0, 40, "기존");
    const existingDuplicate2 = image("d", 0, 60, "기존");
    const plan = planStudioBatchRename(
      [a, b, existingDuplicate1, existingDuplicate2],
      ["a", "b"],
      { mode: "template", template: "같은 이름", order: "layer-bottom" },
    );

    expect(plan.kind).toBe("changed");
    if (plan.kind !== "changed") return;
    expect(plan.duplicateNames).toEqual(["같은 이름"]);
  });

  it("fails the whole plan for stale ids, locks, zero step or an empty resulting name", () => {
    const a = image("a", 0, 0, "A");
    const b = image("b", 0, 20, "B");

    const stale = planStudioBatchRename(
      [a, b],
      ["a", "b", "removed"],
      { mode: "template", template: "컷 {n}" },
    );
    expect(stale.kind).toBe("invalid");
    if (stale.kind === "invalid") expect(stale.reason).toContain("선택 정보가 바뀌었어요");

    const locked = planStudioBatchRename(
      [a, b],
      ["a", "b"],
      { mode: "template", template: "컷 {n}" },
      { isLocked: (element) => element.id === "b" },
    );
    expect(locked.kind).toBe("invalid");
    if (locked.kind === "invalid") expect(locked.reason).toContain("잠긴 레이어");

    const zeroStep = planStudioBatchRename(
      [a, b],
      ["a", "b"],
      { mode: "template", template: "컷 {n}", step: 0 },
    );
    expect(zeroStep.kind).toBe("invalid");
    if (zeroStep.kind === "invalid") expect(zeroStep.reason).toContain("0일 수 없어요");

    const empty = planStudioBatchRename(
      [a, b],
      ["a", "b"],
      { mode: "replace", search: "A", replacement: "", caseSensitive: true },
    );
    expect(empty.kind).toBe("invalid");
    if (empty.kind === "invalid") expect(empty.reason).toContain("빈 레이어 이름");
    expect(a.name).toBe("A");
    expect(b.name).toBe("B");
  });

  it("returns unchanged when replacement finds nothing", () => {
    const elements: El[] = [image("a", 0, 0, "A"), image("b", 0, 20, "B")];
    const plan = planStudioBatchRename(
      elements,
      ["a", "b"],
      { mode: "replace", search: "없는 값", replacement: "X" },
    );

    expect(plan.kind).toBe("unchanged");
    if (plan.kind === "unchanged") expect(plan.reason).toContain("발견되지 않았어요");
  });
});


describe("batch rename literal and numeric integrity", () => {
  it("does not re-interpret template tokens inside an existing layer name", () => {
    const source = "{type}-{n}-{name} $&";
    const elements = [image("a", 0, 0, source), image("b", 10, 10, "B")];
    const plan = planStudioBatchRename(elements, ["a", "b"], {
      mode: "template", template: "{name} suffix", order: "layer-bottom",
    });
    expect(plan.kind).toBe("changed");
    if (plan.kind !== "changed") throw new Error("expected a complete rename plan");
    expect(plan.next[0]?.name).toBe(`${source} suffix`);
    expect(elements[0]?.name).toBe(source);
  });

  it.each([
    { start: Number.MAX_SAFE_INTEGER, step: 1 },
    { start: Number.MIN_SAFE_INTEGER, step: -1 },
    { start: 1e308, step: 1e308 },
    { start: Number.POSITIVE_INFINITY, step: 1 },
    { start: Number.NaN, step: 1 },
    { start: 0.5, step: 1 },
    { start: 1, step: 0.5 },
  ])("rejects unsafe numbering atomically: %j", (numbers) => {
    const elements = [image("a", 0, 0, "A"), image("b", 10, 10, "B")];
    const plan = planStudioBatchRename(elements, ["a", "b"], {
      mode: "template", template: "layer {n}", ...numbers,
    });
    expect(plan.kind).toBe("invalid");
    expect(plan.previews).toEqual([]);
    expect(elements.map((element) => element.name)).toEqual(["A", "B"]);
    expect(plan).not.toHaveProperty("next");
  });

  it("retains valid large integer sequences without an unsafe intermediate product", () => {
    const elements = [image("a", 0, 0), image("b", 10, 10), image("c", 20, 20), image("d", 30, 30)];
    const plan = planStudioBatchRename(elements, elements.map((element) => element.id), {
      mode: "template", template: "{n}", order: "layer-bottom", start: -7000000000000000, step: 4000000000000000,
    });
    expect(plan.kind).toBe("changed");
    expect(plan.previews.map((preview) => preview.sequence)).toEqual([
      -7000000000000000, -3000000000000000, 1000000000000000, 5000000000000000,
    ]);
  });
});
