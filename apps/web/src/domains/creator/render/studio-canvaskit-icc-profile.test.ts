import { describe, it, expect } from "vitest";

import {
  SRGB_ICC_BUILD_OPTIONS,
  STUDIO_ICC_RENDERING_INTENT_LABELS,
  buildMatrixTrcIccProfile,
  describeIccProfile,
  evaluateIccCurve,
  iccRgbToXyz,
  parseIccProfile,
} from "./studio-canvaskit-icc-profile";

/** 성공 파싱을 강제하고 프로파일을 꺼낸다(실패하면 사유를 그대로 보여준다). */
function parseOk(bytes: Uint8Array) {
  const result = parseIccProfile(bytes);
  if (!result.ok) throw new Error(`예상과 달리 파싱 실패: ${result.error}`);
  return result.profile;
}

function parseErr(bytes: Uint8Array): string {
  const result = parseIccProfile(bytes);
  if (result.ok) throw new Error("손상 입력인데 파싱이 성공했다");
  return result.error;
}

/** 임의 태그 목록으로 ICC 바이트를 조립하는 테스트 픽스처 빌더(헤더 128 + 태그 테이블). */
function buildProfile(
  tags: { signature: string; data: Uint8Array }[],
  overrides: { colorSpace?: string; deviceClass?: string; intent?: number } = {},
): Uint8Array {
  const tableSize = 4 + tags.length * 12;
  let cursor = 128 + tableSize;
  const placed = tags.map((tag) => {
    const offset = cursor;
    cursor += (tag.data.byteLength + 3) & ~3;
    return { ...tag, offset };
  });
  const out = new Uint8Array(cursor);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };
  view.setUint32(0, cursor);
  view.setUint32(8, 0x02400000);
  ascii(12, overrides.deviceClass ?? "prtr");
  ascii(16, overrides.colorSpace ?? "CMYK");
  ascii(20, "Lab ");
  ascii(36, "acsp");
  view.setUint32(64, overrides.intent ?? 0);
  view.setUint32(128, placed.length);
  placed.forEach((tag, index) => {
    const base = 132 + index * 12;
    ascii(base, tag.signature);
    view.setUint32(base + 4, tag.offset);
    view.setUint32(base + 8, tag.data.byteLength);
    out.set(tag.data, tag.offset);
  });
  return out;
}

function typedTag(type: string, extra: number[] = []): Uint8Array {
  const out = new Uint8Array(8 + extra.length);
  for (let i = 0; i < 4; i++) out[i] = type.charCodeAt(i);
  out.set(extra, 8);
  return out;
}

