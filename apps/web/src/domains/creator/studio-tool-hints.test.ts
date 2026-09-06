import { describe, expect, it } from "vitest";

import {
  STUDIO_FILTER_CATALOG,
  studioFilterCatalogEntry,
  studioFilterGroupLabel,
} from "./filter/studio-filter-catalog";
import { STUDIO_ADJUSTMENT_ENGINE_IDS } from "./studio-adjustment-stack";
import { studioToolHintPreview } from "./studio-tool-hint-preview-routing";
import {
  studioToolHint,
  studioToolHintFromLabel,
} from "./studio-tool-hints";

describe("studio tool hints (rich hover copy)", () => {
  it("returns rich titles and descriptions for core rail tools", () => {
    const pen = studioToolHint("pen");
    expect(pen?.title).toBe("펜");
    expect(pen?.description.length).toBeGreaterThan(20);
    expect(pen?.shortcut).toBe("B");
    expect(pen?.preview).toBe("ink");
    expect(pen?.tip).toMatch(/\[|크기/u);
    expect(studioToolHint("missing")).toBeNull();
  });

  it("전문 용어보다 사용 결과를 먼저 설명하고 익숙한 이름은 함께 보존한다", () => {
    expect(studioToolHint("fill")).toMatchObject({
      title: "색 채우기 (페인트 버킷)",
    });
    expect(studioToolHint("fill")?.description).toContain("한 번에 색칠");
    expect(studioToolHint("fill")?.tip).toContain("틈 닫기");
    expect(studioToolHint("eyedropper")?.title).toBe("색 가져오기 (스포이드)");
    expect(studioToolHint("filter")?.description).toContain("흐리게");
    expect(studioToolHint("lasso")?.description).toContain("고칠 부분의 둘레");
    expect(studioToolHint("pixel-select")?.description).toContain("선택한 부분에만");
  });

  it("infers purposeful visuals for dynamic rail tools", () => {
    expect(
      studioToolHintPreview({
        id: "liquify",
        title: "액체화",
        description: "이미지 위를 밀어 국소 왜곡합니다.",
      })
    ).toBe("liquify");
    expect(
      studioToolHintPreview({
        id: "comment",
        title: "댓글",
        description: "캔버스에 협업 댓글을 남깁니다.",
      })
    ).toBe("comment");
  });

  it.each([
    ["brush-size", "brush-size"],
    ["opacity", "opacity"],
    ["stroke-stabilizer", "stabilizer"],
    ["pen-pressure", "pressure"],
    ["symmetry", "symmetry"],
    ["zoom-fit", "zoom-view"],
    ["shape-rect", "shape"],
    ["shape-ellipse", "shape"],
    ["undo", "undo"],
    ["add-layer", "layer"],
    ["poly-lasso", "polygon-lasso"],
    ["flip-view", "flip-view"],
    ["duplicate-layer", "layer-duplicate"],
  ] as const)("resolves the stable %s action id before prose", (id, expected) => {
    expect(
      studioToolHintPreview({
        id,
        title: "동적 메뉴",
        description: "다른 기능 이름이 들어가도 액션 ID가 우선합니다.",
      })
    ).toBe(expected);
  });

  it.each([
    ["sharpen-preview", "Sharpen preview"],
    ["inversion-preview", "Invert preview"],
    ["commentary-mode", "Commentary mode"],
  ] as const)("does not classify incidental substrings in %s", (id, title) => {
    expect(
      studioToolHintPreview({
        id,
        title,
        description: "등록되지 않은 통합 도구입니다.",
      })
    ).toBe("select");
  });

  it.each([
    ["펜 (B)", "pen", "ink"],
    ["브러시", "brush-settings", "draw-settings"],
    ["브러시 설정", "brush-settings", "draw-settings"],
    ["불투명도", "opacity", "opacity"],
    ["화면 맞춤", "zoom-view", "zoom-view"],
    ["되돌리기", "undo", "undo"],
    ["레이어", "layer", "layer"],
    ["텍스트 추가", "text", "text"],
    ["핸드 (팬)", "hand", "pan"],
    ["픽셀 펜 (P)", "pixel-pencil", "pixel-ink"],
    ["혼합 (스머지)", "blend", "smudge"],
    ["사각 선택 (M)", "marquee-rect", "marquee-rect"],
  ] as const)("turns the %s label into the stable %s id", (label, id, expectedPreview) => {
    const hint = studioToolHintFromLabel(label, "설명");

    expect(hint.id).toBe(id);
    expect(studioToolHintPreview(hint)).toBe(expectedPreview);
  });

  it("creates a deterministic slug for an unregistered display label", () => {
    expect(studioToolHintFromLabel("커스텀 잉크 믹서 (⇧K)", "설명").id).toBe(
      "커스텀-잉크-믹서"
    );
  });

  it("lets a contextual dock override a registered label with its exact action preview", () => {
    const hint = studioToolHintFromLabel(
      "도형",
      "모바일 도크에서는 보정 도형이 아니라 직접 벡터 도형을 그립니다.",
      undefined,
      "shape",
      "shape-picker-arrow"
    );

    expect(hint.preview).toBe("shape");
    expect(hint.previewVariant).toBe("shape-picker-arrow");
  });

  it("rejects cross-family overrides at the public label helper", () => {
    const compileTimeInvalidOverride = (): void => {
      // @ts-expect-error pause belongs to playback previews, not direct shapes.
      studioToolHintFromLabel("도형", "설명", undefined, "shape", "pause");
      // @ts-expect-error default-only ink previews do not accept variants.
      studioToolHintFromLabel("펜", "설명", "B", "ink", "line");
    };

    expect(compileTimeInvalidOverride).toBeTypeOf("function");
  });

  it.each([
    ["선택 (V)", "select"],
    ["핸드 (팬)", "pan"],
    ["사각 선택 (M)", "marquee-rect"],
    ["원형 선택", "marquee-ellipse"],
    ["변형 (⇧T)", "transform"],
    ["자르기 (C)", "crop"],
    ["펜 (B)", "ink"],
    ["픽셀 펜 (P)", "pixel-ink"],
    ["지우개 (E)", "erase"],
    ["혼합 (스머지) (N)", "smudge"],
    ["리퀴파이 (J)", "liquify"],
    ["채우기 (G)", "fill"],
    ["스포이드 (I / Alt+클릭)", "sample"],
    ["올가미 채우기", "lasso-fill"],
    ["올가미 선택", "lasso"],
    ["댓글 핀 배치", "comment"],
    ["투시도", "perspective"],
    ["보기 확대·축소 (Z)", "zoom-view"],
    ["보기 회전 (R)", "rotate-view"],
    ["보기 반전", "flip-view"],
    ["스마트 도형", "smart-shape"],
    ["사각형 도형", "shape"],
    ["타원 도형", "shape"],
    ["텍스트 추가", "text"],
    ["말풍선 추가", "bubble"],
    ["이미지 추가", "image"],
    ["프레임 애니메이션", "frame-sequence"],
    ["참고 이미지", "reference"],
    ["더보기 · 툴바 설정", "settings"],
  ] as const)("routes the visible rail label %s to %s", (label, expectedPreview) => {
    expect(studioToolHintPreview(studioToolHintFromLabel(label, "도구 설명"))).toBe(
      expectedPreview
    );
  });

  it("routes direct rail shapes to bounding-box drag coaches instead of smart correction", () => {
    expect(studioToolHintFromLabel("사각형 도형", "도구 설명")).toMatchObject({
      preview: "shape",
      previewVariant: "rect",
    });
    expect(studioToolHintFromLabel("타원 도형", "도구 설명")).toMatchObject({
      preview: "shape",
      previewVariant: "ellipse",
    });
    expect(
      studioToolHintPreview({
        id: "shape-rect",
        title: "사각형 도형",
        description: "ID만 전달된 직접 도형",
      })
    ).toBe("shape");
    expect(
      studioToolHintPreview({
        id: "shape-ellipse",
        title: "타원 도형",
        description: "ID만 전달된 직접 도형",
      })
    ).toBe("shape");
  });

  it("catalogs blur and tone filters with groups", () => {
    expect(studioFilterCatalogEntry("gaussian-blur")?.title).toContain("가우시안");
    expect(studioFilterCatalogEntry("motion-blur")?.description).toMatch(/각도|속도|이동/);
    expect(studioFilterCatalogEntry("curves")?.group).toBe("tone");
    expect(studioFilterCatalogEntry("channel-mixer")?.group).toBe("color");
    expect(studioFilterCatalogEntry("gradient-map")?.group).toBe("color");
    expect(studioFilterGroupLabel("blur")).toBe("흐림·초점");
    expect(STUDIO_FILTER_CATALOG.some((e) => e.engine === "gaussian-blur")).toBe(true);
    expect(STUDIO_FILTER_CATALOG.some((e) => e.engine === "motion-blur")).toBe(true);
  });

  it("gives every supported adjustment engine a filter identity", () => {
    expect(STUDIO_ADJUSTMENT_ENGINE_IDS.every((engine) => studioFilterCatalogEntry(engine))).toBe(
      true
    );
  });

  it.each(STUDIO_FILTER_CATALOG)(
    "resolves the $engine filter engine as a filter preview",
    (entry) => {
      expect(
        studioToolHintPreview({
          id: entry.engine,
          title: entry.title,
          description: entry.description,
        })
      ).toBe("filter");
    }
  );
});
