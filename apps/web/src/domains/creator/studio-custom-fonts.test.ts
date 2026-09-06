import { describe, expect, it, vi } from "vitest";

import {
  addCustomFont,
  CUSTOM_FONT_LIBRARY_KEY,
  CUSTOM_FONT_LIBRARY_STORAGE_VERSION,
  customFontCssValue,
  customFontFaceSource,
  deriveCustomFontFamily,
  formatCustomFontBytes,
  listCustomFonts,
  MAX_CUSTOM_FONT_FILE_BYTES,
  MAX_CUSTOM_FONT_TOTAL_BYTES,
  parseCustomFonts,
  registerStudioCustomFont,
  registerStudioCustomFonts,
  remainingCustomFontBytes,
  removeCustomFont,
  renameCustomFont,
  resolveCustomFontFromCssValue,
  saveCustomFonts,
  serializeCustomFonts,
  sniffStudioFontFormat,
  totalCustomFontBytes,
  type CustomFontStorage,
  type StudioCustomFont,
  type StudioFontFaceBinarySource,
  type StudioFontFaceLike,
  type StudioFontSetLike,
} from "./studio-custom-fonts";
import { studioGoogleFontCssValue } from "./studio-google-fonts";

// ── 픽스처 ──────────────────────────────────────────────────────────────

/** 앞 4바이트에 서명을 심고 나머지는 0으로 채운 가짜 글꼴 컨테이너. */
function fontBytes(signature: readonly number[] | string, size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  const head = typeof signature === "string"
    ? [...signature].map((ch) => ch.charCodeAt(0))
    : signature;
  bytes.set(head.slice(0, size), 0);
  return bytes;
}

const TTF = fontBytes([0x00, 0x01, 0x00, 0x00]);

function memoryStorage(initial?: string): CustomFontStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(CUSTOM_FONT_LIBRARY_KEY, initial);
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function added(fonts: readonly StudioCustomFont[], fileName: string, bytes = TTF, id?: string) {
  const result = addCustomFont(fonts, { fileName, bytes, ...(id ? { id } : {}) });
  if (result.status !== "added") throw new Error(`expected added, got: ${result.message}`);
  return result;
}

// ── 매직 넘버 ───────────────────────────────────────────────────────────

describe("sniffStudioFontFormat", () => {
  it.each([
    ["TrueType sfnt 0x00010000", [0x00, 0x01, 0x00, 0x00], "ttf"],
    ["CFF OpenType OTTO", "OTTO", "otf"],
    ["Apple TrueType true", "true", "ttf"],
    ["TrueType Collection ttcf", "ttcf", "ttc"],
    ["WOFF wOFF", "wOFF", "woff"],
    ["WOFF2 wOF2", "wOF2", "woff2"],
  ] as const)("accepts %s", (_label, signature, expected) => {
    expect(sniffStudioFontFormat(fontBytes(signature))).toBe(expected);
  });

  it.each([
    ["PNG", [0x89, 0x50, 0x4e, 0x47]],
    ["ZIP", [0x50, 0x4b, 0x03, 0x04]],
    ["PDF", "%PDF"],
    ["PostScript Type1 sfnt", "typ1"],
    ["plain text", "GIMP"],
    ["0x00010001 (버전 태그 오프바이원)", [0x00, 0x01, 0x00, 0x01]],
  ] as const)("rejects %s", (_label, signature) => {
    expect(sniffStudioFontFormat(fontBytes(signature))).toBeNull();
  });

  it("rejects a truncated header", () => {
    expect(sniffStudioFontFormat(new Uint8Array([0x00, 0x01, 0x00]))).toBeNull();
    expect(sniffStudioFontFormat(new Uint8Array())).toBeNull();
  });

  it("rejects a font-shaped tail that does not start with the signature", () => {
    const shifted = new Uint8Array(64);
    shifted.set([0xff, 0x00, 0x01, 0x00, 0x00], 0);
    expect(sniffStudioFontFormat(shifted)).toBeNull();
  });
});

// ── family 이름 유도 ─────────────────────────────────────────────────────

