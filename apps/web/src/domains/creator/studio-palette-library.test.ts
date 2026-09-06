import { describe, it, expect } from "vitest";

import {
  createPalette,
  deletePalette,
  importPaletteFromGpl,
  listPalettes,
  MAX_COLORS_PER_PALETTE,
  MAX_PALETTES,
  paletteFileName,
  parseGplPalette,
  PALETTE_LIBRARY_KEY,
  renamePalette,
  savePalette,
  writeGplPalette,
  type StudioNamedPalette,
} from "./studio-palette-library";

// 인메모리 가짜 저장소
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    _map: map,
  };
}

const palette = (id: string, createdAt = 1): StudioNamedPalette => ({
  id,
  name: `팔레트 ${id}`,
  createdAt,
  updatedAt: createdAt,
  colors: ["#ff0000", "#00ff00"],
});

describe("parseGplPalette", () => {
  it("빈 문자열이면 던진다", () => {
    expect(() => parseGplPalette("")).toThrow();
    expect(() => parseGplPalette("   ")).toThrow();
  });

  it("매직 헤더가 없거나 틀리면 던진다", () => {
    expect(() => parseGplPalette("Not A Palette\n255 0 0")).toThrow();
    expect(() => parseGplPalette("255 0 0\n0 255 0")).toThrow();
  });

  it("Name:/Columns: 헤더를 대소문자 구분 없이 파싱한다", () => {
    const result = parseGplPalette("GIMP Palette\nname: 내 팔레트\nCOLUMNS: 4\n255 0 0\n");
    expect(result.name).toBe("내 팔레트");
    expect(result.columns).toBe(4);
  });

  it("#으로 시작하는 주석과 빈 줄은 무시한다", () => {
    const result = parseGplPalette("GIMP Palette\n#\n# comment\n\n255 0 0\n");
    expect(result.colors).toEqual([{ hex: "#ff0000" }]);
    expect(result.skippedLines).toBe(0);
  });

  it("여러 색을 올바른 소문자 헥스로 파싱한다", () => {
    const result = parseGplPalette("GIMP Palette\n255 0 0\n0 255 0\n0 0 255\n");
    expect(result.colors.map((c) => c.hex)).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
  });

  it("숫자가 아닌 토큰이 있는 줄은 건너뛰고 센다", () => {
    const result = parseGplPalette("GIMP Palette\n255 0 0\nabc def ghi\n0 255 0\n");
    expect(result.colors.map((c) => c.hex)).toEqual(["#ff0000", "#00ff00"]);
    expect(result.skippedLines).toBe(1);
  });

  it("채널 값이 범위를 벗어난 줄은 건너뛰고 센다", () => {
    const result = parseGplPalette("GIMP Palette\n255 0 0\n300 0 0\n0 255 0\n");
    expect(result.colors.map((c) => c.hex)).toEqual(["#ff0000", "#00ff00"]);
    expect(result.skippedLines).toBe(1);
  });

  it("CRLF 줄바꿈을 처리한다", () => {
    const result = parseGplPalette("GIMP Palette\r\n255 0 0\r\n0 255 0\r\n");
    expect(result.colors.map((c) => c.hex)).toEqual(["#ff0000", "#00ff00"]);
  });

  it("앞의 BOM을 제거한다", () => {
    const result = parseGplPalette("﻿GIMP Palette\n255 0 0\n");
    expect(result.colors.map((c) => c.hex)).toEqual(["#ff0000"]);
  });

  it("중복 색과 원본 순서를 보존한다", () => {
    const result = parseGplPalette("GIMP Palette\n255 0 0\n0 255 0\n255 0 0\n");
    expect(result.colors.map((c) => c.hex)).toEqual(["#ff0000", "#00ff00", "#ff0000"]);
  });

  it("각 색의 이름을 trim해 기록하고, 비어있으면 name을 생략한다", () => {
    const result = parseGplPalette("GIMP Palette\n255 0 0   Red Swatch  \n0 255 0\n");
    expect(result.colors[0]).toEqual({ hex: "#ff0000", name: "Red Swatch" });
    expect(result.colors[1]).toEqual({ hex: "#00ff00" });
  });

  it("헤더는 유효하지만 색이 하나도 없으면 던진다", () => {
    expect(() => parseGplPalette("GIMP Palette\n# just a comment\nName: 빈 팔레트\n")).toThrow();
  });
});

