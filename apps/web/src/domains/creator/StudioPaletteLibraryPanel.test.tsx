// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  exportStudioPalette,
  importStudioPalette,
  STUDIO_PALETTE_INTERCHANGE_LIMITS,
} from "./studio-palette-interchange";
import {
  deletePaletteInMemory,
  renamePaletteInMemory,
  type StudioNamedPalette,
  upsertPaletteInMemory,
} from "./studio-palette-library";
import {
  StudioPaletteLibraryPanel,
  type StudioPaletteLibraryRepository,
} from "./StudioPaletteLibraryPanel";

const { downloadBlobMock } = vi.hoisted(() => ({ downloadBlobMock: vi.fn() }));

vi.mock("./export/studio-export", () => ({ downloadBlob: downloadBlobMock }));

const panelSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/StudioPaletteLibraryPanel.tsx"),
  "utf8"
);
const encoder = new TextEncoder();

const FORMAT_CASES = [
  ["gpl", "theme.gpl", "GPL", "text/plain;charset=utf-8"],
  ["ase", "theme.ase", "ASE", "application/octet-stream"],
  ["aco", "theme.aco", "ACO", "application/octet-stream"],
  ["act", "theme.act", "ACT", "application/octet-stream"],
  ["pal", "theme.pal", "PAL", "text/plain;charset=utf-8"],
  ["css", "theme.css", "CSS", "text/css;charset=utf-8"],
  ["json", "theme.palette.json", "JSON", "application/json;charset=utf-8"],
] as const;

const interchangePalette = {
  name: "주인공 팔레트",
  colors: [
    { hex: "#112233", name: "Ink" },
    { hex: "#ff6600", name: "Accent" },
  ],
};

function bytesOf(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? encoder.encode(value) : Uint8Array.from(value);
}

function testFile(name: string, value: string | Uint8Array, type = ""): File {
  const bytes = bytesOf(value);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const file = new File([buffer], name, { type });
  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: vi.fn(async () => buffer.slice(0)),
  });
  return file;
}

function paletteFixture(overrides: Partial<StudioNamedPalette> = {}): StudioNamedPalette {
  return {
    id: "palette-1",
    name: "내 팔레트",
    createdAt: 1,
    updatedAt: 1,
    colors: ["#112233", "#ff6600"],
    ...overrides,
  };
}

interface TestPaletteRepository extends StudioPaletteLibraryRepository {
  readonly items: StudioNamedPalette[];
  seed(item: StudioNamedPalette): void;
}

