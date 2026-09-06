import { describe, expect, it } from "vitest";

import {
  STUDIO_PALETTE_INTERCHANGE_LIMITS,
  STUDIO_ACT_EXTENDED_BYTES,
  STUDIO_ACT_TABLE_BYTES,
  STUDIO_INDEXED_PALETTE_MAX_COLORS,
  StudioPaletteInterchangeError,
  exportAdobeAcoPalette,
  exportAdobeActPalette,
  exportAdobeAsePalette,
  exportCssVariablePalette,
  exportGplPalette,
  exportJsonPalette,
  exportJascPalPalette,
  exportStudioPalette,
  importAdobeAcoPalette,
  importAdobeActPalette,
  importAdobeAsePalette,
  importCssVariablePalette,
  importGplPalette,
  importJsonPalette,
  importJascPalPalette,
  importStudioPalette,
  type StudioPaletteInterchangeDocument,
} from "./studio-palette-interchange";

const palette: StudioPaletteInterchangeDocument = {
  name: "웹툰 주인공",
  colors: [
    { hex: "#ff0000", name: "Red" },
    { hex: "#00ff00", name: "Green" },
    { hex: "#0000ff", name: "Blue" },
  ],
};

function errorCode(action: () => unknown): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return error instanceof StudioPaletteInterchangeError ? error.code : undefined;
  }
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function aseWithSingleColor(model: string, components: readonly number[]): Uint8Array {
  const name = "Test";
  const bodyLength = 2 + (name.length + 1) * 2 + 4 + components.length * 4 + 2;
  const output = new Uint8Array(12 + 6 + bodyLength);
  const view = new DataView(output.buffer);
  output.set(new TextEncoder().encode("ASEF"), 0);
  view.setUint16(4, 1, false);
  view.setUint16(6, 0, false);
  view.setUint32(8, 1, false);
  view.setUint16(12, 1, false);
  view.setUint32(14, bodyLength, false);
  view.setUint16(18, name.length + 1, false);
  let offset = 20;
  for (const character of name) {
    view.setUint16(offset, character.charCodeAt(0), false);
    offset += 2;
  }
  view.setUint16(offset, 0, false);
  offset += 2;
  output.set(new TextEncoder().encode(model), offset);
  offset += 4;
  for (const component of components) {
    view.setFloat32(offset, component, false);
    offset += 4;
  }
  view.setUint16(offset, 0, false);
  return output;
}

describe("Adobe ASE interchange", () => {
  it("RGB 스와치 이름과 순서를 바이너리로 왕복한다", () => {
    const exported = exportAdobeAsePalette(palette);
    const imported = importAdobeAsePalette(exported.data);
    expect(imported.palette.name).toBe(palette.name);
    expect(imported.palette.colors).toEqual(palette.colors);
    expect(exported.exportedColors).toBe(3);
    expect(imported.warnings).toEqual([]);
  });

  it.each([
    ["Gray", [0.5], "#808080"],
    ["CMYK", [0, 1, 1, 0], "#ff0000"],
    ["LAB ", [100, 0, 0], "#ffffff"],
  ] as const)("%s 색공간을 sRGB로 변환하고 손실 경고를 낸다", (model, components, expected) => {
    const imported = importAdobeAsePalette(aseWithSingleColor(model, components));
    expect(imported.palette.colors[0]?.hex).toBe(expected);
    expect(imported.warnings.map((item) => item.code)).toContain("non-rgb-converted");
  });

  it("알 수 없는 색공간은 건너뛰며 유효 색이 없으면 실패한다", () => {
    expect(errorCode(() => importAdobeAsePalette(aseWithSingleColor("XYZ ", [1, 1, 1])))).toBe("no-colors");
  });

  it("잘린 헤더·블록 길이 위조·뒤쪽 쓰레기 바이트를 거부한다", () => {
    expect(errorCode(() => importAdobeAsePalette(bytes(65, 83, 69)))).toBe("invalid");
    const valid = exportAdobeAsePalette(palette).data;
    const forged = valid.slice();
    new DataView(forged.buffer).setUint32(14, 0xffff_ffff, false);
    expect(errorCode(() => importAdobeAsePalette(forged))).toBe("invalid");
    const trailing = new Uint8Array(valid.length + 1);
    trailing.set(valid);
    expect(errorCode(() => importAdobeAsePalette(trailing))).toBe("invalid");
  });

  it("지원하지 않는 major version을 구분한다", () => {
    const valid = exportAdobeAsePalette(palette).data.slice();
    new DataView(valid.buffer).setUint16(4, 2, false);
    expect(errorCode(() => importAdobeAsePalette(valid))).toBe("unsupported-version");
  });
});

