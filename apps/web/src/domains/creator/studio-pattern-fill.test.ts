import { describe, expect, it } from "vitest";

import {
  DEFAULT_PATTERN_FG,
  DEFAULT_PATTERN_SPEC,
  PATTERN_SCALE_RANGE,
  STUDIO_PATTERNS,
  STUDIO_PATTERN_IDS,
  clampPatternScale,
  getPatternDef,
  isPatternSpec,
  konvaPatternProps,
  loadPatternImage,
  loadPatternTileImage,
  normalizePatternSpec,
  patternCacheKey,
  patternDataUrl,
  patternPreviewCss,
  patternSpecsEqual,
  patternTileSvg,
  searchStudioPatterns,
  setPatternBg,
  setPatternFg,
  setPatternId,
  setPatternScale,
  type PatternImageLike,
  type StudioPatternSpec,
} from "./studio-pattern-fill";

const spec = (over: Partial<StudioPatternSpec> = {}): StudioPatternSpec => ({
  patternId: "dots",
  fg: "#112233",
  scale: 1,
  ...over,
});

// 주입형 로더 검증용 가짜 이미지 — src 대입 시점에 동기로 onload를 발화해
// "핸들러를 src보다 먼저 건다"는 로더 규약까지 함께 검증한다.
function makeSyncFakeImage(fail = false): PatternImageLike {
  let value = "";
  const fake = {
    onload: null as PatternImageLike["onload"],
    onerror: null as PatternImageLike["onerror"],
    get src() {
      return value;
    },
    set src(next: string) {
      value = next;
      const handler = fail ? fake.onerror : fake.onload;
      handler?.(undefined as never);
    },
  };
  return fake;
}

describe("STUDIO_PATTERNS", () => {
  it("24종을 제공하고 id가 전부 고유", () => {
    expect(STUDIO_PATTERNS).toHaveLength(24);
    expect(new Set(STUDIO_PATTERN_IDS).size).toBe(24);
    expect(STUDIO_PATTERN_IDS).toEqual(STUDIO_PATTERNS.map((def) => def.id));
  });

  it("모든 패턴이 한글 라벨·팁과 양수 정사각 타일 크기를 가진다", () => {
    for (const def of STUDIO_PATTERNS) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(/[가-힣]/.test(def.label)).toBe(true);
      expect(/[가-힣]/.test(def.tip)).toBe(true);
      expect(def.tile).toBeGreaterThan(0);
      expect(Number.isFinite(def.tile)).toBe(true);
    }
  });

  it("inner 마크업이 주입한 전경색을 사용하고 결정적(같은 입력 → 같은 출력)", () => {
    for (const def of STUDIO_PATTERNS) {
      const markup = def.inner("#a1b2c3");
      expect(markup).toContain("#a1b2c3");
      expect(markup).toBe(def.inner("#a1b2c3"));
      expect(markup).not.toContain("NaN");
      expect(markup).not.toContain("undefined");
    }
  });

  it("getPatternDef — 알 수 없는 id는 기본 패턴(도트)으로 폴백", () => {
    expect(getPatternDef("hearts").id).toBe("hearts");
    expect(getPatternDef("no-such-pattern").id).toBe("dots");
  });

  it("만화 연출·재질 패턴을 한글/영문 다중 키워드로 검색", () => {
    expect(searchStudioPatterns("속도 motion").map((pattern) => pattern.id)).toContain("speed-lines");
    expect(searchStudioPatterns("hex 테크").map((pattern) => pattern.id)).toEqual(["honeycomb"]);
    expect(searchStudioPatterns("   ")).toBe(STUDIO_PATTERNS);
    expect(searchStudioPatterns("없는패턴xyz")).toEqual([]);
  });
});

