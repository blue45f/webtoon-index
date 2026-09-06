import { describe, expect, it } from "vitest";

import {
  STUDIO_AUTO_ACTION_LIMITS,
  STUDIO_AUTO_ACTION_SET_KIND,
  STUDIO_AUTO_ACTION_SET_VERSION,
  StudioAutoActionValidationError,
  executeStudioAutoAction,
  exportStudioAutoActionSetJson,
  importStudioAutoActionSetJson,
  normalizeStudioAutoActionSet,
  planStudioAutoActionExecution,
  type StudioAutoActionCommand,
  type StudioAutoActionPage,
} from "./studio-auto-actions";

function actionSet(commands: unknown[], extra: Record<string, unknown> = {}) {
  return {
    kind: STUDIO_AUTO_ACTION_SET_KIND,
    version: STUDIO_AUTO_ACTION_SET_VERSION,
    id: "weekly-lettering",
    name: "주간 연재 정리",
    commands,
    ...extra,
  };
}

function command<T extends StudioAutoActionCommand>(value: T): T {
  return value;
}

function pagesFixture(): StudioAutoActionPage[] {
  return [
    {
      id: "p1",
      bg: "#ffffff",
      bgGrad: null,
      canvasH: 1200,
      unknownPageField: { retain: true },
      grade: { brightness: 0.8, futureGradeField: "retain" },
      elements: [
        {
          id: "t1",
          type: "text",
          name: "대사 · 주인공",
          text: "안녕",
          font: "Old Font",
          fontSize: 20,
          fill: "#111111",
          futureElementField: { retain: true },
        },
        {
          id: "b1",
          type: "bubble",
          name: "대사 · 조연",
          text: "반가워",
          fontSize: 24,
          textFill: "#222222",
          fill: "#ffffff",
        },
        { id: "i1", type: "image", name: "야간 배경", opacity: 1, blendMode: "source-over" },
      ],
    },
    {
      id: "p2",
      bg: "#eeeeee",
      bgGrad: ["#eeeeee", "#dddddd"],
      canvasH: 900,
      elements: [
        { id: "t2", type: "text", name: "독백", text: "혼자였다", fontSize: 18, fill: "#333333" },
        { id: "i2", type: "image", name: "야간 배경 보조", opacity: 0.8 },
      ],
    },
    {
      id: "p3",
      bg: "#ffffff",
      bgGrad: null,
      canvasH: 1000,
      elements: [{ id: "s1", type: "sticker", name: "효과", text: "쾅" }],
    },
  ];
}

describe("Auto Actions import/export safety", () => {
  it("버전형 JSON을 canonical form으로 정규화하고 왕복한다", () => {
    const raw = actionSet([
      {
        id: " font ",
        type: "lettering.set-font",
        font: "  Noto Sans KR  ",
        filter: { name: { mode: "contains", value: " 대사 " } },
      },
      { id: "color", type: "lettering.set-color", color: "#AABBCC" },
    ], { description: "  반복 레터링  " });

    const normalized = normalizeStudioAutoActionSet(raw);
    expect(normalized).toMatchObject({
      id: "weekly-lettering",
      description: "반복 레터링",
      commands: [
        {
          id: "font",
          enabled: true,
          font: "Noto Sans KR",
          filter: { name: { value: "대사", caseSensitive: false } },
        },
        { id: "color", enabled: true, color: "#aabbcc" },
      ],
    });
    expect(importStudioAutoActionSetJson(exportStudioAutoActionSetJson(raw))).toEqual(normalized);
  });

  it("allowlist 밖의 script/eval/임의 command와 unknown 필드를 거부한다", () => {
    expect(() => normalizeStudioAutoActionSet(actionSet([
      { id: "script", type: "script.execute", source: "globalThis.fetch('https://evil.test')" },
    ]))).toThrow(StudioAutoActionValidationError);
    expect(() => normalizeStudioAutoActionSet(actionSet([
      { id: "opacity", type: "element.set-opacity", opacity: 0.5, javascript: "alert(1)" },
    ]))).toThrow(/Unrecognized key|인식/iu);
  });

  it("future version은 조용히 낮춰 읽지 않고 명시적으로 거부한다", () => {
    expect(() => normalizeStudioAutoActionSet({
      ...actionSet([{ id: "hide", type: "element.set-hidden", hidden: true }]),
      version: 2,
    })).toThrow(/새로운 Action Set 버전/u);
  });

  it("prototype pollution 키·getter·순환 참조를 실행 전에 거부한다", () => {
    const pollutionJson = `{
      "kind":"${STUDIO_AUTO_ACTION_SET_KIND}",
      "version":1,
      "id":"safe",
      "name":"safe",
      "commands":[{"id":"x","type":"element.set-hidden","hidden":true,"__proto__":{"polluted":true}}]
    }`;
    expect(() => importStudioAutoActionSetJson(pollutionJson)).toThrow(/안전하지 않은 키/u);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();

    const withGetter = actionSet([{ id: "x", type: "element.set-hidden", hidden: true }]);
    Object.defineProperty(withGetter, "description", { enumerable: true, get: () => "unsafe" });
    expect(() => normalizeStudioAutoActionSet(withGetter)).toThrow(/접근자/u);

    const cyclic = actionSet([{ id: "x", type: "element.set-hidden", hidden: true }]) as Record<string, unknown>;
    cyclic.self = cyclic;
    expect(() => normalizeStudioAutoActionSet(cyclic)).toThrow(/순환 참조/u);
  });

  it("JSON·단계 수·중복 ID·값 범위 상한을 적용한다", () => {
    expect(() => importStudioAutoActionSetJson("x".repeat(STUDIO_AUTO_ACTION_LIMITS.maxJsonCodeUnits + 1)))
      .toThrow(/너무 큽니다/u);
    const commands = Array.from({ length: STUDIO_AUTO_ACTION_LIMITS.maxCommands + 1 }, (_, index) => ({
      id: `step-${index}`,
      type: "element.set-hidden",
      hidden: true,
    }));
    expect(() => normalizeStudioAutoActionSet(actionSet(commands))).toThrow();
    expect(() => normalizeStudioAutoActionSet(actionSet([
      { id: "same", type: "element.set-hidden", hidden: true },
      { id: "same", type: "element.set-locked", locked: true },
    ]))).toThrow(/중복/u);
    expect(() => normalizeStudioAutoActionSet(actionSet([
      { id: "opacity", type: "element.set-opacity", opacity: 1.1 },
    ]))).toThrow();
  });
});