describe("Adobe ACO interchange", () => {
  it("v1+v2를 쓰고 v2 색 이름을 포함해 왕복한다", () => {
    const exported = exportAdobeAcoPalette(palette);
    const imported = importAdobeAcoPalette(exported.data);
    expect(imported.palette.colors).toEqual(palette.colors);
    expect(new DataView(exported.data.buffer).getUint16(0, false)).toBe(1);
  });

  it("v1 단독 RGB 팔레트를 읽는다", () => {
    const encoded = exportAdobeAcoPalette(palette).data;
    const v1Bytes = 4 + palette.colors.length * 10;
    const imported = importAdobeAcoPalette(encoded.slice(0, v1Bytes));
    expect(imported.palette.colors.map((color) => color.hex)).toEqual(palette.colors.map((color) => color.hex));
    expect(imported.palette.colors[0]?.name).toBe("색상 1");
  });

  it("HSB/CMYK/Lab/Gray를 sRGB로 변환한다", () => {
    const record = (space: number, values: readonly number[]): number[] => [
      space >> 8, space & 255,
      ...values.flatMap((value) => [value >> 8, value & 255]),
    ];
    const input = bytes(
      0, 1, 0, 4,
      ...record(1, [0, 65535, 65535, 0]),
      ...record(2, [65535, 0, 0, 65535]),
      ...record(7, [10000, 0, 0, 0]),
      ...record(8, [5000, 0, 0, 0])
    );
    const result = importAdobeAcoPalette(input);
    expect(result.palette.colors.map((color) => color.hex)).toEqual(["#ff0000", "#ff0000", "#ffffff", "#808080"]);
    expect(result.warnings.map((item) => item.code)).toContain("non-rgb-converted");
  });

  it("잘린 레코드, 잘못된 v1/v2 순서, 이름 길이 위조를 거부한다", () => {
    expect(errorCode(() => importAdobeAcoPalette(bytes(0, 1, 0, 1, 0)))).toBe("invalid");
    const exported = exportAdobeAcoPalette(palette).data;
    const v1Length = 4 + palette.colors.length * 10;
    const wrongOrder = exported.slice();
    new DataView(wrongOrder.buffer).setUint16(v1Length, 1, false);
    expect(errorCode(() => importAdobeAcoPalette(wrongOrder))).toBe("invalid");
    const nameForged = exported.slice();
    new DataView(nameForged.buffer).setUint32(v1Length + 4 + 10, 0xffff_ffff, false);
    expect(errorCode(() => importAdobeAcoPalette(nameForged))).toBe("invalid");
  });
});