function createTestRepository(initial: readonly StudioNamedPalette[] = []): TestPaletteRepository {
  let items = [...initial];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    authority: "injected",
    get items() {
      return items;
    },
    seed(item) {
      items = upsertPaletteInMemory(items, item);
    },
    async list() {
      return items;
    },
    async save(item) {
      items = upsertPaletteInMemory(items, item);
      notify();
      return items;
    },
    async rename(id, name) {
      items = renamePaletteInMemory(items, id, name);
      notify();
      return items;
    },
    async delete(id) {
      items = deletePaletteInMemory(items, id);
      notify();
      return items;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let testRepository: TestPaletteRepository;

function renderPanel(overrides: Partial<Parameters<typeof StudioPaletteLibraryPanel>[0]> = {}) {
  const onPickColor = vi.fn();
  const result = render(
    <StudioPaletteLibraryPanel
      onPickColor={onPickColor}
      seedColors={["#abcdef"]}
      repository={testRepository}
      {...overrides}
    />
  );
  return { ...result, onPickColor };
}

function importInput(): HTMLInputElement {
  return screen.getByLabelText("팔레트 파일 가져오기") as HTMLInputElement;
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Blob read failed"));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  testRepository = createTestRepository();
  downloadBlobMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudioPaletteLibraryPanel interchange", () => {
  it("keeps the codec out of the panel's static import graph", () => {
    expect(panelSource).toContain('import("./studio-palette-interchange")');
    expect(panelSource).not.toMatch(/from\s+["']\.\/studio-palette-interchange["']/u);
    expect(panelSource.match(/import\("\.\/studio-palette-interchange"\)/gu)).toHaveLength(2);
  });

  it.each(FORMAT_CASES)("automatically imports %s and persists the swatches", async (format, fileName, shortLabel) => {
    const encoded = exportStudioPalette(format, interchangePalette).data;
    const file = testFile(fileName, encoded);
    const { onPickColor } = renderPanel();
    const expectedPaletteName = ["aco", "act", "css", "pal"].includes(format) ? "theme" : "주인공 팔레트";

    fireEvent.change(importInput(), { target: { files: [file] } });

    expect(await screen.findByText(new RegExp(`${shortLabel}에서 .*2색을 가져왔어요`))).toBeTruthy();
    expect(testRepository.items[0]).toMatchObject({
      name: expectedPaletteName,
      colors: ["#112233", "#ff6600"],
    });
    fireEvent.click(screen.getByRole("button", { name: `${expectedPaletteName} 색상 #112233 선택` }));
    expect(onPickColor).toHaveBeenCalledWith("#112233");
  });

  it("prefers a strong ASE signature over a misleading text extension", async () => {
    const ase = exportStudioPalette("ase", interchangePalette).data;
    renderPanel();

    fireEvent.change(importInput(), { target: { files: [testFile("wrong.css", ase)] } });

    expect(await screen.findByText(/ASE에서 .*2색을 가져왔어요/u)).toBeTruthy();
  });

  it("prefers the JASC-PAL magic over a misleading Adobe extension", async () => {
    const pal = exportStudioPalette("pal", interchangePalette).data;
    renderPanel();

    fireEvent.change(importInput(), { target: { files: [testFile("wrong.act", pal)] } });

    expect(await screen.findByText(/PAL에서 .*2색을 가져왔어요/u)).toBeTruthy();
  });

  it("detects a legacy ACT table by its exact byte length when no extension exists", async () => {
    const act = new Uint8Array(768);
    act.set([17, 34, 51], 0);
    renderPanel();

    fireEvent.change(importInput(), { target: { files: [testFile("indexed-colors", act)] } });

    expect(await screen.findByText(/ACT에서 .*256색을 가져왔어요/u)).toBeTruthy();
    expect(testRepository.items[0]?.colors[0]).toBe("#112233");
  });

  it("does not misread a valid ACT table whose first colors resemble an empty ACO header", async () => {
    const act = new Uint8Array(768);
    act.set([0, 1, 0, 0, 34, 51], 0);
    renderPanel();

    fireEvent.change(importInput(), { target: { files: [testFile("indexed-colors.act", act)] } });

    expect(await screen.findByText(/ACT에서 .*256색을 가져왔어요/u)).toBeTruthy();
    expect(testRepository.items[0]?.colors[0]).toBe("#000100");
  });

  it.each(FORMAT_CASES)("exports a palette as %s with exact name, MIME and readable output", async (
    format,
    expectedFileName,
    shortLabel,
    mimeType
  ) => {
    testRepository.seed(paletteFixture({ name: "theme" }));
    renderPanel();
    await screen.findByRole("button", { name: "theme GPL로 내보내기" });
    fireEvent.change(screen.getByRole("combobox", { name: "내보내기 형식" }), { target: { value: format } });

    fireEvent.click(screen.getByRole("button", { name: `theme ${shortLabel}로 내보내기` }));

    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledOnce());
    const [blob, fileName] = downloadBlobMock.mock.calls[0] as [Blob, string];
    expect(fileName).toBe(expectedFileName);
    expect(blob.type).toBe(mimeType);
    const roundTrip = importStudioPalette(format, await blobBytes(blob));
    expect(roundTrip.palette.colors.map((color) => color.hex)).toEqual(["#112233", "#ff6600"]);
    expect(screen.getByRole("status").textContent).toContain(`${shortLabel} 파일`);
  });

  it("preserves the existing GPL filename and content contract", async () => {
    testRepository.seed(paletteFixture({ name: "한글/팔레트" }));
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "한글/팔레트 GPL로 내보내기" }));

    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledOnce());
    const [blob, fileName] = downloadBlobMock.mock.calls[0] as [Blob, string];
    expect(fileName).toBe("한글팔레트.gpl");
    const text = new TextDecoder().decode(await blobBytes(blob));
    expect(text).toMatch(/^GIMP Palette\nName: 한글\/팔레트\n#/u);
  });

  it("shows alpha, skipped-color and discarded-name losses instead of hiding them", async () => {
    const css = `:root {
      --glass: #ff000080;
      --broken: linear-gradient(red, blue);
    }`;
    renderPanel();

    fireEvent.change(importInput(), { target: { files: [testFile("glass.css", css, "text/css")] } });

    const alphaWarning = await screen.findByText(/알파를 제거/u);
    const status = alphaWarning.closest('[role="status"]');
    expect(status?.textContent).toContain("해석하지 못한 색 1개");
    expect(status?.textContent).toContain("색 이름 1개");
  });

  it("surfaces ACT transparency metadata loss instead of silently flattening it", async () => {
    const act = bytesOf(exportStudioPalette("act", interchangePalette).data);
    const view = new DataView(act.buffer, act.byteOffset, act.byteLength);
    view.setUint16(770, 1, false);
    renderPanel();

    fireEvent.change(importInput(), { target: { files: [testFile("transparent.act", act)] } });

    expect(await screen.findByText(/투명 색 인덱스 1/u)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("투명도를 제거");
  });

  it("reports and persists the 1,000-color truncation boundary", async () => {
    const variables = Array.from(
      { length: STUDIO_PALETTE_INTERCHANGE_LIMITS.maxColors + 1 },
      (_, index) => `--c-${index}: #${(index % 0xffffff).toString(16).padStart(6, "0")};`
    ).join("\n");
    renderPanel();

    fireEvent.change(importInput(), { target: { files: [testFile("large.css", `:root {\n${variables}\n}`)] } });

    expect(await screen.findByText(/앞쪽 1000색만/u)).toBeTruthy();
    expect(testRepository.items[0]?.colors).toHaveLength(1_000);
  });

  it("rejects a file over the shared 4MB limit before reading its bytes", async () => {
    const file = new File(
      [new Uint8Array(STUDIO_PALETTE_INTERCHANGE_LIMITS.maxBytes + 1)],
      "oversized.gpl",
      { type: "text/plain" }
    );
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    Object.defineProperty(file, "arrayBuffer", { configurable: true, value: arrayBuffer });
    renderPanel();

    fireEvent.change(importInput(), { target: { files: [file] } });

    expect((await screen.findByRole("alert")).textContent).toContain("4MB 안전 처리 한도");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("prevents a second import while the first file read is in flight", async () => {
    let releaseRead: ((buffer: ArrayBuffer) => void) | undefined;
    const firstBytes = bytesOf(exportStudioPalette("gpl", interchangePalette).data);
    const first = testFile("first.gpl", firstBytes);
    const firstRead = vi.fn(() => new Promise<ArrayBuffer>((resolve) => { releaseRead = resolve; }));
    Object.defineProperty(first, "arrayBuffer", { configurable: true, value: firstRead });
    const second = testFile("second.gpl", exportStudioPalette("gpl", interchangePalette).data);
    const secondRead = vi.mocked(second.arrayBuffer);
    renderPanel();

    fireEvent.change(importInput(), { target: { files: [first] } });
    await waitFor(() => expect(firstRead).toHaveBeenCalledOnce());
    fireEvent.change(importInput(), { target: { files: [second] } });
    expect(secondRead).not.toHaveBeenCalled();
    const buffer = new ArrayBuffer(firstBytes.byteLength);
    new Uint8Array(buffer).set(firstBytes);
    releaseRead?.(buffer);
    expect(await screen.findByText(/GPL에서 .*2색을 가져왔어요/u)).toBeTruthy();
  });

  it("uses 44px touch targets for import, select, item actions and swatches", async () => {
    testRepository.seed(paletteFixture());
    renderPanel();

    expect(importInput().closest("label")?.className).toContain("min-h-11");
    expect(screen.getByRole("combobox", { name: "내보내기 형식" }).className).toContain("min-h-11");
    expect((await screen.findByRole("button", { name: "내 팔레트 이름 변경" })).className).toContain("size-11");
    expect(screen.getByRole("button", { name: "내 팔레트 GPL로 내보내기" }).className).toContain("size-11");
    expect(screen.getByRole("button", { name: "내 팔레트 색상 #112233 선택" }).className).toContain("size-11");
  });

  it("creates a recent-color palette and keeps manual creation accessible", async () => {
    renderPanel();
    await screen.findByText("주입 저장소");
    fireEvent.click(screen.getByRole("button", { name: "최근 색으로 만들기" }));
    expect((await screen.findByRole("status")).textContent).toContain("최근 사용 색");

    fireEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    expect(screen.getByRole("textbox", { name: "새 팔레트 이름" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "새 팔레트 색상 코드" })).toBeTruthy();
  });

  it("keeps a failed durable mutation in explicit current-tab memory", async () => {
    const unavailableRepository: StudioPaletteLibraryRepository = {
      authority: "injected",
      async list() {
        return [];
      },
      async save() {
        throw new Error("OPFS quota unavailable");
      },
      async rename() {
        throw new Error("not reached");
      },
      async delete() {
        throw new Error("not reached");
      },
    };
    renderPanel({ repository: unavailableRepository });
    await screen.findByText("주입 저장소");

    fireEvent.click(screen.getByRole("button", { name: "최근 색으로 만들기" }));

    expect(await screen.findByText("현재 탭 메모리 임시 · 새로고침 시 사라짐")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("현재 탭 메모리에만");
    expect(screen.getAllByText("최근 사용 색").length).toBeGreaterThan(0);
  });

  it("fences a hydration started during save from overwriting the mutation", async () => {
    const stale = paletteFixture({ id: "stale", name: "오래된 팔레트" });
    let listCalls = 0;
    let listener: (() => void) | undefined;
    let releaseStale: ((items: StudioNamedPalette[]) => void) | undefined;
    const staleRead = new Promise<StudioNamedPalette[]>((resolve) => {
      releaseStale = resolve;
    });
    const repository: StudioPaletteLibraryRepository = {
      authority: "injected",
      async list() {
        listCalls += 1;
        return listCalls === 1 ? [] : staleRead;
      },
      async save(palette) {
        listener?.();
        return [palette];
      },
      async rename() {
        throw new Error("not reached");
      },
      async delete() {
        throw new Error("not reached");
      },
      subscribe(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    };
    renderPanel({ repository });
    await screen.findByText("주입 저장소");

    fireEvent.click(screen.getByRole("button", { name: "최근 색으로 만들기" }));
    expect(await screen.findByText(/팔레트를 만들었어요/u)).toBeTruthy();

    await act(async () => {
      releaseStale?.([stale]);
      await staleRead;
    });
    expect(screen.queryByText("오래된 팔레트")).toBeNull();
    expect(screen.getAllByText("최근 사용 색").length).toBeGreaterThan(0);
  });
});