describe("Auto Actions scope planning and dry-run", () => {
  const set = actionSet([
    command({
      id: "night-bg",
      type: "element.set-opacity",
      opacity: 0.5,
      enabled: true,
      filter: {
        elementTypes: ["image"],
        name: { mode: "starts-with", value: "야간", caseSensitive: false },
      },
    }),
  ]);

  it("current scope는 현재 페이지만 계획하고 원문을 변경하지 않는다", () => {
    const pages = pagesFixture();
    const before = structuredClone(pages);
    const plan = planStudioAutoActionExecution({ actionSet: set, pages, scope: { kind: "current" }, currentPageId: "p1" });
    expect(plan.targetPageIds).toEqual(["p1"]);
    expect(plan.affectedPageIds).toEqual(["p1"]);
    expect(plan.affectedElementCount).toBe(1);
    expect(plan.steps[0]).toMatchObject({ matchedElements: 1, affectedElements: 1 });
    expect(pages).toEqual(before);
  });

  it("selected-pages는 문서 순서를 유지하고 없는 페이지를 경고한다", () => {
    const plan = planStudioAutoActionExecution({
      actionSet: set,
      pages: pagesFixture(),
      scope: { kind: "selected-pages", pageIds: ["p2", "missing", "p1", "p2"] },
    });
    expect(plan.targetPageIds).toEqual(["p1", "p2"]);
    expect(plan.warnings.join(" ")).toContain("missing");
    expect(plan.affectedElementCount).toBe(2);
  });

  it("all scope와 no-match/disabled 명령을 정확히 보고한다", () => {
    const plan = planStudioAutoActionExecution({
      actionSet: actionSet([
        { id: "disabled", type: "element.set-hidden", hidden: true, enabled: false },
        {
          id: "none",
          type: "element.set-locked",
          locked: true,
          filter: { name: { mode: "exact", value: "없는 이름" } },
        },
      ]),
      pages: pagesFixture(),
      scope: { kind: "all" },
    });
    expect(plan.targetPageIds).toEqual(["p1", "p2", "p3"]);
    expect(plan.steps[0]?.warnings[0]).toContain("비활성화");
    expect(plan.steps[1]?.warnings[0]).toContain("필터");
    expect(plan.mutationCount).toBe(0);
  });
});