describe("Adobe ACT interchange", () => {
  it("772-byte count metadata를 쓰고 RGB 순서를 왕복한다", () => {
    const exported = exportAdobeActPalette(palette);
    const view = new DataView(exported.data.buffer, exported.data.byteOffset, exported.data.byteLength);
    expect(exported.data).toHaveLength(STUDIO_ACT_EXTENDED_BYTES);
    expect(view.getUint16(STUDIO_ACT_TABLE_BYTES, false)).toBe(3);
    expect(view.getUint16(STUDIO_ACT_TABLE_BYTES + 2, false)).toBe(0xffff);
    expect(importAdobeActPalette(exported.data).palette.colors.map((color) => color.hex)).toEqual([
      "#ff0000",
      "#00ff00",
      "#0000ff",
    ]);
    expect(exported.warnings.map((item) => item.code)).toContain("names-discarded");
  });

  it("legacy 768-byte 테이블과 extended count 0을 각각 256색으로 읽는다", () => {
    const legacy = new Uint8Array(STUDIO_ACT_TABLE_BYTES);
    legacy.set([1, 2, 3], 0);
    legacy.set([253, 254, 255], STUDIO_ACT_TABLE_BYTES - 3);
    const legacyResult = importAdobeActPalette(legacy);
    expect(legacyResult.palette.colors).toHaveLength(STUDIO_INDEXED_PALETTE_MAX_COLORS);
    expect(legacyResult.palette.colors[0]?.hex).toBe("#010203");
    expect(legacyResult.palette.colors.at(-1)?.hex).toBe("#fdfeff");

    const extended = new Uint8Array(STUDIO_ACT_EXTENDED_BYTES);
    const view = new DataView(extended.buffer);
    view.setUint16(STUDIO_ACT_TABLE_BYTES, 0, false);
    view.setUint16(STUDIO_ACT_TABLE_BYTES + 2, 0xffff, false);
    expect(importAdobeActPalette(extended).palette.colors).toHaveLength(STUDIO_INDEXED_PALETTE_MAX_COLORS);
  });

  it("투명 인덱스를 명시적으로 경고하고 색 수 밖 인덱스는 거부한다", () => {
    const act = exportAdobeActPalette(palette).data.slice();
    const view = new DataView(act.buffer, act.byteOffset, act.byteLength);
    view.setUint16(STUDIO_ACT_TABLE_BYTES + 2, 1, false);
    expect(importAdobeActPalette(act).warnings.map((item) => item.code)).toContain("alpha-discarded");
    view.setUint16(STUDIO_ACT_TABLE_BYTES + 2, 3, false);
    expect(errorCode(() => importAdobeActPalette(act))).toBe("invalid");
  });

  it("정확한 768/772-byte 길이와 256색 count 경계를 fail-closed 처리한다", () => {
    for (const length of [767, 769, 770, 771, 773]) {
      expect(errorCode(() => importAdobeActPalette(new Uint8Array(length)))).toBe("invalid");
    }
    const act = new Uint8Array(STUDIO_ACT_EXTENDED_BYTES);
    const view = new DataView(act.buffer);
    view.setUint16(STUDIO_ACT_TABLE_BYTES, 257, false);
    view.setUint16(STUDIO_ACT_TABLE_BYTES + 2, 0xffff, false);
    expect(errorCode(() => importAdobeActPalette(act))).toBe("invalid");
  });

  it("내보내기에서 256색만 보존하고 알파·광색역·잘림을 모두 보고한다", () => {
    const colors = Array.from({ length: 257 }, (_, index) => ({
      hex: `#${index.toString(16).padStart(6, "0")}`,
      ...(index === 0 ? { alpha: 0.5, colorSpace: "display-p3" as const } : {}),
    }));
    const exported = exportAdobeActPalette({ name: "Indexed", colors });
    expect(exported.exportedColors).toBe(256);
    expect(exported.truncated).toBe(true);
    expect(exported.warnings.map((item) => item.code)).toEqual(expect.arrayContaining([
      "alpha-discarded",
      "wide-gamut-clipped",
      "truncated",
    ]));
  });
});