describe("deriveCustomFontFamily", () => {
  it("strips the extension and keeps Korean, spaces and hyphens", () => {
    expect(deriveCustomFontFamily("배달의민족 도현-Regular.otf")).toBe("배달의민족 도현-Regular");
  });

  it.each([".ttf", ".otf", ".ttc", ".woff", ".woff2", ".WOFF2", ".TTF"])(
    "strips the %s extension case-insensitively",
    (extension) => {
      expect(deriveCustomFontFamily(`MyFont${extension}`)).toBe("MyFont");
    }
  );

  it("drops the directory prefix from a path-like name", () => {
    expect(deriveCustomFontFamily("C:\\Users\\me\\fonts\\Sans.ttf")).toBe("Sans");
    expect(deriveCustomFontFamily("/home/me/fonts/Sans.ttf")).toBe("Sans");
  });

  it("removes quotes, commas and semicolons that would break font-family", () => {
    const family = deriveCustomFontFamily(`My'Font",Bold;Extra.ttf`);
    expect(family).not.toMatch(/['",;]/u);
    expect(family).toBe("My Font Bold Extra");
  });

  it("removes control characters", () => {
    const family = deriveCustomFontFamily(`Sa${String.fromCharCode(0x01)}ns${String.fromCharCode(0x7f)}.ttf`);
    expect(family).toBe("Sa ns");
    expect([...family].every((ch) => (ch.codePointAt(0) ?? 0) >= 0x20)).toBe(true);
  });

  it("collapses runs of whitespace", () => {
    expect(deriveCustomFontFamily("  My    Great \t Font .ttf")).toBe("My Great Font");
  });

  it("falls back to a default name when nothing survives sanitising", () => {
    expect(deriveCustomFontFamily(`,,;;''.ttf`)).toBe("사용자 글꼴");
    expect(deriveCustomFontFamily("")).toBe("사용자 글꼴");
  });

  it("suffixes (2), (3) … against names already taken", () => {
    expect(deriveCustomFontFamily("Sans.ttf", ["Sans"])).toBe("Sans (2)");
    expect(deriveCustomFontFamily("Sans.ttf", ["Sans", "Sans (2)"])).toBe("Sans (3)");
    expect(deriveCustomFontFamily("Sans.woff2", ["Other"])).toBe("Sans");
  });

  it("bounds the name length", () => {
    expect(deriveCustomFontFamily(`${"가".repeat(200)}.ttf`).length).toBeLessThanOrEqual(64);
  });
});

// ── CSS 값 ──────────────────────────────────────────────────────────────

describe("customFontCssValue", () => {
  it("mirrors the Google-font CSS value shape", () => {
    expect(customFontCssValue({ family: "My Font" })).toBe("'My Font', sans-serif");
    expect(customFontCssValue({ family: "My Font" })).toBe(
      studioGoogleFontCssValue({ family: "My Font", category: "sans", weights: [400] })
    );
  });

  it("wraps the data URL for the FontFace src descriptor", () => {
    expect(customFontFaceSource({ dataUrl: "data:font/ttf;base64,AAEAAA==" })).toBe(
      'url("data:font/ttf;base64,AAEAAA==")'
    );
  });

  it("resolves a css value back to the stored font", () => {
    const fonts = added([], "Sans.ttf").fonts;
    expect(resolveCustomFontFromCssValue(fonts, "'Sans', sans-serif")?.family).toBe("Sans");
    expect(resolveCustomFontFromCssValue(fonts, "Pretendard, sans-serif")).toBeUndefined();
    expect(resolveCustomFontFromCssValue([], "'Sans', sans-serif")).toBeUndefined();
  });
});

// ── add / remove / rename ───────────────────────────────────────────────

describe("addCustomFont", () => {
  it("returns a new array and never mutates the input", () => {
    const before: StudioCustomFont[] = [];
    const result = added(before, "Sans.ttf");
    expect(before).toHaveLength(0);
    expect(result.fonts).toHaveLength(1);
    expect(result.fonts[0]).toMatchObject({
      family: "Sans",
      fileName: "Sans.ttf",
      byteLength: TTF.byteLength,
    });
    expect(result.fonts[0]?.dataUrl?.startsWith("data:font/ttf;base64,")).toBe(true);
  });

  it.each([
    ["ttf", [0x00, 0x01, 0x00, 0x00], "font/ttf"],
    ["otf", "OTTO", "font/otf"],
    ["ttc", "ttcf", "font/collection"],
    ["woff", "wOFF", "font/woff"],
    ["woff2", "wOF2", "font/woff2"],
  ] as const)("labels a %s payload with its own MIME", (_label, signature, mime) => {
    const result = added([], "Face.bin", fontBytes(signature));
    expect(result.font.dataUrl?.startsWith(`data:${mime};base64,`)).toBe(true);
  });

  it("rejects a non-font payload with an honest Korean message", () => {
    const result = addCustomFont([], { fileName: "cat.png", bytes: fontBytes([0x89, 0x50, 0x4e, 0x47]) });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.message).toContain("글꼴 파일이 아니에요");
    expect(result.message).toContain("WOFF2");
    expect(result.fonts).toEqual([]);
  });

  it("rejects an empty file", () => {
    const result = addCustomFont([], { fileName: "empty.ttf", bytes: new Uint8Array() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.message).toContain("빈 파일");
  });

  it("rejects a file over the per-file cap and names both numbers", () => {
    const huge = {
      0: 0x00,
      1: 0x01,
      2: 0x00,
      3: 0x00,
      byteLength: MAX_CUSTOM_FONT_FILE_BYTES + 1,
    } as unknown as Uint8Array;
    const result = addCustomFont([], { fileName: "huge.ttf", bytes: huge });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.message).toContain(formatCustomFontBytes(huge.byteLength));
    expect(result.message).toContain(formatCustomFontBytes(MAX_CUSTOM_FONT_FILE_BYTES));
  });

  it("rejects a file that would exceed the total budget and names both numbers", () => {
    const seed = added([], "a.ttf").font;
    const fonts: StudioCustomFont[] = [{ ...seed, byteLength: MAX_CUSTOM_FONT_TOTAL_BYTES }];
    expect(totalCustomFontBytes(fonts)).toBe(MAX_CUSTOM_FONT_TOTAL_BYTES);
    expect(remainingCustomFontBytes(fonts)).toBe(0);

    const result = addCustomFont(fonts, { fileName: "b.ttf", bytes: TTF });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.message).toContain(formatCustomFontBytes(MAX_CUSTOM_FONT_TOTAL_BYTES));
    expect(result.message).toContain(formatCustomFontBytes(TTF.byteLength));
    expect(result.fonts).toHaveLength(1);
  });

  it("accepts a file that exactly fills the remaining budget", () => {
    const seed = added([], "a.ttf").font;
    const fonts: StudioCustomFont[] = [{
      ...seed,
      byteLength: MAX_CUSTOM_FONT_TOTAL_BYTES - TTF.byteLength,
    }];
    const result = addCustomFont(fonts, { fileName: "b.ttf", bytes: TTF });
    expect(result.status).toBe("added");
    if (result.status !== "added") throw new Error(result.message);
    expect(totalCustomFontBytes(result.fonts)).toBe(MAX_CUSTOM_FONT_TOTAL_BYTES);
    expect(remainingCustomFontBytes(result.fonts)).toBe(0);
  });

  it("admits more than 512 fonts while the logical byte budget remains available", () => {
    let fonts: StudioCustomFont[] = [];
    for (let index = 0; index < 513; index++) {
      fonts = added(fonts, `Font${index}.ttf`).fonts;
    }
    const result = addCustomFont(fonts, { fileName: "OneMore.ttf", bytes: TTF });
    expect(result.status).toBe("added");
    if (result.status !== "added") throw new Error(result.message);
    expect(result.fonts).toHaveLength(514);
  });

  it("dedupes the derived family against fonts already in the library", () => {
    let fonts = added([], "Sans.ttf").fonts;
    fonts = added(fonts, "Sans.ttf").fonts;
    fonts = added(fonts, "Sans.woff2", fontBytes("wOF2")).fonts;
    expect(fonts.map((font) => font.family)).toEqual(["Sans", "Sans (2)", "Sans (3)"]);
  });
});

