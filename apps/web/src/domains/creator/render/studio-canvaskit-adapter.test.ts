import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  CANVASKIT_ADOPTION_NOTE,
  CANVASKIT_BUNDLE_FACTS,
  createBasicQualityEngine,
  estimateAdvanceEm,
  qualityEngineLoadError,
  qualityEngineNow,
  registerQualityEngineLoader,
  resetQualityEngine,
  resolveQualityEngine,
  type StudioQualityEngine,
} from "./studio-canvaskit-adapter";

beforeEach(() => {
  resetQualityEngine();
});

/** 테스트용 가짜 고품질 엔진 — 실제 CanvasKit 자리에 꽂히는 것과 같은 모양. */
function fakeCanvasKitEngine(): StudioQualityEngine {
  return {
    id: "canvaskit",
    capabilities: { textShaping: true, pathBoolean: true, strokeToPath: true, fontSubsetting: true },
    shapeText: (request) => ({
      glyphs: [{ glyphId: 42, cluster: 0, advancePx: request.fontSizePx, xOffsetPx: 0, yOffsetPx: 0 }],
      lines: [{ text: request.text, startCluster: 0, endCluster: request.text.length, widthPx: request.fontSizePx }],
      widthPx: request.fontSizePx,
      ascentPx: request.fontSizePx * 0.8,
      descentPx: request.fontSizePx * 0.2,
      shaped: true,
      limitations: [],
    }),
    pathOp: (a, b, op) => ({ ok: true, pathData: `${a}|${b}|${op}` }),
    strokeToPath: (pathData) => ({ ok: true, pathData: `stroked(${pathData})` }),
  };
}

describe("폭 추정", () => {
  it("한글·한자·전각은 1em, 라틴은 0.5em, 공백은 더 좁다", () => {
    expect(estimateAdvanceEm("가")).toBe(1);
    expect(estimateAdvanceEm("漢")).toBe(1);
    expect(estimateAdvanceEm("Ａ")).toBe(1);
    expect(estimateAdvanceEm("A")).toBe(0.5);
    expect(estimateAdvanceEm("!")).toBe(0.5);
    expect(estimateAdvanceEm(" ")).toBe(0.28);
  });
});

describe("명시적 basic-reference 엔진 — 셰이핑", () => {
  const engine = createBasicQualityEngine();

  it("자기 능력을 정직하게 신고한다", () => {
    expect(engine.id).toBe("basic-reference");
    expect(engine.capabilities).toEqual({
      textShaping: false,
      pathBoolean: false,
      strokeToPath: false,
      fontSubsetting: false,
    });
  });

  it("shaped=false와 한계 목록을 항상 함께 낸다", () => {
    const run = engine.shapeText({ text: "안녕하세요", fontFamily: "Pretendard", fontSizePx: 20 });
    expect(run.shaped).toBe(false);
    expect(run.limitations.length).toBeGreaterThan(0);
    expect(run.limitations.join(" ")).toContain("커닝");
    expect(run.limitations.join(" ")).toContain("BiDi");
  });

  it("글리프 id를 지어내지 않는다(null)", () => {
    const run = engine.shapeText({ text: "AB", fontFamily: "sans", fontSizePx: 10 });
    expect(run.glyphs.map((glyph) => glyph.glyphId)).toEqual([null, null]);
    expect(run.glyphs.map((glyph) => glyph.cluster)).toEqual([0, 1]);
  });

  it("전각/반각 전진폭과 누적 위치를 계산한다", () => {
    const run = engine.shapeText({ text: "A가", fontFamily: "sans", fontSizePx: 20 });
    expect(run.glyphs[0]!.advancePx).toBe(10);
    expect(run.glyphs[1]!.advancePx).toBe(20);
    expect(run.glyphs[0]!.xOffsetPx).toBe(0);
    expect(run.glyphs[1]!.xOffsetPx).toBe(10);
    expect(run.widthPx).toBe(30);
  });

  it("자간을 글자마다 더한다", () => {
    const run = engine.shapeText({ text: "AAA", fontFamily: "sans", fontSizePx: 10, letterSpacingPx: 2 });
    expect(run.glyphs.map((glyph) => glyph.advancePx)).toEqual([7, 7, 7]);
    expect(run.widthPx).toBe(21);
  });

  it("상단/하단 메트릭을 폰트 크기 비율로 낸다", () => {
    const run = engine.shapeText({ text: "A", fontFamily: "sans", fontSizePx: 100 });
    expect(run.ascentPx).toBe(88);
    expect(run.descentPx).toBe(22);
    const custom = createBasicQualityEngine({ ascentRatio: 0.75, descentRatio: 0.25 }).shapeText({
      text: "A",
      fontFamily: "sans",
      fontSizePx: 100,
    });
    expect(custom.ascentPx).toBe(75);
  });

  it("주입한 측정기를 쓴다(브라우저 measureText 연결점)", () => {
    const measured = createBasicQualityEngine({ measureAdvance: () => 7 });
    const run = measured.shapeText({ text: "가나다", fontFamily: "sans", fontSizePx: 20 });
    expect(run.widthPx).toBe(21);
  });
});

