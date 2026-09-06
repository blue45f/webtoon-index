import { describe, expect, it } from "vitest";

import {
  flattenPsdLayers,
  importPsdFile,
  inspectPsdHeader,
  mapPsdBlendMode,
  placementForLayer,
  preflightPsdImport,
  PSD_IMPORT_MAX_DECODED_BYTES,
  PSD_IMPORT_MAX_DIMENSION_PX,
  PSD_IMPORT_MAX_FILE_BYTES,
  psdImportResultMessage,
  type PsdImportDeps,
  type PsdImportedElement,
} from "./studio-psd-import";

import type { Layer, Psd } from "ag-psd";

// ── 픽스처 헬퍼 — ag-psd Layer/Psd 는 필드가 전부 optional 이라 필요한 것만 채운다 ──────────

function fakeCanvas(
  dataUrl = "data:image/png;base64,AAAA",
  width = 100,
  height = 100,
): HTMLCanvasElement {
  return { width, height, toDataURL: () => dataUrl } as unknown as HTMLCanvasElement;
}

/** 리프(비그룹) 레이어 — 기본으로 100x100 bounds + 캔버스를 채워 "정상 임포트 가능" 상태로 만든다. */
function leaf(over: Partial<Layer> = {}): Layer {
  return { left: 0, top: 0, right: 100, bottom: 100, canvas: fakeCanvas(), ...over };
}

/** 그룹(폴더) 레이어 — children 배열(빈 배열 포함)이 있으면 ag-psd 상 그룹으로 취급된다. */
function group(children: Layer[], over: Partial<Layer> = {}): Layer {
  return { children, ...over };
}

function samplePsd(children: Layer[] = [], overrides: Partial<Psd> = {}): Psd {
  return { width: 720, height: 1080, children, ...overrides };
}

function psdHeader(overrides: {
  version?: 1 | 2;
  channels?: number;
  width?: number;
  height?: number;
  bitsPerChannel?: 1 | 8 | 16 | 32;
  colorMode?: number;
} = {}): ArrayBuffer {
  const buffer = new ArrayBuffer(26);
  const view = new DataView(buffer);
  view.setUint32(0, 0x38425053, false);
  view.setUint16(4, overrides.version ?? 1, false);
  view.setUint16(12, overrides.channels ?? 4, false);
  view.setUint32(14, overrides.height ?? 1080, false);
  view.setUint32(18, overrides.width ?? 720, false);
  view.setUint16(22, overrides.bitsPerChannel ?? 8, false);
  view.setUint16(24, overrides.colorMode ?? 3, false);
  return buffer;
}

describe("PSD/PSB clean-room header preflight", () => {
  it("reads the public 8BPS header without invoking the bitmap decoder", () => {
    expect(inspectPsdHeader(psdHeader())).toEqual({
      container: "psd",
      version: 1,
      width: 720,
      height: 1080,
      channels: 4,
      bitsPerChannel: 8,
      colorModeCode: 3,
      colorMode: "RGB",
    });
  });

  it("fails PSB, high bit depth, unsupported color space, and unsafe dimensions closed", () => {
    expect(preflightPsdImport(psdHeader({ version: 2 }), "large.psb")).toMatchObject({
      canImport: false,
      header: { container: "psb" },
      blockingReasons: [expect.stringContaining("PSB")],
    });
    expect(preflightPsdImport(psdHeader({ bitsPerChannel: 16 }))).toMatchObject({
      canImport: false,
      blockingReasons: [expect.stringContaining("16bit")],
    });
    expect(preflightPsdImport(psdHeader({ colorMode: 4 }))).toMatchObject({
      canImport: false,
      blockingReasons: [expect.stringContaining("CMYK")],
    });
    expect(preflightPsdImport(
      psdHeader({ width: PSD_IMPORT_MAX_DIMENSION_PX + 1 }),
    )).toMatchObject({
      canImport: false,
      blockingReasons: [expect.stringContaining("안전 한 변")],
    });
  });

  it("allows bounded grayscale/indexed input but records the sRGB raster conversion", () => {
    const preflight = preflightPsdImport(psdHeader({ colorMode: 1 }));
    expect(preflight.canImport).toBe(true);
    expect(preflight.lossManifest.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        feature: "color-space",
        disposition: "rasterized",
        message: expect.stringContaining("Grayscale"),
      }),
    ]));
    expect(preflight.lossManifest.target).toMatchObject({
      container: "studio",
      bitsPerChannel: 8,
      colorMode: "sRGB",
    });
  });
});