describe("합성 프로파일 왕복", () => {
  const bytes = buildMatrixTrcIccProfile();

  it("빌더가 만든 sRGB 프로파일을 파서가 그대로 되읽는다", () => {
    const profile = parseOk(bytes);
    expect(profile.header.signature).toBe("acsp");
    expect(profile.header.version).toBe("2.4.0");
    expect(profile.header.deviceClass).toBe("mntr");
    expect(profile.header.dataColorSpace).toBe("RGB ");
    expect(profile.header.pcs).toBe("XYZ ");
    expect(profile.header.profileSize).toBe(bytes.byteLength);
    expect(profile.kind).toBe("matrix-trc-rgb");
    expect(profile.unsupportedReason).toBeNull();
  });

  it("렌더링 인텐트를 읽는다", () => {
    expect(parseOk(bytes).header.renderingIntent).toBe("media-relative");
    for (const [index, intent] of (["perceptual", "media-relative", "saturation", "icc-absolute"] as const).entries()) {
      const variant = buildMatrixTrcIccProfile({ ...SRGB_ICC_BUILD_OPTIONS, renderingIntent: intent });
      expect(parseOk(variant).header.renderingIntent).toBe(intent);
      expect(new DataView(variant.buffer).getUint32(64)).toBe(index);
    }
  });

  it("설명·저작권 문자열을 읽는다", () => {
    const profile = parseOk(bytes);
    expect(profile.description).toBe("ToonSpectrum sRGB");
    expect(profile.copyright).toContain("IEC 61966-2-1");
    expect(describeIccProfile(profile)).toBe(
      `ToonSpectrum sRGB · RGB · ICC 2.4.0 · 렌더링 인텐트 ${STUDIO_ICC_RENDERING_INTENT_LABELS["media-relative"]}`,
    );
  });

  it("매트릭스와 TRC가 빌드 옵션과 일치한다(s15Fixed16 양자화 오차 안에서)", () => {
    const profile = parseOk(bytes);
    const trc = profile.matrixTrc;
    expect(trc).not.toBeNull();
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        expect(trc!.matrix[row]![col]).toBeCloseTo(SRGB_ICC_BUILD_OPTIONS.matrix[row]![col]!, 4);
      }
    }
    // 2.2 * 256 = 563.2 → u8Fixed8 로 563 → 563/256 = 2.19921875 (양자화 손실이 계약이다).
    expect(trc!.redTrc).toEqual({ kind: "gamma", gamma: 2.19921875 });
    expect(trc!.whitePoint.y).toBeCloseTo(1, 4);
  });

  it("태그 목록에 필수 태그가 모두 있고 오프셋이 헤더 뒤에 있다", () => {
    const profile = parseOk(bytes);
    const signatures = profile.tags.map((tag) => tag.signature);
    for (const required of ["desc", "cprt", "wtpt", "rXYZ", "gXYZ", "bXYZ", "rTRC", "gTRC", "bTRC"]) {
      expect(signatures).toContain(required);
    }
    for (const tag of profile.tags) {
      expect(tag.offset).toBeGreaterThanOrEqual(128);
      expect(tag.offset + tag.size).toBeLessThanOrEqual(bytes.byteLength);
    }
  });

  it("빌더는 결정적이다(같은 옵션 → 같은 바이트)", () => {
    expect(Array.from(buildMatrixTrcIccProfile())).toEqual(Array.from(buildMatrixTrcIccProfile()));
  });

  it("날짜 필드를 비워 둔다(결정성 계약)", () => {
    for (let offset = 24; offset < 36; offset++) expect(bytes[offset]).toBe(0);
  });

  it("RGB→XYZ 변환이 흰색을 D50 백색점으로 보낸다", () => {
    const profile = parseOk(bytes);
    const white = iccRgbToXyz(profile, { r: 1, g: 1, b: 1 });
    expect(white).not.toBeNull();
    expect(white!.x).toBeCloseTo(0.9642, 3);
    expect(white!.y).toBeCloseTo(1, 3);
    expect(white!.z).toBeCloseTo(0.8252, 3);
    expect(iccRgbToXyz(profile, { r: 0, g: 0, b: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("손상·악의적 입력", () => {
  const good = buildMatrixTrcIccProfile();

  it("128바이트 미만은 거절한다", () => {
    expect(parseErr(new Uint8Array(64))).toContain("너무 짧아요");
  });

  it("'acsp' 서명이 없으면 거절한다", () => {
    const bad = good.slice();
    bad[36] = 0x41;
    expect(parseErr(bad)).toContain("acsp");
  });

  it("헤더의 크기가 실제 바이트 수와 다르면 거절한다(잘림·덧붙임 탐지)", () => {
    const truncated = good.slice(0, good.byteLength - 8);
    expect(parseErr(truncated)).toContain("크기가 맞지 않아요");
    const appended = new Uint8Array(good.byteLength + 4);
    appended.set(good);
    expect(parseErr(appended)).toContain("크기가 맞지 않아요");
  });

  it("태그 개수를 부풀리면 거절한다(대용량 할당 유도 방어)", () => {
    const bad = good.slice();
    new DataView(bad.buffer).setUint32(128, 0xffff);
    expect(parseErr(bad)).toContain("태그 개수");
  });

  it("태그 오프셋이 파일 끝을 넘으면 거절한다", () => {
    const bad = good.slice();
    new DataView(bad.buffer).setUint32(132 + 4, good.byteLength - 2);
    expect(parseErr(bad)).toContain("파일 끝을 넘어갑니다");
  });

  it("태그 오프셋이 헤더 영역을 침범하면 거절한다", () => {
    const bad = good.slice();
    new DataView(bad.buffer).setUint32(132 + 4, 8);
    expect(parseErr(bad)).toContain("헤더 영역을 침범");
  });

  it("곡선 포인트 수가 태그 크기를 넘으면 거절한다", () => {
    const curve = typedTag("curv", [0x00, 0x00, 0xff, 0xff, 0x00, 0x00]);
    const bad = buildProfile(
      [
        { signature: "rXYZ", data: typedTag("XYZ ", [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]) },
        { signature: "gXYZ", data: typedTag("XYZ ", [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]) },
        { signature: "bXYZ", data: typedTag("XYZ ", [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]) },
        { signature: "rTRC", data: curve },
      ],
      { colorSpace: "RGB " },
    );
    expect(parseErr(bad)).toContain("포인트 수");
  });

  it("알 수 없는 파라메트릭 곡선 타입은 거절한다", () => {
    const para = typedTag("para", [0x00, 0x63, 0x00, 0x00]);
    const bad = buildProfile(
      [
        { signature: "rXYZ", data: typedTag("XYZ ", [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]) },
        { signature: "gXYZ", data: typedTag("XYZ ", [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]) },
        { signature: "bXYZ", data: typedTag("XYZ ", [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]) },
        { signature: "rTRC", data: para },
      ],
      { colorSpace: "RGB " },
    );
    expect(parseErr(bad)).toContain("파라메트릭");
  });

  it("XYZ 태그 자리에 다른 타입이 오면 거절한다", () => {
    const bad = buildProfile(
      [
        { signature: "rXYZ", data: typedTag("curv", new Array<number>(12).fill(0)) },
        { signature: "gXYZ", data: typedTag("XYZ ", [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]) },
        { signature: "bXYZ", data: typedTag("XYZ ", [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]) },
      ],
      { colorSpace: "RGB " },
    );
    expect(parseErr(bad)).toContain("타입이 XYZ가 아니");
  });

  it("완전히 무관한 바이트도 예외 없이 사유를 돌려준다", () => {
    const random = new Uint8Array(512);
    for (let i = 0; i < random.length; i++) random[i] = (i * 37) & 0xff;
    const result = parseIccProfile(random);
    expect(result.ok).toBe(false);
  });
});

describe("지원 범위 판정 — 정직한 미지원 보고", () => {
  it("LUT 기반 CMYK 프로파일은 헤더만 읽고 변환은 미지원으로 보고한다", () => {
    const profile = parseOk(
      buildProfile([{ signature: "A2B0", data: typedTag("mft2", new Array<number>(24).fill(0)) }], {
        colorSpace: "CMYK",
        deviceClass: "prtr",
        intent: 1,
      }),
    );
    expect(profile.kind).toBe("lut-based");
    expect(profile.matrixTrc).toBeNull();
    expect(profile.unsupportedReason).toContain("색 변환을 실행할 수 없어요");
    // 헤더는 정상적으로 읽혀야 한다 — 인쇄소 프로파일 확인이 이 경로의 목적이다.
    expect(profile.header.dataColorSpace).toBe("CMYK");
    expect(profile.header.deviceClass).toBe("prtr");
    expect(profile.header.renderingIntent).toBe("media-relative");
  });

  it("mAB 타입(ICC v4 LUT)도 LUT 기반으로 분류한다", () => {
    const profile = parseOk(
      buildProfile([{ signature: "A2B1", data: typedTag("mAB ", new Array<number>(24).fill(0)) }]),
    );
    expect(profile.kind).toBe("lut-based");
  });

  it("회색조 프로파일은 별도로 분류한다", () => {
    const profile = parseOk(
      buildProfile([{ signature: "kTRC", data: typedTag("curv", [0, 0, 0, 0]) }], { colorSpace: "GRAY" }),
    );
    expect(profile.kind).toBe("gray-trc");
    expect(profile.unsupportedReason).toContain("회색조");
  });

  it("변환 태그가 아예 없으면 unsupported로 분류한다", () => {
    const profile = parseOk(buildProfile([{ signature: "cprt", data: typedTag("text", [0x68, 0x69, 0x00]) }]));
    expect(profile.kind).toBe("unsupported");
    expect(profile.copyright).toBe("hi");
    expect(iccRgbToXyz(profile, { r: 1, g: 1, b: 1 })).toBeNull();
  });
});

describe("TRC 곡선 평가", () => {
  it("identity는 입력을 그대로 돌려주고 0..1로 클램프한다", () => {
    expect(evaluateIccCurve({ kind: "identity" }, 0.3)).toBe(0.3);
    expect(evaluateIccCurve({ kind: "identity" }, -1)).toBe(0);
    expect(evaluateIccCurve({ kind: "identity" }, 5)).toBe(1);
  });

  it("gamma는 지수를 적용한다", () => {
    expect(evaluateIccCurve({ kind: "gamma", gamma: 2 }, 0.5)).toBeCloseTo(0.25, 12);
    expect(evaluateIccCurve({ kind: "gamma", gamma: 2.2 }, 1)).toBe(1);
  });

  it("table은 균등 샘플을 선형 보간한다", () => {
    const curve = { kind: "table" as const, table: [0, 0.25, 1] };
    expect(evaluateIccCurve(curve, 0)).toBe(0);
    expect(evaluateIccCurve(curve, 0.5)).toBeCloseTo(0.25, 12);
    expect(evaluateIccCurve(curve, 0.25)).toBeCloseTo(0.125, 12);
    expect(evaluateIccCurve(curve, 1)).toBe(1);
  });

  it("parametric 타입 3(sRGB 조각별 곡선)은 분기점에서 이어진다", () => {
    // sRGB 전달함수: g=2.4, a=1/1.055, b=0.055/1.055, c=1/12.92, d=0.04045
    const curve = {
      kind: "parametric" as const,
      functionType: 3,
      params: [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045],
    };
    expect(evaluateIccCurve(curve, 0)).toBe(0);
    expect(evaluateIccCurve(curve, 1)).toBeCloseTo(1, 9);
    const below = evaluateIccCurve(curve, 0.0404);
    const above = evaluateIccCurve(curve, 0.0405);
    expect(Math.abs(above - below)).toBeLessThan(0.001);
  });

  it("빈 table은 항등으로 떨어진다(방어)", () => {
    expect(evaluateIccCurve({ kind: "table", table: [] }, 0.42)).toBe(0.42);
    expect(evaluateIccCurve({ kind: "table", table: [0.7] }, 0.42)).toBe(0.7);
  });
});