describe("명시적 basic-reference 엔진 — 줄바꿈", () => {
  const engine = createBasicQualityEngine();

  it("maxWidth가 없으면 개행 문자만으로 나눈다", () => {
    const run = engine.shapeText({ text: "가나\n다", fontFamily: "sans", fontSizePx: 10 });
    expect(run.lines.map((line) => line.text)).toEqual(["가나", "다"]);
  });

  it("공백에서 우선 끊는다", () => {
    const run = engine.shapeText({ text: "AAA BBB CCC", fontFamily: "sans", fontSizePx: 10, maxWidthPx: 40 });
    expect(run.lines.length).toBeGreaterThan(1);
    for (const line of run.lines) expect(line.text.startsWith(" ")).toBe(false);
  });

  it("공백 없는 한글은 글자 단위로 끊는다", () => {
    // 20px 전각 → 글자당 20px. maxWidth 60이면 3글자씩.
    const run = engine.shapeText({ text: "가나다라마바", fontFamily: "sans", fontSizePx: 20, maxWidthPx: 60 });
    expect(run.lines.map((line) => line.text)).toEqual(["가나다", "라마바"]);
    for (const line of run.lines) expect(line.widthPx).toBeLessThanOrEqual(60);
  });

  it("행두 금칙 문자를 다음 줄 첫 글자로 두지 않는다", () => {
    const run = engine.shapeText({ text: "가나다。라", fontFamily: "sans", fontSizePx: 20, maxWidthPx: 60 });
    expect(run.lines[1]!.text.startsWith("。")).toBe(false);
  });

  it("빈 문자열도 한 줄을 낸다(레이아웃 계산이 무너지지 않게)", () => {
    const run = engine.shapeText({ text: "", fontFamily: "sans", fontSizePx: 10 });
    expect(run.lines).toEqual([{ text: "", startCluster: 0, endCluster: 0, widthPx: 0 }]);
    expect(run.widthPx).toBe(0);
  });

  it("한 글자가 maxWidth보다 넓어도 무한 루프에 빠지지 않는다", () => {
    const run = engine.shapeText({ text: "가나다", fontFamily: "sans", fontSizePx: 40, maxWidthPx: 5 });
    expect(run.lines).toHaveLength(3);
    expect(run.lines.map((line) => line.text)).toEqual(["가", "나", "다"]);
  });

  it("클러스터 범위가 원본 문자열을 빠짐없이 덮는다", () => {
    const text = "가나다 라마바 사아자";
    const run = engine.shapeText({ text, fontFamily: "sans", fontSizePx: 20, maxWidthPx: 80 });
    const rebuilt = run.lines.map((line) => [...text].slice(line.startCluster, line.endCluster).join("")).join("");
    expect(rebuilt.replace(/\s/gu, "")).toBe(text.replace(/\s/gu, ""));
  });
});

describe("명시적 basic-reference 엔진 — 패스 연산 미지원", () => {
  const engine = createBasicQualityEngine();

  it("불리언은 못 한다고 말하고 대안을 알린다", () => {
    const result = engine.pathOp("M0 0 L10 0", "M5 0 L15 0", "union");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("폴리곤 근사");
      expect(result.reason).toContain("곡선");
    }
  });

  it("획→패스도 못 한다고 말한다", () => {
    const result = engine.strokeToPath("M0 0 L10 0", {
      widthPx: 2,
      cap: "round",
      join: "miter",
      miterLimit: 4,
    });
    expect(result.ok).toBe(false);
  });
});