describe("flattenPsdLayers", () => {
  it("빈 문서는 빈 배열을 반환한다", () => {
    expect(flattenPsdLayers(samplePsd([]))).toEqual([]);
  });

  it("평면(그룹 없음) 레이어를 ag-psd 순서(맨 위가 먼저)에서 Studio 순서(맨 뒤가 먼저)로 뒤집는다", () => {
    const psd = samplePsd([leaf({ name: "A" }), leaf({ name: "B" }), leaf({ name: "C" })]);
    expect(flattenPsdLayers(psd).map((f) => f.name)).toEqual(["C", "B", "A"]);
  });

  it("중첩 그룹을 제자리에서 펼쳐 전체 문서의 앞뒤 순서를 보존한다", () => {
    // ag-psd 순서: A(맨 위), G(X,Y 포함), B(맨 아래) → 정방향 평탄화: [A,X,Y,B] → 뒤집으면 [B,Y,X,A].
    const psd = samplePsd([
      leaf({ name: "A" }),
      group([leaf({ name: "X" }), leaf({ name: "Y" })], { name: "G" }),
      leaf({ name: "B" }),
    ]);
    expect(flattenPsdLayers(psd).map((f) => f.name)).toEqual(["B", "Y", "X", "A"]);
  });

  it("그룹 불투명도를 자식에 곱연산으로 누적한다", () => {
    const psd = samplePsd([group([leaf({ opacity: 0.5 })], { opacity: 0.5 })]);
    expect(flattenPsdLayers(psd)[0].opacity).toBeCloseTo(0.25);
  });

  it("그룹 숨김을 자식에 OR 로 누적한다(자식 자신은 숨김이 아니어도)", () => {
    const psd = samplePsd([group([leaf({ hidden: false })], { hidden: true })]);
    expect(flattenPsdLayers(psd)[0].hidden).toBe(true);
  });

  it("bounds(left/top/width/height) 를 right-left/bottom-top 으로 계산한다", () => {
    const psd = samplePsd([leaf({ left: 20, top: 30, right: 120, bottom: 180 })]);
    expect(flattenPsdLayers(psd)[0]).toMatchObject({ left: 20, top: 30, width: 100, height: 150 });
  });

  it("조정 레이어는 canvas 없이도 즉시 skipReason:adjustment 로 표시된다", () => {
    const psd = samplePsd([leaf({ name: "톤보정", adjustment: { type: "invert" }, canvas: undefined })]);
    const flat = flattenPsdLayers(psd);
    expect(flat).toHaveLength(1);
    expect(flat[0].skipReason).toBe("adjustment");
  });

  it("bounds 가 비어 있으면(width 또는 height 0) skipReason:empty-bounds", () => {
    const psd = samplePsd([leaf({ left: 10, top: 10, right: 10, bottom: 10 })]);
    expect(flattenPsdLayers(psd)[0].skipReason).toBe("empty-bounds");
  });

  it("bounds 는 있지만 canvas 가 없으면 skipReason:no-canvas", () => {
    const psd = samplePsd([{ left: 0, top: 0, right: 50, bottom: 50 }]);
    expect(flattenPsdLayers(psd)[0].skipReason).toBe("no-canvas");
  });

  it("정상 리프(bounds+canvas 있음, adjustment 아님)는 skipReason 이 없다", () => {
    const psd = samplePsd([leaf({ name: "OK" })]);
    expect(flattenPsdLayers(psd)[0].skipReason).toBeUndefined();
  });

  it("이름 없는 레이어는 최종 Studio 순서 기준 순번으로 '레이어 N' 폴백을 받는다", () => {
    const psd = samplePsd([leaf(), leaf()]); // ag-psd 순서: 1번째=맨 위, 2번째=맨 아래
    expect(flattenPsdLayers(psd).map((f) => f.name)).toEqual(["레이어 1", "레이어 2"]);
  });
});

