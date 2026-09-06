import { describe, it, expect } from "vitest";

import {
  BRAND_KIT_KEY,
  createBrandKit,
  DEFAULT_BRAND_KIT_FONT,
  DEFAULT_BRAND_KIT_NAME,
  deleteBrandKit,
  listBrandKits,
  MAX_BRAND_KITS,
  placeBrandKitLogo,
  renameBrandKit,
  resolveBrandKitPalette,
  saveBrandKit,
  type BrandKit,
} from "./studio-brand-kit";

import type { StudioNamedPalette } from "./studio-palette-library";

// 인메모리 가짜 저장소 — studio-palette-library.test.ts와 동일한 헬퍼.
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    _map: map,
  };
}

const kit = (id: string, createdAt = 1): BrandKit => ({
  id,
  name: `킷 ${id}`,
  createdAt,
  updatedAt: createdAt,
  paletteId: null,
  headingFont: DEFAULT_BRAND_KIT_FONT,
  bodyFont: DEFAULT_BRAND_KIT_FONT,
  logo: null,
});

const palette = (id: string): StudioNamedPalette => ({
  id,
  name: `팔레트 ${id}`,
  createdAt: 1,
  updatedAt: 1,
  colors: ["#ff0000", "#00ff00"],
});

describe("listBrandKits", () => {
  it("저장소 없으면 빈 배열", () => {
    expect(listBrandKits(null)).toEqual([]);
    expect(listBrandKits(undefined)).toEqual([]);
  });

  it("빈/깨진 JSON은 빈 배열", () => {
    expect(listBrandKits(fakeStorage())).toEqual([]);
    expect(listBrandKits(fakeStorage({ [BRAND_KIT_KEY]: "{not json" }))).toEqual([]);
    expect(listBrandKits(fakeStorage({ [BRAND_KIT_KEY]: '{"a":1}' }))).toEqual([]); // 배열 아님
  });

  it("형식이 맞는 킷만 통과시킨다(필드 누락 항목 걸러짐)", () => {
    const s = fakeStorage({
      [BRAND_KIT_KEY]: JSON.stringify([kit("a"), { id: "x" }, kit("b")]),
    });
    expect(listBrandKits(s).map((k) => k.id)).toEqual(["a", "b"]);
  });

  it("logo가 null도 유효한 shape도 아니면 걸러진다", () => {
    const bad = { ...kit("bad"), logo: { dataUrl: "x" } }; // width/height 누락
    const s = fakeStorage({ [BRAND_KIT_KEY]: JSON.stringify([kit("a"), bad]) });
    expect(listBrandKits(s).map((k) => k.id)).toEqual(["a"]);
  });

  it("logo가 유효한 shape이면 통과한다", () => {
    const withLogo: BrandKit = { ...kit("a"), logo: { dataUrl: "data:image/webp;base64,x", width: 10, height: 20 } };
    const s = fakeStorage({ [BRAND_KIT_KEY]: JSON.stringify([withLogo]) });
    expect(listBrandKits(s)).toEqual([withLogo]);
  });
});

describe("saveBrandKit", () => {
  it("맨 앞에 추가한다", () => {
    const s = fakeStorage();
    saveBrandKit(s, kit("a"));
    const next = saveBrandKit(s, kit("b"));
    expect(next.map((k) => k.id)).toEqual(["b", "a"]);
  });

  it("같은 id는 교체하며 맨 앞으로", () => {
    const s = fakeStorage();
    saveBrandKit(s, kit("a", 1));
    saveBrandKit(s, kit("b", 1));
    const next = saveBrandKit(s, kit("a", 2));
    expect(next.map((k) => k.id)).toEqual(["a", "b"]);
    expect(next[0].createdAt).toBe(2);
  });

  it(`최대 ${MAX_BRAND_KITS}개로 제한`, () => {
    const s = fakeStorage();
    let result: BrandKit[] = [];
    for (let i = 0; i < MAX_BRAND_KITS + 5; i++) result = saveBrandKit(s, kit(`k${i}`, i));
    expect(result).toHaveLength(MAX_BRAND_KITS);
    expect(result[0].id).toBe(`k${MAX_BRAND_KITS + 4}`);
  });

  it("저장소에 영속된다", () => {
    const s = fakeStorage();
    saveBrandKit(s, kit("a"));
    expect(listBrandKits(s).map((k) => k.id)).toEqual(["a"]);
  });
});