describe("JASC-PAL interchange", () => {
  it("magic/version/count와 CRLF 레코드를 정확히 쓰고 왕복한다", () => {
    const exported = exportJascPalPalette(palette);
    expect(exported.data).toBe("JASC-PAL\r\n0100\r\n3\r\n255 0 0\r\n0 255 0\r\n0 0 255\r\n");
    expect(importJascPalPalette(exported.data).palette.colors.map((color) => color.hex)).toEqual([
      "#ff0000",
      "#00ff00",
      "#0000ff",
    ]);
    expect(exported.warnings.map((item) => item.code)).toContain("names-discarded");
  });

  it("LF 입력도 읽되 magic/version/count/채널/여분 레코드는 엄격히 검증한다", () => {
    expect(importJascPalPalette("JASC-PAL\n0100\n2\n1 2 3\n255 254 253\n").palette.colors).toHaveLength(2);
    expect(errorCode(() => importJascPalPalette("NOT-PAL\n0100\n1\n0 0 0\n"))).toBe("invalid");
    expect(errorCode(() => importJascPalPalette("JASC-PAL\n0200\n1\n0 0 0\n"))).toBe("unsupported-version");
    expect(errorCode(() => importJascPalPalette("JASC-PAL\n0100\n0\n"))).toBe("invalid");
    expect(errorCode(() => importJascPalPalette("JASC-PAL\n0100\n257\n"))).toBe("invalid");
    expect(errorCode(() => importJascPalPalette("JASC-PAL\n0100\n2\n0 0 0\n"))).toBe("invalid");
    expect(errorCode(() => importJascPalPalette("JASC-PAL\n0100\n1\n256 0 0\n"))).toBe("invalid");
    expect(errorCode(() => importJascPalPalette("JASC-PAL\n0100\n1\n0 0 0\n\n"))).toBe("invalid");
  });

  it("256색 한도를 적용하고 이름·알파·광색역 손실을 보고한다", () => {
    const colors = Array.from({ length: 257 }, (_, index) => ({
      hex: `#${index.toString(16).padStart(6, "0")}`,
      name: `Color ${index}`,
      ...(index === 0 ? { alpha: 0.5, colorSpace: "display-p3" as const } : {}),
    }));
    const exported = exportJascPalPalette({ name: "Indexed", colors });
    expect(exported.exportedColors).toBe(256);
    expect(exported.truncated).toBe(true);
    expect(exported.warnings.map((item) => item.code)).toEqual(expect.arrayContaining([
      "names-discarded",
      "alpha-discarded",
      "wide-gamut-clipped",
      "truncated",
    ]));
    expect(importJascPalPalette(exported.data).palette.colors).toHaveLength(256);
  });
});