describe("writeGplPalette", () => {
  it("GIMP Palette로 시작한다", () => {
    const out = writeGplPalette({ name: "테스트", colors: ["#ff0000"] });
    expect(out.startsWith("GIMP Palette\n")).toBe(true);
  });

  it("Name: 줄에 trim된 이름을 포함한다", () => {
    const out = writeGplPalette({ name: "  내 팔레트  ", colors: ["#ff0000"] });
    expect(out).toContain("Name: 내 팔레트\n");
  });

  it("parseGplPalette로 왕복하면 같은 순서의 같은 헥스 목록을 얻는다", () => {
    const colors = ["#ff0000", "#00ff00", "#0000ff", "#ff0000"];
    const out = writeGplPalette({ name: "왕복", colors });
    const parsed = parseGplPalette(out);
    expect(parsed.colors.map((c) => c.hex)).toEqual(colors);
  });

  it("이름이 빈 값이면 DEFAULT_PALETTE_NAME으로 대체한다", () => {
    const out = writeGplPalette({ name: "   ", colors: ["#ff0000"] });
    expect(out).toContain("Name: 이름 없는 팔레트\n");
  });

  it("잘못된 헥스 문자열은 조용히 건너뛴다", () => {
    const out = writeGplPalette({ name: "테스트", colors: ["#ff0000", "not-a-color", "#00ff00"] });
    const parsed = parseGplPalette(out);
    expect(parsed.colors.map((c) => c.hex)).toEqual(["#ff0000", "#00ff00"]);
  });
});

describe("paletteFileName", () => {
  it("파일시스템 금지 문자를 제거한다", () => {
    expect(paletteFileName({ name: 'a/b\\c:d*e?f"g<h>i|j' })).toBe("abcdefghij.gpl");
  });

  it("한글은 그대로 유지한다", () => {
    expect(paletteFileName({ name: "내 팔레트" })).toBe("내 팔레트.gpl");
  });

  it("정제 후 이름이 비면 palette.gpl로 대체한다", () => {
    expect(paletteFileName({ name: '///' })).toBe("palette.gpl");
    expect(paletteFileName({ name: "   " })).toBe("palette.gpl");
  });
});