describe("Auto Actions atomic immutable execution", () => {
  it("텍스트/말풍선 글꼴·크기·색을 이름/타입 필터로 바꾸고 unknown 필드를 보존한다", async () => {
    const pages = pagesFixture();
    const before = structuredClone(pages);
    const result = await executeStudioAutoAction({
      actionSet: actionSet([
        {
          id: "font",
          type: "lettering.set-font",
          font: "Noto Sans KR",
          filter: { name: { mode: "starts-with", value: "대사" } },
        },
        {
          id: "bubble-size",
          type: "lettering.set-size",
          fontSize: 30,
          filter: { elementTypes: ["bubble"] },
        },
        {
          id: "color",
          type: "lettering.set-color",
          color: "#FF5500",
          filter: { elementTypes: ["text", "bubble"] },
        },
      ]),
      pages,
      scope: { kind: "current" },
      currentPageId: "p1",
    });

    expect(result).toMatchObject({ status: "succeeded", committed: true, failures: [] });
    expect(result.pages).not.toBe(pages);
    expect(pages).toEqual(before);
    const [text, bubble, image] = result.pages[0]!.elements as Array<Record<string, unknown>>;
    expect(text).toMatchObject({ font: "Noto Sans KR", fontSize: 20, fill: "#ff5500" });
    expect(text?.futureElementField).toEqual({ retain: true });
    expect(bubble).toMatchObject({ font: "Noto Sans KR", fontSize: 30, textFill: "#ff5500", fill: "#ffffff" });
    expect(image).toEqual(pages[0]!.elements[2]);
    expect(result.pages[0]?.unknownPageField).toEqual({ retain: true });
  });

  it("opacity/blend/숨김/잠금을 일반 요소 필터에 적용한다", async () => {
    const result = await executeStudioAutoAction({
      actionSet: actionSet([
        {
          id: "opacity",
          type: "element.set-opacity",
          opacity: 0.25,
          filter: { elementTypes: ["image"], name: { mode: "contains", value: "배경" } },
        },
        { id: "blend", type: "element.set-blend-mode", blendMode: "multiply", filter: { elementTypes: ["image"] } },
        { id: "hide", type: "element.set-hidden", hidden: true, filter: { name: { mode: "exact", value: "효과" } } },
        { id: "lock", type: "element.set-locked", locked: true, filter: { elementTypes: ["text"] } },
      ]),
      pages: pagesFixture(),
      scope: { kind: "all" },
    });
    const p1 = result.pages[0]!.elements as Array<Record<string, unknown>>;
    const p2 = result.pages[1]!.elements as Array<Record<string, unknown>>;
    const p3 = result.pages[2]!.elements as Array<Record<string, unknown>>;
    expect(p1[2]).toMatchObject({ opacity: 0.25, blendMode: "multiply" });
    expect(p2[1]).toMatchObject({ opacity: 0.25, blendMode: "multiply" });
    expect(p1[0]).toMatchObject({ locked: true });
    expect(p2[0]).toMatchObject({ locked: true });
    expect(p3[0]).toMatchObject({ hidden: true });
  });

  it("페이지 배경과 색보정 preset을 적용하면서 page/grade unknown 필드를 보존한다", async () => {
    const result = await executeStudioAutoAction({
      actionSet: actionSet([
        {
          id: "gradient",
          type: "page.set-background",
          background: { kind: "gradient", colors: ["#112233", "#445566"] },
        },
        { id: "night", type: "page.apply-grade-preset", preset: "night" },
      ]),
      pages: pagesFixture(),
      scope: { kind: "current" },
      currentPageId: "p1",
    });
    expect(result.pages[0]).toMatchObject({
      bg: "#112233",
      bgGrad: ["#112233", "#445566"],
      unknownPageField: { retain: true },
      grade: { brightness: 0.75, futureGradeField: "retain" },
    });
    expect(result.pages[1]).toEqual(pagesFixture()[1]);
  });

  it("페이지 검증 실패 시 다른 페이지의 성공 결과도 commit하지 않는다", async () => {
    const pages = pagesFixture();
    const broken = [
      pages[0]!,
      { ...pages[1]!, elements: [null] },
    ] satisfies StudioAutoActionPage[];
    const result = await executeStudioAutoAction({
      actionSet: actionSet([{ id: "hide", type: "element.set-hidden", hidden: true }]),
      pages: broken,
      scope: { kind: "all" },
    });
    expect(result.status).toBe("failed");
    expect(result.committed).toBe(false);
    expect(result.pages).toBe(broken);
    expect(result.failures).toMatchObject([{ pageId: "p2", commandId: "hide", code: "invalid_element" }]);
    expect((broken[0].elements[0] as Record<string, unknown>).hidden).toBeUndefined();
  });

  it("AbortSignal이 실행 중 취소되면 계산 중인 새 문서를 버리고 원본만 반환한다", async () => {
    const controller = new AbortController();
    const pages: StudioAutoActionPage[] = Array.from({ length: 40 }, (_, index) => ({
      id: `p${index + 1}`,
      elements: [{ id: `e${index + 1}`, type: "text", text: "대사", fill: "#000000" }],
    }));
    let yields = 0;
    const result = await executeStudioAutoAction({
      actionSet: actionSet([{ id: "color", type: "lettering.set-color", color: "#ffffff" }]),
      pages,
      scope: { kind: "all" },
      signal: controller.signal,
      yieldControl: async () => {
        yields += 1;
        controller.abort("user_cancelled");
      },
    });
    expect(yields).toBe(1);
    expect(result).toMatchObject({ status: "cancelled", committed: false, failures: [] });
    expect(result.pages).toBe(pages);
    expect((pages[0]!.elements[0] as Record<string, unknown>).fill).toBe("#000000");
  });
});