describe("isPatternSpec / normalizePatternSpec", () => {
  it("유효 스펙을 통과시키고 쓰레기 값을 거른다", () => {
    expect(isPatternSpec(spec())).toBe(true);
    expect(isPatternSpec(spec({ bg: "#ffffff" }))).toBe(true);
    expect(isPatternSpec(DEFAULT_PATTERN_SPEC)).toBe(true);
    expect(isPatternSpec(null)).toBe(false);
    expect(isPatternSpec("dots")).toBe(false);
    expect(isPatternSpec({ patternId: "no-such", fg: "#000000", scale: 1 })).toBe(false);
    expect(isPatternSpec({ patternId: "dots", fg: "#000000", scale: Number.NaN })).toBe(false);
    expect(isPatternSpec({ patternId: "dots", fg: "#000000", bg: 3, scale: 1 })).toBe(false);
    expect(isPatternSpec({ patternId: "dots", scale: 1 })).toBe(false);
  });

  it("알 수 없는 patternId·무효 색·무효 배율을 안전한 기본값으로 되돌린다", () => {
    const normalized = normalizePatternSpec({ patternId: "vortex", fg: "red", bg: "blue", scale: Number.NaN });
    expect(normalized).toEqual({ patternId: "dots", fg: DEFAULT_PATTERN_FG, scale: 1 });
    expect("bg" in normalized).toBe(false);
    // 스펙이 아예 아닌 입력(구 문서 하위호환 게이트)도 기본 스펙으로.
    expect(normalizePatternSpec(undefined)).toEqual(DEFAULT_PATTERN_SPEC);
    expect(normalizePatternSpec(42)).toEqual(DEFAULT_PATTERN_SPEC);
  });

  it("#RGB 대문자를 소문자 #rrggbb로 정규화하고 배율을 범위로 클램프", () => {
    const normalized = normalizePatternSpec({ patternId: "stars", fg: "#AbC", bg: "#FFEEDD", scale: 99 });
    expect(normalized).toEqual({ patternId: "stars", fg: "#aabbcc", bg: "#ffeedd", scale: PATTERN_SCALE_RANGE.max });
    expect(clampPatternScale(0)).toBe(PATTERN_SCALE_RANGE.min);
    expect(clampPatternScale(2.5)).toBe(2.5);
    expect(clampPatternScale(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PATTERN_SPEC.scale);
  });

  it("입력 객체를 변이하지 않는다", () => {
    const input = spec({ fg: "#ABC" });
    const before = JSON.stringify(input);
    normalizePatternSpec(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("patternSpecsEqual", () => {
  it("정규화 후 비교 — 색 표기 차이는 같고, 종류/색/배경/배율 차이는 다르다", () => {
    expect(patternSpecsEqual(spec({ fg: "#AABBCC" }), spec({ fg: "#abc" }))).toBe(true);
    expect(patternSpecsEqual(spec(), spec({ patternId: "checker" }))).toBe(false);
    expect(patternSpecsEqual(spec(), spec({ bg: "#ffffff" }))).toBe(false);
    expect(patternSpecsEqual(spec({ scale: 1 }), spec({ scale: 2 }))).toBe(false);
    expect(patternSpecsEqual(null, null)).toBe(true);
    expect(patternSpecsEqual(spec(), null)).toBe(false);
  });
});

describe("패널 편집 헬퍼(무변이)", () => {
  it("setPatternId — 종류만 바꾸고 색·배율 유지, 새 객체 반환", () => {
    const base = spec({ bg: "#ffffff", scale: 2 });
    const next = setPatternId(base, "hearts");
    expect(next).toEqual({ patternId: "hearts", fg: "#112233", bg: "#ffffff", scale: 2 });
    expect(base.patternId).toBe("dots");
  });

  it("setPatternFg — 색 정규화, 무효 색은 기존 색 유지", () => {
    expect(setPatternFg(spec(), "#FF0000").fg).toBe("#ff0000");
    expect(setPatternFg(spec(), "tomato").fg).toBe("#112233");
  });

  it("setPatternBg — null이면 bg 키 자체를 생략(투명), 색이면 정규화 대입", () => {
    const withBg = setPatternBg(spec(), "#FAFAFA");
    expect(withBg.bg).toBe("#fafafa");
    const cleared = setPatternBg(withBg, null);
    expect("bg" in cleared).toBe(false);
    expect(cleared).toEqual({ patternId: "dots", fg: "#112233", scale: 1 });
  });

  it("setPatternScale — 범위 클램프", () => {
    expect(setPatternScale(spec(), 0.5).scale).toBe(0.5);
    expect(setPatternScale(spec(), 100).scale).toBe(PATTERN_SCALE_RANGE.max);
    expect(setPatternScale(spec(), -1).scale).toBe(PATTERN_SCALE_RANGE.min);
  });
});

describe("patternTileSvg / patternDataUrl / patternCacheKey", () => {
  it("타일 SVG가 self-contained이고 전경색이 주입된다", () => {
    const svg = patternTileSvg(spec({ fg: "#a1b2c3" }));
    const def = getPatternDef("dots");
    expect(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\"")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain(`width="${def.tile}" height="${def.tile}"`);
    expect(svg).toContain("#a1b2c3");
  });

  it("bg가 있으면 배경 rect를 깔고, 없으면(투명) 배경 rect가 없다", () => {
    const withBg = patternTileSvg(spec({ bg: "#ffee00" }));
    expect(withBg).toContain(`<rect width="100%" height="100%" fill="#ffee00"/>`);
    const transparent = patternTileSvg(spec());
    expect(transparent).not.toContain(`width="100%"`);
  });

  it("모든 패턴의 data URL이 인코딩되고 원본 SVG로 복원된다", () => {
    for (const id of STUDIO_PATTERN_IDS) {
      const s = spec({ patternId: id, bg: "#ffffff" });
      const url = patternDataUrl(s);
      expect(url.startsWith("data:image/svg+xml;utf8,")).toBe(true);
      // `#`/`<`/공백이 그대로 남으면 src가 깨진다.
      expect(url).not.toContain("#");
      expect(url).not.toContain("<");
      expect(decodeURIComponent(url.slice("data:image/svg+xml;utf8,".length))).toBe(patternTileSvg(s));
    }
  });

  it("캐시 키는 patternId/fg/bg만 반영 — 배율이 달라도 같은 키(재로드 없음)", () => {
    expect(patternCacheKey(spec({ scale: 0.5 }))).toBe(patternCacheKey(spec({ scale: 3 })));
    expect(patternCacheKey(spec())).not.toBe(patternCacheKey(spec({ patternId: "grid" })));
    expect(patternCacheKey(spec())).not.toBe(patternCacheKey(spec({ fg: "#000000" })));
    expect(patternCacheKey(spec())).not.toBe(patternCacheKey(spec({ bg: "#ffffff" })));
  });
});

describe("konvaPatternProps", () => {
  const image = { width: 16, height: 16 };

  it("스펙과 이미지가 모두 있어야 props를 만들고, 아니면 빈 객체(no-op 스프레드)", () => {
    expect(konvaPatternProps(null, image)).toEqual({});
    expect(konvaPatternProps(undefined, image)).toEqual({});
    // 타일 로드 전(null) — fill/그라데이션 폴백 유지 규약.
    expect(konvaPatternProps(spec(), null)).toEqual({});
    expect(konvaPatternProps(spec(), undefined)).toEqual({});
  });

  it("fillPriority=pattern + 반복 + 배율(X/Y 동일)로 계획한다", () => {
    const props = konvaPatternProps(spec({ scale: 2.5 }), image);
    expect(props).toEqual({
      fillPriority: "pattern",
      fillPatternImage: image,
      fillPatternRepeat: "repeat",
      fillPatternScaleX: 2.5,
      fillPatternScaleY: 2.5,
    });
    // 이미지 참조는 그대로 통과(래핑/복사 없음).
    expect(props.fillPatternImage).toBe(image);
  });

  it("무효 스펙은 정규화해 계획한다(배율 클램프)", () => {
    const props = konvaPatternProps({ patternId: "dots", fg: "#000000", scale: 999 } as StudioPatternSpec, image);
    expect(props.fillPatternScaleX).toBe(PATTERN_SCALE_RANGE.max);
  });
});

describe("loadPatternTileImage / loadPatternImage (주입형 팩토리)", () => {
  it("팩토리가 만든 이미지에 src를 대입하고 onload 시 그 이미지로 resolve", async () => {
    const created: PatternImageLike[] = [];
    const loaded = await loadPatternImage(spec(), () => {
      const fake = makeSyncFakeImage();
      created.push(fake);
      return fake;
    });
    expect(created).toHaveLength(1);
    expect(loaded).toBe(created[0]);
    expect(loaded.src).toBe(patternDataUrl(spec()));
  });

  it("onerror 시 한글 메시지로 reject", async () => {
    await expect(loadPatternTileImage("data:broken", () => makeSyncFakeImage(true))).rejects.toThrow(
      "패턴 타일 이미지를 로드하지 못했습니다."
    );
  });
});

describe("patternPreviewCss", () => {
  it("배경 이미지 url + 배율 반영 background-size를 돌려준다", () => {
    const css = patternPreviewCss(spec({ patternId: "grid", scale: 2 }));
    const tile = getPatternDef("grid").tile;
    expect(css.backgroundImage.startsWith(`url("data:image/svg+xml;utf8,`)).toBe(true);
    expect(css.backgroundSize).toBe(`${tile * 2}px ${tile * 2}px`);
    expect(css.backgroundRepeat).toBe("repeat");
  });

  it("무효 입력도 정규화해 안전한 스타일을 만든다", () => {
    const css = patternPreviewCss({ patternId: "junk", fg: "bad", scale: Number.NaN } as unknown as StudioPatternSpec);
    expect(css.backgroundSize).toBe(`${getPatternDef("dots").tile}px ${getPatternDef("dots").tile}px`);
  });
});