describe("text palette interchange", () => {
  it("GPL codec을 기존 검증 parser/writer에 위임해 왕복한다", () => {
    const exported = exportGplPalette(palette);
    expect(exported.data.startsWith("GIMP Palette\n")).toBe(true);
    const imported = importGplPalette(exported.data);
    expect(imported.palette.name).toBe(palette.name);
    expect(imported.palette.colors.map((color) => color.hex)).toEqual(palette.colors.map((color) => color.hex));
  });

  it("GPL의 깨진 UTF-8과 잘못된 magic을 fail-closed 처리한다", () => {
    expect(errorCode(() => importGplPalette(bytes(0xff, 0xfe, 0xfd)))).toBe("invalid");
    expect(errorCode(() => importGplPalette("Not GPL\n255 0 0"))).toBe("invalid");
  });

  it("CSS custom properties의 hex/rgb/alpha를 읽고 알파 손실을 경고한다", () => {
    const input = `:root {
      --brand-red: #f00;
      --brand-green: rgb(0 255 0 / 50%);
      --강조색: #0000ff;
      --bad: linear-gradient(red, blue);
    }`;
    const imported = importCssVariablePalette(input);
    expect(imported.palette.colors).toEqual([
      { hex: "#ff0000", name: "brand red" },
      { hex: "#00ff00", name: "brand green" },
      { hex: "#0000ff", name: "강조색" },
    ]);
    expect(imported.skippedColors).toBe(1);
    expect(imported.warnings.map((item) => item.code)).toEqual(expect.arrayContaining(["alpha-discarded", "color-skipped"]));
  });

  it("CSS export에서 안전하고 중복 없는 변수명을 만든다", () => {
    const exported = exportCssVariablePalette({
      name: "브랜드",
      colors: [{ hex: "#abcdef", name: "Primary" }, { hex: "#123456", name: "Primary" }],
    });
    expect(exported.data).toContain("--primary: #abcdef;");
    expect(exported.data).toContain("--primary-2: #123456;");
    expect(importCssVariablePalette(exported.data).palette.colors.map((color) => color.hex)).toEqual(["#abcdef", "#123456"]);
  });

  it("canonical JSON을 왕복하고 알파/광색역 손실을 경고한다", () => {
    const encoded = JSON.stringify({
      schema: "toonspectrum.palette",
      version: 1,
      name: "P3",
      colors: [{ hex: "#ff000080", name: "Glass", alpha: 0.5, colorSpace: "display-p3" }],
    });
    const imported = importJsonPalette(encoded);
    expect(imported.palette.colors).toEqual([{ hex: "#ff0000", name: "Glass" }]);
    expect(imported.warnings.map((item) => item.code)).toEqual(expect.arrayContaining(["alpha-discarded", "wide-gamut-clipped"]));
    const roundTrip = importJsonPalette(exportJsonPalette(imported.palette).data);
    expect(roundTrip.palette).toEqual(imported.palette);
  });

  it("JSON의 잘못된 schema/version/색 배열을 거부한다", () => {
    expect(errorCode(() => importJsonPalette("{}"))).toBe("invalid");
    expect(errorCode(() => importJsonPalette('{"schema":"toonspectrum.palette","version":2,"colors":[]}'))).toBe("invalid");
    expect(errorCode(() => importJsonPalette('{"schema":"toonspectrum.palette","version":1,"colors":[]}'))).toBe("no-colors");
    expect(errorCode(() => importJsonPalette('{"schema":"toonspectrum.palette","version":1,"colors":[{"hex":"#fff","alpha":2}]}'))).toBe("no-colors");
  });

  it("공통 dispatcher가 binary/text codec을 올바르게 선택한다", () => {
    const ase = exportStudioPalette("ase", palette).data;
    expect(ase).toBeInstanceOf(Uint8Array);
    expect(importStudioPalette("ase", ase).palette.colors).toHaveLength(3);
    const json = exportStudioPalette("json", palette).data;
    expect(typeof json).toBe("string");
    expect(importStudioPalette("json", json).palette.name).toBe(palette.name);
    const act = exportStudioPalette("act", palette).data;
    expect(act).toBeInstanceOf(Uint8Array);
    expect(importStudioPalette("act", act).palette.colors).toHaveLength(3);
    const pal = exportStudioPalette("pal", palette).data;
    expect(typeof pal).toBe("string");
    expect(importStudioPalette("pal", pal).palette.colors).toHaveLength(3);
    expect(errorCode(() => importStudioPalette("ase", "not binary"))).toBe("invalid");
    expect(errorCode(() => importStudioPalette("act", "not binary"))).toBe("invalid");
  });
});

describe("budgets and explicit loss reporting", () => {
  it("빈 입력과 4MB 초과 입력을 구분해 거부한다", () => {
    expect(errorCode(() => importGplPalette(""))).toBe("empty");
    expect(errorCode(() => importGplPalette(new Uint8Array(STUDIO_PALETTE_INTERCHANGE_LIMITS.maxBytes + 1)))).toBe("size");
  });

  it("최대 색 수를 넘으면 앞쪽 색을 보존하고 truncated를 알린다", () => {
    const colors = Array.from({ length: STUDIO_PALETTE_INTERCHANGE_LIMITS.maxColors + 2 }, (_, index) => ({
      hex: `#${(index % 0xffffff).toString(16).padStart(6, "0")}`,
      name: `Color ${index}`,
    }));
    const exported = exportAdobeAsePalette({ name: "Huge", colors });
    expect(exported.exportedColors).toBe(STUDIO_PALETTE_INTERCHANGE_LIMITS.maxColors);
    expect(exported.truncated).toBe(true);
    expect(exported.warnings.map((item) => item.code)).toContain("truncated");
  });

  it("알파·광색역·잘못된 색을 조용히 숨기지 않는다", () => {
    const exported = exportAdobeAcoPalette({
      name: "Loss",
      colors: [
        { hex: "#33669980", alpha: 0.5 },
        { hex: "#ff00ff", colorSpace: "display-p3" },
        { hex: "not-a-color" },
      ],
    });
    expect(exported.exportedColors).toBe(2);
    expect(exported.skippedColors).toBe(1);
    expect(exported.warnings.map((item) => item.code)).toEqual(expect.arrayContaining([
      "alpha-discarded",
      "wide-gamut-clipped",
      "color-skipped",
    ]));
  });
});