describe("removeCustomFont / renameCustomFont", () => {
  it("removes by id without mutating", () => {
    const fonts = added(added([], "A.ttf", TTF, "id-a").fonts, "B.ttf", TTF, "id-b").fonts;
    const next = removeCustomFont(fonts, "id-a");
    expect(fonts).toHaveLength(2);
    expect(next.map((font) => font.id)).toEqual(["id-b"]);
    expect(removeCustomFont(fonts, "missing")).toHaveLength(2);
  });

  it("renames in place and keeps the list order", () => {
    const fonts = added(added([], "A.ttf", TTF, "id-a").fonts, "B.ttf", TTF, "id-b").fonts;
    const next = renameCustomFont(fonts, "id-a", "  나눔 손글씨  ");
    expect(next.map((font) => font.family)).toEqual(["나눔 손글씨", "B"]);
    expect(fonts[0]?.family).toBe("A");
  });

  it("sanitises the new name and dodges a collision", () => {
    const fonts = added(added([], "A.ttf", TTF, "id-a").fonts, "B.ttf", TTF, "id-b").fonts;
    expect(renameCustomFont(fonts, "id-a", "B")[0]?.family).toBe("B (2)");
    expect(renameCustomFont(fonts, "id-a", "Semi;colon")[0]?.family).toBe("Semi colon");
    expect(renameCustomFont(fonts, "id-a", `Back\\slash`)[0]?.family).toBe("Back slash");
    expect(renameCustomFont(fonts, "id-a", `Quo"te'd`)[0]?.family).toBe("Quo te d");
  });

  it("keeps the current name for an empty or unusable rename", () => {
    const fonts = added([], "A.ttf", TTF, "id-a").fonts;
    expect(renameCustomFont(fonts, "id-a", "   ")[0]?.family).toBe("A");
    expect(renameCustomFont(fonts, "id-a", ",,;;")[0]?.family).toBe("A");
    expect(renameCustomFont(fonts, "missing", "X")).toEqual(fonts);
  });
});