describe("mapPsdBlendMode", () => {
  it("normal → source-over", () => {
    expect(mapPsdBlendMode("normal")).toBe("source-over");
  });

  it("알려진 모드는 Studio 문자열로 매핑된다", () => {
    expect(mapPsdBlendMode("multiply")).toBe("multiply");
    expect(mapPsdBlendMode("color burn")).toBe("color-burn");
    expect(mapPsdBlendMode("hard light")).toBe("hard-light");
  });

  it("undefined 는 source-over 로 방어한다", () => {
    expect(mapPsdBlendMode(undefined)).toBe("source-over");
  });

  it("Canvas 합성에 대응 개념이 없는 모드는 source-over 로 방어한다", () => {
    expect(mapPsdBlendMode("dissolve")).toBe("source-over");
    expect(mapPsdBlendMode("pass through")).toBe("source-over");
  });
});

describe("placementForLayer", () => {
  it("targetWidth/psdWidth 비율로 bounds 를 균일 스케일한다", () => {
    const result = placementForLayer({ left: 100, top: 200, width: 300, height: 400 }, 1440, 720);
    expect(result).toEqual({ x: 50, y: 100, width: 150, height: 200, scale: 0.5 });
  });

  it("확대는 하지 않는다(스케일 상한 1)", () => {
    const result = placementForLayer({ left: 10, top: 10, width: 100, height: 100 }, 360, 720);
    expect(result).toEqual({ x: 10, y: 10, width: 100, height: 100, scale: 1 });
  });

  it("psdWidth/targetWidth 가 0 이하이면 스케일 1로 방어한다", () => {
    expect(placementForLayer({ left: 0, top: 0, width: 10, height: 10 }, 0, 720).scale).toBe(1);
    expect(placementForLayer({ left: 0, top: 0, width: 10, height: 10 }, 720, 0).scale).toBe(1);
  });
});

describe("psdImportResultMessage", () => {
  function stubElement(): PsdImportedElement {
    return { id: "x", type: "image", src: "data:", x: 0, y: 0, width: 1, height: 1, rotation: 0 };
  }

  it("알림이 없으면 레이어 개수만 표시한다", () => {
    const msg = psdImportResultMessage({
      elements: [stubElement(), stubElement()],
      sourceWidth: 1,
      sourceHeight: 1,
      scale: 1,
      skipped: [],
    });
    expect(msg).toBe("PSD 가져오기 완료 — 레이어 2개");
  });

  it("알림이 있으면 건수를 이어붙인다", () => {
    const msg = psdImportResultMessage({
      elements: [],
      sourceWidth: 1,
      sourceHeight: 1,
      scale: 1,
      skipped: ["a", "b"],
    });
    expect(msg).toBe("PSD 가져오기 완료 — 레이어 0개 · 알림 2건");
  });
});