describe("엔진 해석 — lazy 로더", () => {
  it("로더가 없으면 선택한 CanvasKit을 unavailable로 닫는다", async () => {
    await expect(resolveQualityEngine()).rejects.toMatchObject({
      name: "StudioEngineUnavailableError",
      providerId: "canvaskit",
      stage: "initialization",
    });
    expect(qualityEngineLoadError()).toBeNull();
  });

  it("등록된 로더의 엔진을 돌려주고 한 번만 호출한다", async () => {
    const loader = vi.fn(async () => fakeCanvasKitEngine());
    registerQualityEngineLoader(loader);
    const first = await resolveQualityEngine();
    const second = await resolveQualityEngine();
    expect(first.id).toBe("canvaskit");
    expect(second).toBe(first);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("동시 호출에도 로더는 한 번만 실행된다", async () => {
    const loader = vi.fn(async () => fakeCanvasKitEngine());
    registerQualityEngineLoader(loader);
    const [a, b, c] = await Promise.all([resolveQualityEngine(), resolveQualityEngine(), resolveQualityEngine()]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("로드가 실패하면 다른 엔진 없이 unavailable로 닫는다", async () => {
    registerQualityEngineLoader(async () => {
      throw new Error("WASM 404");
    });
    await expect(resolveQualityEngine()).rejects.toMatchObject({
      name: "StudioEngineUnavailableError",
      providerId: "canvaskit",
      stage: "initialization",
    });
    expect(qualityEngineLoadError()).toContain("WASM 404");
    expect(qualityEngineLoadError()).toContain("선택한 엔진을 사용할 수 없습니다");
  });

  it("실패 후 다시 시도할 수 있다(캐시가 실패를 굳히지 않는다)", async () => {
    let attempt = 0;
    registerQualityEngineLoader(async () => {
      attempt++;
      if (attempt === 1) throw new Error("일시 오류");
      return fakeCanvasKitEngine();
    });
    await expect(resolveQualityEngine()).rejects.toMatchObject({
      providerId: "canvaskit",
    });
    expect((await resolveQualityEngine()).id).toBe("canvaskit");
    expect(attempt).toBe(2);
  });

  it("동기 접근은 로드 전 null, 성공 후 선택한 CanvasKit이다", async () => {
    registerQualityEngineLoader(async () => fakeCanvasKitEngine());
    expect(qualityEngineNow()).toBeNull();
    await resolveQualityEngine();
    expect(qualityEngineNow()?.id).toBe("canvaskit");
  });

  it("reset은 등록·캐시·오류를 모두 지운다", async () => {
    registerQualityEngineLoader(async () => fakeCanvasKitEngine());
    await resolveQualityEngine();
    resetQualityEngine();
    expect(qualityEngineNow()).toBeNull();
    expect(qualityEngineLoadError()).toBeNull();
    await expect(resolveQualityEngine()).rejects.toMatchObject({
      providerId: "canvaskit",
    });
  });

  it("로더를 null로 등록하면 해제된다", async () => {
    registerQualityEngineLoader(async () => fakeCanvasKitEngine());
    await resolveQualityEngine();
    registerQualityEngineLoader(null);
    await expect(resolveQualityEngine()).rejects.toMatchObject({
      providerId: "canvaskit",
    });
  });

  it("등록된 exact CanvasKit 엔진만 같은 인터페이스로 호출된다", async () => {
    registerQualityEngineLoader(async () => fakeCanvasKitEngine());
    const engine = await resolveQualityEngine();
    const run = engine.shapeText({ text: "가", fontFamily: "sans", fontSizePx: 20 });
    expect(run.shaped).toBe(true);
    expect(run.limitations).toEqual([]);
    expect(run.glyphs[0]!.glyphId).toBe(42);
    const boolean = engine.pathOp("A", "B", "difference");
    expect(boolean).toEqual({ ok: true, pathData: "A|B|difference" });
  });

  it("로더가 다른 provider를 반환하면 자동 대체로 받아들이지 않는다", async () => {
    registerQualityEngineLoader(async () => createBasicQualityEngine());
    await expect(resolveQualityEngine()).rejects.toMatchObject({
      name: "StudioEngineUnavailableError",
      providerId: "canvaskit",
      stage: "initialization",
    });
    expect(qualityEngineNow()).toBeNull();
  });
});

describe("번들 비용 고지", () => {
  it("설치된 변형별 WASM 실측과 압축 참고치를 구분한다", () => {
    expect(CANVASKIT_BUNDLE_FACTS.length).toBeGreaterThanOrEqual(2);
    for (const fact of CANVASKIT_BUNDLE_FACTS) {
      expect(fact.approxBrotliBytes).toBeLessThan(fact.approxRawBytes);
      expect(fact.approxRawBytes).toBeGreaterThan(1_000_000);
    }
    expect(CANVASKIT_BUNDLE_FACTS[0]!.note).toContain("로컬 실측");
    expect(CANVASKIT_ADOPTION_NOTE).toContain("lazy");
    expect(CANVASKIT_ADOPTION_NOTE).toContain("WASM 원본 크기는 실측");
  });

  it("full 배포본은 기본 배포본보다 크다", () => {
    expect(CANVASKIT_BUNDLE_FACTS[1]!.approxRawBytes).toBeGreaterThan(CANVASKIT_BUNDLE_FACTS[0]!.approxRawBytes);
  });
});