// ── 직렬화 / 방어적 파싱 ─────────────────────────────────────────────────

describe("serializeCustomFonts / parseCustomFonts", () => {
  it("round-trips a library", () => {
    let fonts = added([], "Sans.ttf", TTF, "id-a").fonts;
    fonts = added(fonts, "손글씨.woff2", fontBytes("wOF2", 128), "id-b").fonts;
    expect(parseCustomFonts(serializeCustomFonts(fonts))).toEqual(fonts);
  });

  it("writes a version envelope", () => {
    const parsed: unknown = JSON.parse(serializeCustomFonts(added([], "A.ttf").fonts));
    expect(parsed).toMatchObject({ version: CUSTOM_FONT_LIBRARY_STORAGE_VERSION });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["broken JSON", "{not json"],
    ["a bare number", "42"],
    ["a future version", JSON.stringify({ version: 999, fonts: [] })],
    ["an envelope without fonts", JSON.stringify({ version: 1 })],
  ] as const)("never throws on %s", (_label, raw) => {
    expect(parseCustomFonts(raw)).toEqual([]);
  });

  it("drops corrupt records but keeps the healthy ones", () => {
    const healthy = added([], "Sans.ttf", TTF, "id-a").fonts[0]!;
    const raw = JSON.stringify({
      version: CUSTOM_FONT_LIBRARY_STORAGE_VERSION,
      fonts: [
        null,
        "string",
        { id: "no-data-url", family: "X" },
        { id: "bad-data-url", family: "X", dataUrl: "https://example.com/font.ttf" },
        { id: "not-base64", family: "X", dataUrl: "data:font/ttf;base64,***" },
        { id: "blank-family", family: "  ", dataUrl: healthy.dataUrl },
        healthy,
        { ...healthy, id: "dup-family" },
        { ...healthy, family: "Other" },
      ],
    });
    const parsed = parseCustomFonts(raw);
    expect(parsed.map((font) => font.id)).toEqual(["id-a"]);
  });

  it("recomputes byteLength from the payload so a forged number cannot cheat the budget", () => {
    const healthy = added([], "Sans.ttf", TTF, "id-a").fonts[0]!;
    const raw = JSON.stringify({
      version: CUSTOM_FONT_LIBRARY_STORAGE_VERSION,
      fonts: [{ ...healthy, byteLength: 1 }],
    });
    expect(parseCustomFonts(raw)[0]?.byteLength).toBe(TTF.byteLength);
  });

  it("refuses to push verified OPFS bytes back through the legacy data-url serializer", () => {
    const productFont: StudioCustomFont = {
      id: "opfs-font",
      family: "OPFS Font",
      fileName: "opfs.ttf",
      byteLength: TTF.byteLength,
      verifiedBytes: TTF,
    };
    expect(() => serializeCustomFonts([productFont])).toThrow(/legacy data-url store/u);
  });

  it("does not silently truncate a byte-bounded legacy library after 512 records", () => {
    let fonts: StudioCustomFont[] = [];
    for (let index = 0; index < 1_001; index++) {
      fonts = added(fonts, `Font${index}.ttf`).fonts;
    }
    const raw = JSON.stringify({ version: 1, fonts });
    expect(parseCustomFonts(raw)).toHaveLength(1_001);
  });

  it("still reads a legacy bare array", () => {
    const fonts = added([], "Sans.ttf", TTF, "id-a").fonts;
    expect(parseCustomFonts(JSON.stringify(fonts))).toEqual(fonts);
  });
});

// ── 저장소 seam ─────────────────────────────────────────────────────────

describe("listCustomFonts / saveCustomFonts", () => {
  it("round-trips through an injected storage", () => {
    const storage = memoryStorage();
    const fonts = added([], "Sans.ttf", TTF, "id-a").fonts;
    expect(saveCustomFonts(storage, fonts)).toBe(true);
    expect(listCustomFonts(storage)).toEqual(fonts);
  });

  it("returns [] for a missing storage and reports a failed write", () => {
    expect(listCustomFonts(null)).toEqual([]);
    expect(listCustomFonts(undefined)).toEqual([]);
    expect(saveCustomFonts(null, [])).toBe(false);
  });

  it("survives a storage that throws on read and reports a quota failure on write", () => {
    const throwing: CustomFontStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(listCustomFonts(throwing)).toEqual([]);
    expect(saveCustomFonts(throwing, [])).toBe(false);
  });
});