describe("importPsdFile (readPsd/downscaleDataUrl 을 deps 로 주입 — DOM/실파일 불필요)", () => {
  function depsFor(
    psd: Psd,
    downscaleImpl?: PsdImportDeps["downscaleImpl"],
    rasterizeMaskImpl?: PsdImportDeps["rasterizeMaskImpl"],
  ): PsdImportDeps {
    return {
      readPsdImpl: () => psd,
      downscaleImpl: downscaleImpl ?? (async (dataUrl) => dataUrl),
      rasterizeMaskImpl,
    };
  }

  it("리프 레이어 하나를 위치/크기가 스케일된 이미지 요소로 변환한다", async () => {
    const psd = samplePsd(
      [leaf({ name: "배경", left: 0, top: 0, right: 1440, bottom: 2160 })],
      { width: 1440, height: 2160 }
    );
    const result = await importPsdFile(new File([], "t.psd"), 720, depsFor(psd));

    expect(result.sourceWidth).toBe(1440);
    expect(result.sourceHeight).toBe(2160);
    expect(result.scale).toBe(0.5);
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]).toMatchObject({
      type: "image",
      x: 0,
      y: 0,
      width: 720,
      height: 1080,
      rotation: 0,
      name: "배경",
    });
    expect(result.elements[0].opacity).toBeUndefined();
    expect(result.elements[0].blendMode).toBeUndefined();
    expect(result.elements[0].hidden).toBeUndefined();
    expect(result.skipped).toEqual([]);
  });

  it("조정 레이어는 요소를 만들지 않고 알림만 남긴다", async () => {
    const psd = samplePsd([leaf({ name: "톤보정", adjustment: { type: "invert" } })]);
    const result = await importPsdFile(new File([], "t.psd"), 720, depsFor(psd));
    expect(result.elements).toHaveLength(0);
    expect(result.skipped).toEqual(["톤보정: 조정 레이어라 제외됨"]);
    expect(result.lossManifest?.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        feature: "adjustment-layer",
        disposition: "dropped",
        count: 1,
      }),
    ]));
  });

  it("text/smart object/effects/group losses are aggregated without parsing skipped strings", async () => {
    const psd = samplePsd([
      group([
        leaf({
          name: "복합 레이어",
          text: {} as Layer["text"],
          placedLayer: {} as Layer["placedLayer"],
          effects: {} as Layer["effects"],
        }),
      ], { name: "폴더" }),
    ]);
    const result = await importPsdFile(new File([], "t.psd"), 720, depsFor(psd));
    const byFeature = new Map(
      result.lossManifest?.decisions.map((decision) => [decision.feature, decision]),
    );
    expect(byFeature.get("groups")).toMatchObject({ disposition: "dropped", count: 1 });
    expect(byFeature.get("text")).toMatchObject({ disposition: "rasterized", count: 1 });
    expect(byFeature.get("smart-object")).toMatchObject({ disposition: "rasterized", count: 1 });
    expect(byFeature.get("layer-effects")).toMatchObject({ disposition: "dropped", count: 1 });
  });

  it("불투명도<1·블렌드 모드·(그룹 유래) 숨김을 El 필드로 반영한다", async () => {
    const psd = samplePsd([
      group([leaf({ name: "반투명", opacity: 0.4, blendMode: "multiply" })], { hidden: true }),
    ]);
    const result = await importPsdFile(new File([], "t.psd"), 720, depsFor(psd));
    expect(result.elements[0].opacity).toBeCloseTo(0.4);
    expect(result.elements[0].blendMode).toBe("multiply");
    expect(result.elements[0].hidden).toBe(true);
  });

  it("불투명도 1·기본 블렌드 모드·비숨김은 필드를 아예 생략한다(El 관례)", async () => {
    const psd = samplePsd([leaf({ name: "보통", opacity: 1, blendMode: "normal" })]);
    const result = await importPsdFile(new File([], "t.psd"), 720, depsFor(psd));
    expect(result.elements[0].opacity).toBeUndefined();
    expect(result.elements[0].blendMode).toBeUndefined();
    expect(result.elements[0].hidden).toBeUndefined();
  });

  it("이펙트·스마트오브젝트·텍스트 레이어는 이미지로 가져오되 각각 알림을 남긴다", async () => {
    const psd = samplePsd([
      leaf({ name: "이펙트있음", effects: { dropShadow: [] } }),
      leaf({ name: "스마트오브젝트", placedLayer: { id: "1", type: "raster", transform: [] } }),
      leaf({ name: "텍스트", text: { text: "hi" } }),
    ]);
    const result = await importPsdFile(new File([], "t.psd"), 720, depsFor(psd));
    expect(result.elements).toHaveLength(3);
    expect(result.skipped).toHaveLength(3);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        "이펙트있음: 레이어 스타일(그림자 등)은 반영되지 않아요",
        "스마트오브젝트: 스마트 오브젝트는 편집 가능한 원본이 아니라 미리보기 이미지로 가져왔어요",
        "텍스트: 텍스트 레이어는 편집 가능한 글자가 아니라 이미지로 가져왔어요",
      ])
    );
  });

  it("래스터 마스크를 편집 가능한 maskSrc로 연결하고 layer-local raster 입력을 전달한다", async () => {
    const mask = { top: 230, left: 120, bottom: 270, right: 170 };
    const psd = samplePsd([
      leaf({ name: "마스크", left: 100, top: 200, right: 200, bottom: 300, mask }),
    ]);
    const captured: Parameters<NonNullable<PsdImportDeps["rasterizeMaskImpl"]>>[0][] = [];
    const result = await importPsdFile(
      new File([], "t.psd"),
      720,
      depsFor(psd, undefined, (input) => {
        captured.push(input);
        return { maskSrc: "data:image/png;base64,MASK", warnings: [] };
      }),
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      layerLeft: 100,
      layerTop: 200,
      layerPixelWidth: 100,
      layerPixelHeight: 100,
      masks: [{ kind: "primary", mask }],
    });
    expect(result.elements[0]).toMatchObject({
      src: "data:image/png;base64,AAAA",
      maskSrc: "data:image/png;base64,MASK",
    });
    expect(result.elements[0].maskEnabled).toBeUndefined();
    expect(result.skipped).toEqual([]);
  });

  it("Photoshop에서 꺼진 마스크는 픽셀을 보존하면서 maskEnabled=false로 가져온다", async () => {
    const psd = samplePsd([leaf({ name: "꺼짐", mask: { disabled: true } })]);
    const result = await importPsdFile(
      new File([], "t.psd"),
      720,
      depsFor(psd, undefined, () => ({
        maskSrc: "data:image/png;base64,OFF",
        disabled: true,
        warnings: [],
      })),
    );
    expect(result.elements[0]).toMatchObject({
      maskSrc: "data:image/png;base64,OFF",
      maskEnabled: false,
    });
  });

  it("손상·인코딩 실패 마스크는 레이어 자체를 숨기지 않고 경고만 남긴다", async () => {
    const psd = samplePsd([leaf({ name: "손상", mask: {} })]);
    const result = await importPsdFile(
      new File([], "t.psd"),
      720,
      depsFor(psd, undefined, () => ({
        warnings: ["마스크 픽셀 데이터가 없거나 손상되어 원본 레이어를 가리지 않고 가져왔어요."],
      })),
    );
    expect(result.elements[0].src).toBeTruthy();
    expect(result.elements[0].maskSrc).toBeUndefined();
    expect(result.elements[0].maskEnabled).toBeUndefined();
    expect(result.skipped).toEqual([
      "손상: 마스크 픽셀 데이터가 없거나 손상되어 원본 레이어를 가리지 않고 가져왔어요.",
    ]);
  });

  it("vector-only와 vector raster/dual mask의 편집성 손실을 명시한다", async () => {
    const vectorMask = {} as NonNullable<Layer["vectorMask"]>;
    const psd = samplePsd([
      leaf({ name: "벡터전용", vectorMask }),
      leaf({
        name: "이중",
        vectorMask,
        mask: { fromVectorData: true },
        realMask: {},
      }),
    ]);
    const result = await importPsdFile(
      new File([], "t.psd"),
      720,
      depsFor(psd, undefined, () => ({
        maskSrc: "data:image/png;base64,DUAL",
        warnings: [],
      })),
    );
    expect(result.skipped.join(" ")).toContain("벡터 전용 마스크는 래스터 픽셀이 없어");
    expect(result.skipped.join(" ")).toContain("벡터 마스크를 편집 가능한 단일 래스터 마스크로 근사");
    expect(result.skipped.join(" ")).toContain("픽셀·벡터 이중 마스크");
  });

  it("realMask를 단일 authoritative source로 전달하고 primary는 parameter/fallback으로만 유지한다", async () => {
    const primary = { userMaskDensity: 0.5 };
    const real = { disabled: true };
    const captured: Parameters<NonNullable<PsdImportDeps["rasterizeMaskImpl"]>>[0][] = [];
    const psd = samplePsd([leaf({ name: "이중", mask: primary, realMask: real })]);

    await importPsdFile(
      new File([], "t.psd"),
      720,
      depsFor(psd, undefined, (input) => {
        captured.push(input);
        return { maskSrc: "data:image/png;base64,REAL", disabled: true, warnings: [] };
      }),
    );

    expect(captured[0]).toMatchObject({
      masks: [{ kind: "real", mask: real, parameterMask: primary }],
      fallbackMask: { kind: "primary", mask: primary },
    });
    expect(captured[0].masks).toHaveLength(1);
  });

  it("레이어가 하나도 없으면 안내 메시지를 남긴다", async () => {
    const result = await importPsdFile(new File([], "t.psd"), 720, depsFor(samplePsd([])));
    expect(result.elements).toEqual([]);
    expect(result.skipped).toEqual(["PSD에서 가져올 레이어를 찾지 못했어요."]);
  });

  it("downscaleImpl 에 래스터화된 data URL 과 1280 상한을 그대로 전달한다", async () => {
    const captured: { dataUrl: string; maxW: number }[] = [];
    const psd = samplePsd([leaf({ name: "A" })]);
    const result = await importPsdFile(
      new File([], "t.psd"),
      720,
      depsFor(psd, async (dataUrl, maxW) => {
        captured.push({ dataUrl, maxW });
        return "data:image/webp;base64,DOWNSCALED";
      })
    );
    expect(captured).toEqual([{ dataUrl: "data:image/png;base64,AAAA", maxW: 1280 }]);
    expect(result.elements[0].src).toBe("data:image/webp;base64,DOWNSCALED");
  });

  it("고해상도 source 축소가 원본으로 fallback하면 mask도 원본 폭을 사용해 자연 크기를 맞춘다", async () => {
    const raw = "data:image/png;base64,HIGH";
    const canvas = fakeCanvas(raw, 2_560, 1_600);
    const psd = samplePsd([
      leaf({
        name: "고해상도",
        right: 2_560,
        bottom: 1_600,
        canvas,
        mask: { left: 0, top: 0, right: 1, bottom: 1 },
      }),
    ]);
    let captured: Parameters<NonNullable<PsdImportDeps["rasterizeMaskImpl"]>>[0] | undefined;

    const result = await importPsdFile(
      new File([], "t.psd"),
      720,
      depsFor(psd, async () => raw, (input) => {
        captured = input;
        return { warnings: [] };
      }),
    );

    expect(captured).toMatchObject({
      layerPixelWidth: 2_560,
      layerPixelHeight: 1_600,
      maxWidth: 2_560,
    });
    expect(result.elements[0].src).toBe(raw);
    expect(result.skipped.join(" ")).toContain("원본 PNG를 유지");
  });

  it("고해상도 source가 새 1280px proxy로 변환되면 mask도 1280px 상한을 쓴다", async () => {
    const canvas = fakeCanvas("data:image/png;base64,HIGH", 2_560, 1_600);
    const psd = samplePsd([
      leaf({
        right: 2_560,
        bottom: 1_600,
        canvas,
        mask: { left: 0, top: 0, right: 1, bottom: 1 },
      }),
    ]);
    let captured: Parameters<NonNullable<PsdImportDeps["rasterizeMaskImpl"]>>[0] | undefined;

    await importPsdFile(
      new File([], "t.psd"),
      720,
      depsFor(psd, async () => "data:image/webp;base64,PROXY", (input) => {
        captured = input;
        return { warnings: [] };
      }),
    );

    expect(captured?.maxWidth).toBe(1_280);
  });

  it("downscale throw/empty result는 원본 PNG로 안전하게 fallback하고 경고한다", async () => {
    const psd = samplePsd([leaf({ name: "A" })]);
    const thrown = await importPsdFile(
      new File([], "t.psd"),
      720,
      depsFor(psd, async () => {
        throw new Error("decoder failed");
      }),
    );
    expect(thrown.elements[0].src).toBe("data:image/png;base64,AAAA");
    expect(thrown.skipped.join(" ")).toContain("프록시 변환에 실패");

    const empty = await importPsdFile(
      new File([], "t.psd"),
      720,
      depsFor(psd, async () => "data:,"),
    );
    expect(empty.elements[0].src).toBe("data:image/png;base64,AAAA");
    expect(empty.skipped.join(" ")).toContain("프록시 인코딩이 비어");
  });

  it("Canvas가 빈 PNG data URL을 반환하면 손상 레이어를 생성하지 않는다", async () => {
    const psd = samplePsd([leaf({ name: "빈 레이어", canvas: fakeCanvas("data:,") })]);
    const result = await importPsdFile(new File([], "t.psd"), 720, depsFor(psd));
    expect(result.elements).toEqual([]);
    expect(result.skipped).toEqual(["빈 레이어: 래스터 PNG가 비어 있어 건너뜀"]);
  });

  it("readPsd 파싱이 실패하면 한국어 메시지로 throw 한다", async () => {
    const badDeps: PsdImportDeps = {
      readPsdImpl: () => {
        throw new Error("broken");
      },
    };
    await expect(importPsdFile(new File([], "t.psd"), 720, badDeps)).rejects.toThrow(
      "PSD 파일을 해석하지 못했어요"
    );
  });

  it("does not let a .psb file bypass the explicit unsupported-container boundary", async () => {
    let parsed = false;
    await expect(importPsdFile(new File([], "large.psb"), 720, {
      readPsdImpl: () => {
        parsed = true;
        return samplePsd([]);
      },
    })).rejects.toThrow("PSB(대용량 문서)");
    expect(parsed).toBe(false);
  });

  it("ag-psd를 bounded bitmap decode와 불필요한 payload 생략 옵션으로 호출한다", async () => {
    const calls: unknown[] = [];
    await importPsdFile(new File([], "t.psd"), 720, {
      readPsdImpl: (_buffer, options) => {
        calls.push(options);
        return samplePsd([]);
      },
    });
    expect(calls).toEqual([{
      skipCompositeImageData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
      totalMemoryLimit: PSD_IMPORT_MAX_DECODED_BYTES,
    }]);
  });

  it("declared/actual source bytes가 PSD browser file budget을 넘으면 parsing 전에 거부한다", async () => {
    let reads = 0;
    const oversized = {
      size: PSD_IMPORT_MAX_FILE_BYTES + 1,
      arrayBuffer: async () => {
        reads += 1;
        return new ArrayBuffer(0);
      },
    } as unknown as File;
    await expect(importPsdFile(oversized, 720)).rejects.toThrow("최대 128MB");
    expect(reads).toBe(0);

    const mismatched = {
      size: 0,
      arrayBuffer: async () => ({ byteLength: PSD_IMPORT_MAX_FILE_BYTES + 1 }) as ArrayBuffer,
    } as unknown as File;
    await expect(importPsdFile(mismatched, 720)).rejects.toThrow("최대 128MB");
  });

  it("file.arrayBuffer 자체가 실패해도 한국어 메시지로 throw 한다", async () => {
    const brokenFile = { arrayBuffer: () => Promise.reject(new Error("disk error")) } as unknown as File;
    await expect(importPsdFile(brokenFile, 720, { readPsdImpl: () => samplePsd([]) })).rejects.toThrow(
      "PSD 파일을 읽지 못했어요"
    );
  });
});