describe("renameBrandKit", () => {
  it("배열 순서를 유지하며 updatedAt을 갱신한다", () => {
    const s = fakeStorage();
    saveBrandKit(s, kit("a", 1));
    saveBrandKit(s, kit("b", 2));
    const before = listBrandKits(s).find((k) => k.id === "b")!.updatedAt;
    const next = renameBrandKit(s, "b", "새 이름");
    expect(next.map((k) => k.id)).toEqual(["b", "a"]); // 순서 유지(맨 앞으로 옮기지 않음)
    const renamed = next.find((k) => k.id === "b")!;
    expect(renamed.name).toBe("새 이름");
    expect(renamed.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("빈 이름은 무시한다(원본 목록 그대로)", () => {
    const s = fakeStorage();
    saveBrandKit(s, kit("a"));
    const next = renameBrandKit(s, "a", "   ");
    expect(next.find((k) => k.id === "a")!.name).toBe("킷 a");
  });

  it("없는 id는 무시한다", () => {
    const s = fakeStorage();
    saveBrandKit(s, kit("a"));
    const next = renameBrandKit(s, "zzz", "새 이름");
    expect(next.map((k) => k.id)).toEqual(["a"]);
  });
});

describe("deleteBrandKit", () => {
  it("id로 삭제", () => {
    const s = fakeStorage();
    saveBrandKit(s, kit("a"));
    saveBrandKit(s, kit("b"));
    const next = deleteBrandKit(s, "a");
    expect(next.map((k) => k.id)).toEqual(["b"]);
    expect(listBrandKits(s).map((k) => k.id)).toEqual(["b"]);
  });

  it("없는 id는 그대로", () => {
    const s = fakeStorage();
    saveBrandKit(s, kit("a"));
    expect(deleteBrandKit(s, "zzz").map((k) => k.id)).toEqual(["a"]);
  });
});

describe("createBrandKit", () => {
  it("절대 던지지 않는다 — 빈 입력만으로도 유효한 킷을 만든다", () => {
    expect(() => createBrandKit({ name: "" })).not.toThrow();
  });

  it("빈/공백 이름은 DEFAULT_BRAND_KIT_NAME으로 대체된다", () => {
    expect(createBrandKit({ name: "" }).name).toBe(DEFAULT_BRAND_KIT_NAME);
    expect(createBrandKit({ name: "   " }).name).toBe(DEFAULT_BRAND_KIT_NAME);
  });

  it("이름은 trim된다", () => {
    expect(createBrandKit({ name: "  내 킷  " }).name).toBe("내 킷");
  });

  it("headingFont/bodyFont 누락 시 DEFAULT_BRAND_KIT_FONT로 대체된다", () => {
    const k = createBrandKit({ name: "이름" });
    expect(k.headingFont).toBe(DEFAULT_BRAND_KIT_FONT);
    expect(k.bodyFont).toBe(DEFAULT_BRAND_KIT_FONT);
  });

  it("headingFont/bodyFont가 주어지면 trim되어 그대로 쓰인다", () => {
    const k = createBrandKit({ name: "이름", headingFont: "  'Jua', sans-serif  ", bodyFont: "'Gaegu', cursive" });
    expect(k.headingFont).toBe("'Jua', sans-serif");
    expect(k.bodyFont).toBe("'Gaegu', cursive");
  });

  it("paletteId/logo 누락 시 null", () => {
    const k = createBrandKit({ name: "이름" });
    expect(k.paletteId).toBeNull();
    expect(k.logo).toBeNull();
  });

  it("paletteId/logo가 주어지면 그대로 보존된다", () => {
    const logo = { dataUrl: "data:image/webp;base64,x", width: 10, height: 20 };
    const k = createBrandKit({ name: "이름", paletteId: "p1", logo });
    expect(k.paletteId).toBe("p1");
    expect(k.logo).toEqual(logo);
  });

  it("id는 매번 새로 생성된다", () => {
    const a = createBrandKit({ name: "a" });
    const b = createBrandKit({ name: "b" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("resolveBrandKitPalette", () => {
  it("paletteId가 null이면 null", () => {
    expect(resolveBrandKitPalette(kit("a"), [palette("p1")])).toBeNull();
  });

  it("매칭되는 id가 있으면 해당 팔레트를 반환한다", () => {
    const k: BrandKit = { ...kit("a"), paletteId: "p1" };
    const p1 = palette("p1");
    expect(resolveBrandKitPalette(k, [p1, palette("p2")])).toBe(p1);
  });

  it("dangling 참조(팔레트가 목록에 없음)면 null", () => {
    const k: BrandKit = { ...kit("a"), paletteId: "deleted" };
    expect(resolveBrandKitPalette(k, [palette("p1")])).toBeNull();
  });
});

describe("placeBrandKitLogo", () => {
  it("정사각형 소스는 maxDim 이내로 맞춰진다", () => {
    const p = placeBrandKitLogo(720, 1080, 500, 500, 140, 28);
    expect(p.width).toBe(140);
    expect(p.height).toBe(140);
  });

  it("가로가 긴(landscape) 소스는 종횡비를 보존한다", () => {
    const p = placeBrandKitLogo(720, 1080, 400, 200, 140, 28);
    expect(p.width).toBe(140);
    expect(p.height).toBe(70);
  });

  it("세로가 긴(portrait) 소스는 종횡비를 보존한다", () => {
    const p = placeBrandKitLogo(720, 1080, 200, 400, 140, 28);
    expect(p.height).toBe(140);
    expect(p.width).toBe(70);
  });

  it("우하단 모서리에 margin만큼 여백을 두고 배치한다", () => {
    const p = placeBrandKitLogo(720, 1080, 140, 140, 140, 28);
    expect(p.x).toBe(720 - 28 - 140);
    expect(p.y).toBe(1080 - 28 - 140);
    expect(p.rotation).toBe(0);
  });

  it("sourceWidth/sourceHeight가 0이어도 NaN/Infinity 없이 안전하게 처리한다", () => {
    const p = placeBrandKitLogo(720, 1080, 0, 0, 140, 28);
    expect(Number.isFinite(p.width)).toBe(true);
    expect(Number.isFinite(p.height)).toBe(true);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    expect(p.width).toBeGreaterThan(0);
    expect(p.height).toBeGreaterThan(0);
  });

  it("작은 캔버스에서 좌표가 음수로 내려가지 않고 0으로 클램프된다", () => {
    const p = placeBrandKitLogo(50, 50, 500, 500, 140, 28);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });
});