// ── FontFace 등록 ───────────────────────────────────────────────────────

type FakeFontFaceFactory = (
  family: string,
  source: StudioFontFaceBinarySource,
) => StudioFontFaceLike & { source: StudioFontFaceBinarySource };

function fakeFontSet() {
  const faces: StudioFontFaceLike[] = [];
  const set: StudioFontSetLike = {
    add: (face) => {
      faces.push(face);
      return set;
    },
  };
  return { set, faces };
}

function fakeFactory(behavior: "ok" | "load-reject" | "construct-throw" = "ok") {
  return vi.fn<FakeFontFaceFactory>((family, source) => {
    if (behavior === "construct-throw") throw new Error("SyntaxError: bad src");
    return {
      family,
      source,
      load: () =>
        behavior === "load-reject"
          ? Promise.reject(new Error("NetworkError"))
          : Promise.resolve({ family }),
    };
  });
}

describe("registerStudioCustomFont", () => {
  it("loads then adds the face to the injected font set", async () => {
    const font = added([], "Sans.ttf").font;
    const { set, faces: registered } = fakeFontSet();
    const factory = fakeFactory();

    const result = await registerStudioCustomFont(font, set, factory);

    expect(result).toEqual({ status: "ok", family: "Sans" });
    expect(factory).toHaveBeenCalledWith("Sans", customFontFaceSource({ dataUrl: font.dataUrl! }));
    expect(registered.map((face) => face.family)).toEqual(["Sans"]);
  });

  it("reports unsupported when the font set is missing", async () => {
    const font = added([], "Sans.ttf").font;
    expect(await registerStudioCustomFont(font, null, fakeFactory())).toEqual({
      status: "unsupported",
      family: "Sans",
    });
  });

  it("reports unsupported when the FontFace constructor is missing", async () => {
    const font = added([], "Sans.ttf").font;
    const { set } = fakeFontSet();
    expect(await registerStudioCustomFont(font, set, null)).toEqual({
      status: "unsupported",
      family: "Sans",
    });
  });

  it("never throws when load() rejects", async () => {
    const font = added([], "Sans.ttf").font;
    const { set, faces: registered } = fakeFontSet();

    const result = await registerStudioCustomFont(font, set, fakeFactory("load-reject"));

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("unreachable");
    expect(result.message).toContain("Sans");
    expect(result.message).toContain("등록하지 못했어요");
    expect(registered).toHaveLength(0);
  });

  it("never throws when the constructor itself throws", async () => {
    const font = added([], "Sans.ttf").font;
    const { set } = fakeFontSet();
    expect((await registerStudioCustomFont(font, set, fakeFactory("construct-throw"))).status).toBe("failed");
  });

  it("registers a whole library and keeps per-font results", async () => {
    let fonts = added([], "A.ttf").fonts;
    fonts = added(fonts, "B.ttf").fonts;
    const { set, faces: registered } = fakeFontSet();

    const results = await registerStudioCustomFonts(fonts, set, fakeFactory());

    expect(results.map((result) => result.status)).toEqual(["ok", "ok"]);
    expect(registered).toHaveLength(2);
  });

  it("keeps going when one font in the library fails", async () => {
    let fonts = added([], "A.ttf").fonts;
    fonts = added(fonts, "B.ttf").fonts;
    const { set } = fakeFontSet();
    let call = 0;
    const factory: FakeFontFaceFactory = (family, source) => {
      call += 1;
      return {
        family,
        source,
        load: () => (call === 1 ? Promise.reject(new Error("boom")) : Promise.resolve({ family })),
      };
    };

    const results = await registerStudioCustomFonts(fonts, set, factory);

    expect(results.map((result) => result.status)).toEqual(["failed", "ok"]);
  });
});

// ── 표시 포맷 ───────────────────────────────────────────────────────────

describe("formatCustomFontBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1_500, "1.5 KB"],
    [2_000_000, "2 MB"],
    [3_000_000, "3 MB"],
  ] as const)("formats %s bytes", (value, expected) => {
    expect(formatCustomFontBytes(value)).toBe(expected);
  });

  it("does not pretend to know a bad number", () => {
    expect(formatCustomFontBytes(Number.NaN)).toBe("용량 미확인");
    expect(formatCustomFontBytes(-1)).toBe("용량 미확인");
  });
});