describe("listPalettes", () => {
  it("저장소 없으면 빈 배열", () => {
    expect(listPalettes(null)).toEqual([]);
    expect(listPalettes(undefined)).toEqual([]);
  });

  it("빈/깨진 JSON은 빈 배열", () => {
    expect(listPalettes(fakeStorage())).toEqual([]);
    expect(listPalettes(fakeStorage({ [PALETTE_LIBRARY_KEY]: "{not json" }))).toEqual([]);
    expect(listPalettes(fakeStorage({ [PALETTE_LIBRARY_KEY]: '{"a":1}' }))).toEqual([]); // 배열 아님
  });

  it("형식이 맞는 팔레트만 통과시킨다", () => {
    const s = fakeStorage({
      [PALETTE_LIBRARY_KEY]: JSON.stringify([palette("a"), { id: "x" }, palette("b")]),
    });
    expect(listPalettes(s).map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("savePalette", () => {
  it("맨 앞에 추가한다", () => {
    const s = fakeStorage();
    savePalette(s, palette("a"));
    const next = savePalette(s, palette("b"));
    expect(next.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("같은 id는 교체하며 맨 앞으로", () => {
    const s = fakeStorage();
    savePalette(s, palette("a", 1));
    savePalette(s, palette("b", 1));
    const next = savePalette(s, palette("a", 2));
    expect(next.map((p) => p.id)).toEqual(["a", "b"]);
    expect(next[0].createdAt).toBe(2);
  });

  it(`최대 ${MAX_PALETTES}개로 제한`, () => {
    const s = fakeStorage();
    let result: StudioNamedPalette[] = [];
    for (let i = 0; i < MAX_PALETTES + 5; i++) result = savePalette(s, palette(`p${i}`, i));
    expect(result).toHaveLength(MAX_PALETTES);
    expect(result[0].id).toBe(`p${MAX_PALETTES + 4}`);
  });

  it("저장소에 영속된다", () => {
    const s = fakeStorage();
    savePalette(s, palette("a"));
    expect(listPalettes(s).map((p) => p.id)).toEqual(["a"]);
  });
});

describe("renamePalette", () => {
  it("배열 순서를 유지하며 updatedAt을 갱신한다", () => {
    const s = fakeStorage();
    savePalette(s, palette("a", 1));
    savePalette(s, palette("b", 2));
    const before = listPalettes(s).find((p) => p.id === "b")!.updatedAt;
    const next = renamePalette(s, "b", "새 이름");
    expect(next.map((p) => p.id)).toEqual(["b", "a"]); // 순서 유지(맨 앞으로 옮기지 않음)
    const renamed = next.find((p) => p.id === "b")!;
    expect(renamed.name).toBe("새 이름");
    expect(renamed.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("빈 이름은 무시한다(원본 목록 그대로)", () => {
    const s = fakeStorage();
    savePalette(s, palette("a"));
    const next = renamePalette(s, "a", "   ");
    expect(next.find((p) => p.id === "a")!.name).toBe("팔레트 a");
  });

  it("없는 id는 무시한다", () => {
    const s = fakeStorage();
    savePalette(s, palette("a"));
    const next = renamePalette(s, "zzz", "새 이름");
    expect(next.map((p) => p.id)).toEqual(["a"]);
  });
});

describe("deletePalette", () => {
  it("id로 삭제", () => {
    const s = fakeStorage();
    savePalette(s, palette("a"));
    savePalette(s, palette("b"));
    const next = deletePalette(s, "a");
    expect(next.map((p) => p.id)).toEqual(["b"]);
    expect(listPalettes(s).map((p) => p.id)).toEqual(["b"]);
  });

  it("없는 id는 그대로", () => {
    const s = fakeStorage();
    savePalette(s, palette("a"));
    expect(deletePalette(s, "zzz").map((p) => p.id)).toEqual(["a"]);
  });
});

describe("createPalette", () => {
  it("대소문자·축약형 변형을 중복 제거한다", () => {
    const p = createPalette("색상", ["#ABC", "#aabbcc", "#AABBCC"]);
    expect(p.colors).toEqual(["#aabbcc"]);
  });

  it("유효하지 않은 토큰은 버린다", () => {
    const p = createPalette("색상", ["#ff0000", "red", "not-a-color", "#00ff00"]);
    expect(p.colors).toEqual(["#ff0000", "#00ff00"]);
  });

  it("모두 유효하지 않으면 던진다", () => {
    expect(() => createPalette("색상", ["red", "blue"])).toThrow();
    expect(() => createPalette("색상", [])).toThrow();
  });

  it(`최대 ${MAX_COLORS_PER_PALETTE}개를 넘으면 조용히 자르지 않고 거부한다`, () => {
    const colors = Array.from({ length: MAX_COLORS_PER_PALETTE + 10 }, (_, i) => {
      const hex = i.toString(16).padStart(6, "0");
      return `#${hex}`;
    });
    expect(() => createPalette("큰 팔레트", colors)).toThrow(
      `팔레트 하나에는 최대 ${MAX_COLORS_PER_PALETTE}색만 저장할 수 있습니다.`,
    );
  });
});

describe("importPaletteFromGpl", () => {
  it("parseGplPalette의 예외를 그대로 전파한다", () => {
    expect(() => importPaletteFromGpl("not a gpl file")).toThrow();
  });

  it("파일에 Name: 헤더가 없으면 fallbackName을 쓴다", () => {
    const result = importPaletteFromGpl("GIMP Palette\n255 0 0\n", "내파일");
    expect(result.palette.name).toBe("내파일");
  });

  it("fallbackName도 없으면 DEFAULT_PALETTE_NAME을 쓴다", () => {
    const result = importPaletteFromGpl("GIMP Palette\n255 0 0\n");
    expect(result.palette.name).toBe("이름 없는 팔레트");
  });

  it("cap을 넘는 파일은 truncated:true와 skippedLines를 함께 알린다", () => {
    const lines = ["GIMP Palette"];
    for (let i = 0; i < MAX_COLORS_PER_PALETTE + 5; i++) lines.push("255 0 0");
    lines.push("bad line here");
    const gpl = lines.join("\n") + "\n";
    const result = importPaletteFromGpl(gpl);
    expect(result.truncated).toBe(true);
    expect(result.palette.colors).toHaveLength(MAX_COLORS_PER_PALETTE);
    expect(result.skippedLines).toBe(1);
  });
});
