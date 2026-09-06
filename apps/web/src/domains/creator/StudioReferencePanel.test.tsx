// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStudioReferenceBoardDocument,
  createStudioReferenceBoardItem,
  type StudioReferenceBoardDocument,
  type StudioReferenceBoardItem,
} from "./studio-reference-board";
import { REFERENCE_PANEL_STORAGE_KEY, serializeReferencePanelSettings } from "./studio-reference-panel";
import {
  STUDIO_REFERENCE_PANEL_SETTINGS_KEY,
  createStudioReferencePanelPreferencesRepository,
} from "./studio-reference-panel-preferences-sqlite";
import { StudioReferencePanel } from "./StudioReferencePanel";

import type { StudioAsset } from "./studio-asset-library";
import type { StudioAsyncKeyValueStore } from "./studio-local-database";
import type { StudioReferenceImageRaster } from "./studio-reference-color-sampler";

const assetLibraryMock = vi.hoisted(() => ({
  listAssets: vi.fn(),
  ensureStudioAssetContentHash: vi.fn(),
  saveAsset: vi.fn(),
}));
const canvasImageIoMock = vi.hoisted(() => ({
  loadImageFileForCanvas: vi.fn(),
}));
const colorSamplerMock = vi.hoisted(() => ({
  loadStudioReferenceImageRaster: vi.fn(),
}));
const remoteReferenceMock = vi.hoisted(() => ({
  importStudioRemoteReferenceImage: vi.fn(),
}));
const referencePreferencesMock = vi.hoisted(() => ({
  acquireProduct: vi.fn(),
}));

vi.mock("./studio-asset-library", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./studio-asset-library")>();
  return {
    ...actual,
    listAssets: assetLibraryMock.listAssets,
    ensureStudioAssetContentHash: assetLibraryMock.ensureStudioAssetContentHash,
    saveAsset: assetLibraryMock.saveAsset,
  };
});

vi.mock("./canvas/studio-canvas-image-io", () => ({
  loadImageFileForCanvas: canvasImageIoMock.loadImageFileForCanvas,
}));

vi.mock("./studio-reference-color-sampler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./studio-reference-color-sampler")>();
  return {
    ...actual,
    loadStudioReferenceImageRaster: colorSamplerMock.loadStudioReferenceImageRaster,
  };
});

vi.mock("./studio-remote-reference-image-client", () => ({
  importStudioRemoteReferenceImage: remoteReferenceMock.importStudioRemoteReferenceImage,
}));

vi.mock("./studio-reference-panel-preferences-sqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./studio-reference-panel-preferences-sqlite")>();
  return {
    ...actual,
    acquireProductStudioReferencePanelPreferencesRepository: referencePreferencesMock.acquireProduct,
  };
});

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_MISSING = `sha256:${"c".repeat(64)}` as const;

const ASSET_A: StudioAsset = {
  id: "asset-a",
  name: "동작 A",
  dataUrl: "data:image/png;base64,AAAA",
  contentHash: HASH_A,
  width: 800,
  height: 1200,
  createdAt: 2,
};

const ASSET_B: StudioAsset = {
  id: "asset-b",
  name: "동작 B",
  dataUrl: "data:image/webp;base64,BBBB",
  contentHash: HASH_B,
  width: 1200,
  height: 800,
  createdAt: 1,
};

const COLOR_RASTER: StudioReferenceImageRaster = {
  width: 2,
  height: 3,
  data: Uint8ClampedArray.from([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 0, 255,
    1, 2, 3, 0,
    255, 0, 255, 255,
  ]),
};

const REMOTE_BYTES = Uint8Array.from([1, 2, 3]);
const REMOTE_IMPORTED_IMAGE = {
  version: 1 as const,
  mediaType: "image/png" as const,
  byteLength: REMOTE_BYTES.byteLength,
  width: 320,
  height: 180,
  decodedRgbaBytes: 320 * 180 * 4,
  sha256: "d".repeat(64),
  dataUrl: "data:image/png;base64,AQID",
  bytes: REMOTE_BYTES,
  blob: new Blob([REMOTE_BYTES], { type: "image/png" }),
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createReferencePreferencesHarness(
  initialRaw: string | null = null,
  overrides: Partial<StudioAsyncKeyValueStore> = {},
) {
  const values = new Map<string, string>();
  if (initialRaw !== null) values.set(STUDIO_REFERENCE_PANEL_SETTINGS_KEY, initialRaw);
  const store: StudioAsyncKeyValueStore = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    delete: async (key) => { values.delete(key); },
    ...overrides,
  };
  const repository = createStudioReferencePanelPreferencesRepository(store);
  return {
    values,
    store,
    repository,
    acquire: vi.fn(async () => repository),
  };
}

function makeItem(
  id: string,
  sha256 = HASH_A,
  assetId = ASSET_A.id,
  name = ASSET_A.name
): StudioReferenceBoardItem {
  const item = createStudioReferenceBoardItem({
    id,
    asset: {
      sha256,
      assetId,
      name,
      mimeType: "image/png",
      width: 800,
      height: 1200,
    },
    view: {
      centerX: 0.5,
      centerY: 0.5,
      zoom: 1,
      rotationDeg: 0,
      flipX: false,
      flipY: false,
      opacity: 1,
      grayscale: false,
    },
  });
  if (!item) throw new Error("reference item fixture should be valid");
  return item;
}

function ControlledReferencePanel({
  initialDocument,
  onCommit,
  onPickColor,
}: {
  initialDocument: StudioReferenceBoardDocument;
  onCommit: (next: StudioReferenceBoardDocument) => void;
  onPickColor?: (hex: string) => void;
}) {
  const [document, setDocument] = useState(initialDocument);
  return (
    <StudioReferencePanel
      open
      onClose={vi.fn()}
      document={document}
      onPickColor={onPickColor}
      onChange={(next) => {
        onCommit(next);
        setDocument(next);
      }}
    />
  );
}

beforeEach(() => {
  const preferences = createReferencePreferencesHarness();
  referencePreferencesMock.acquireProduct.mockResolvedValue(preferences.repository);
  assetLibraryMock.listAssets.mockResolvedValue([ASSET_A, ASSET_B]);
  assetLibraryMock.ensureStudioAssetContentHash.mockImplementation(async (asset: StudioAsset) => asset);
  let importedAssetIndex = 0;
  assetLibraryMock.saveAsset.mockImplementation(async (input: {
    name: string;
    dataUrl: string;
    width: number;
    height: number;
    contentHash?: string;
  }) => {
    const index = importedAssetIndex;
    importedAssetIndex += 1;
    return {
      id: `imported-${index}`,
      ...input,
      contentHash: (input.contentHash ?? `sha256:${String(index + 1).repeat(64)}`) as `sha256:${string}`,
      createdAt: 10 + index,
    } satisfies StudioAsset;
  });
  canvasImageIoMock.loadImageFileForCanvas.mockImplementation(async (file: File) => ({
    src: `data:image/webp;base64,${file.name}`,
    width: 640,
    height: 480,
    isAnimatedGif: false,
  }));
  colorSamplerMock.loadStudioReferenceImageRaster.mockResolvedValue(COLOR_RASTER);
  remoteReferenceMock.importStudioRemoteReferenceImage.mockResolvedValue(REMOTE_IMPORTED_IMAGE);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StudioReferencePanel controlled reference board", () => {
  it("hydrates its layout from SQLite and persists keyboard layout changes", async () => {
    const preferences = createReferencePreferencesHarness(serializeReferencePanelSettings({
      x: 144,
      y: 120,
      width: 420,
      height: 340,
      assetId: null,
      flipped: false,
    }));
    const { container } = render(
      <StudioReferencePanel
        open
        onClose={vi.fn()}
        document={createStudioReferenceBoardDocument()}
        onChange={vi.fn()}
        acquirePreferences={preferences.acquire}
      />
    );

    const panel = await screen.findByRole("region", { name: "포즈 참고 보드" });
    await waitFor(() => {
      expect(panel.style.left).toBe("144px");
      expect(panel.style.width).toBe("420px");
      expect(panel.getAttribute("data-studio-reference-preferences-authority")).toBe("sqlite-opfs");
    });

    fireEvent.keyDown(screen.getByRole("button", { name: /패널 크기 조절/u }), {
      key: "ArrowRight",
    });
    await waitFor(() => {
      const saved = preferences.values.get(STUDIO_REFERENCE_PANEL_SETTINGS_KEY);
      expect(saved).toContain('"width":436');
    }, { timeout: 1_000 });
    expect(container.textContent).not.toContain("현재 세션 메모리");
  });

  it("keeps a user resize made before hydration and saves that newer layout", async () => {
    const load = deferred<string | null>();
    const preferences = createReferencePreferencesHarness(null, {
      get: vi.fn(async () => load.promise),
    });
    render(
      <StudioReferencePanel
        open
        onClose={vi.fn()}
        document={createStudioReferenceBoardDocument()}
        onChange={vi.fn()}
        acquirePreferences={preferences.acquire}
      />
    );

    const panel = screen.getByRole("region", { name: "포즈 참고 보드" });
    fireEvent.keyDown(screen.getByRole("button", { name: /패널 크기 조절/u }), {
      key: "ArrowLeft",
    });
    expect(panel.style.width).toBe("284px");

    await act(async () => {
      load.resolve(serializeReferencePanelSettings({
        x: 200,
        y: 120,
        width: 500,
        height: 400,
        assetId: null,
        flipped: false,
      }));
      await load.promise;
    });
    await waitFor(() => {
      expect(panel.getAttribute("data-studio-reference-preferences-authority")).toBe("sqlite-opfs");
      expect(panel.style.width).toBe("284px");
    });
    await waitFor(() => {
      expect(preferences.values.get(STUDIO_REFERENCE_PANEL_SETTINGS_KEY)).toContain('"width":284');
    }, { timeout: 1_000 });
  });

  it("stays usable but visibly reports memory-only authority after a SQLite write failure", async () => {
    const preferences = createReferencePreferencesHarness(null, {
      set: vi.fn(async () => { throw new Error("SQLITE_FULL"); }),
    });
    render(
      <StudioReferencePanel
        open
        onClose={vi.fn()}
        document={createStudioReferenceBoardDocument()}
        onChange={vi.fn()}
        acquirePreferences={preferences.acquire}
      />
    );
    const panel = screen.getByRole("region", { name: "포즈 참고 보드" });
    await waitFor(() => {
      expect(panel.getAttribute("data-studio-reference-preferences-authority")).toBe("sqlite-opfs");
    });

    fireEvent.keyDown(screen.getByRole("button", { name: /패널 크기 조절/u }), {
      key: "ArrowLeft",
    });
    expect(panel.style.width).toBe("284px");
    expect((await screen.findByRole("status")).textContent).toContain("현재 세션 메모리");
    expect(panel.getAttribute("data-studio-reference-preferences-authority")).toBe("memory-only");

    fireEvent.keyDown(screen.getByRole("button", { name: /패널 크기 조절/u }), {
      key: "ArrowLeft",
    });
    expect(panel.style.width).toBe("268px");
  });

  it("flushes the newest dirty layout when unmounted before the debounce expires", async () => {
    const preferences = createReferencePreferencesHarness();
    const view = render(
      <StudioReferencePanel
        open
        onClose={vi.fn()}
        document={createStudioReferenceBoardDocument()}
        onChange={vi.fn()}
        acquirePreferences={preferences.acquire}
      />
    );
    const panel = screen.getByRole("region", { name: "포즈 참고 보드" });
    await waitFor(() => {
      expect(panel.getAttribute("data-studio-reference-preferences-authority")).toBe("sqlite-opfs");
    });
    fireEvent.keyDown(screen.getByRole("button", { name: /패널 크기 조절/u }), {
      key: "ArrowLeft",
    });
    view.unmount();

    await waitFor(() => {
      expect(preferences.values.get(STUDIO_REFERENCE_PANEL_SETTINGS_KEY)).toContain('"width":284');
    });
    await expect(preferences.repository.flush()).resolves.toBeUndefined();
  });

  it("never probes or rewrites the discarded localStorage panel setting", async () => {
    window.localStorage.setItem(
      REFERENCE_PANEL_STORAGE_KEY,
      serializeReferencePanelSettings({
        x: 400,
        y: 100,
        width: 500,
        height: 400,
        assetId: ASSET_A.id,
        flipped: true,
      }),
    );
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    try {
      const onCommit = vi.fn();
      const panel = render(
        <ControlledReferencePanel
          initialDocument={createStudioReferenceBoardDocument()}
          onCommit={onCommit}
        />
      );
      await waitFor(() => {
        expect(screen.getByRole("region", { name: "포즈 참고 보드" })
          .getAttribute("data-studio-reference-preferences-authority")).toBe("sqlite-opfs");
      });
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      expect(getItem).not.toHaveBeenCalled();
      expect(setItem).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
      panel.unmount();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
      window.localStorage.clear();
    }
  });

  it("adds the same asset as multiple independent items without putting data URLs in the document", async () => {
    const onCommit = vi.fn();
    render(
      <ControlledReferencePanel
        initialDocument={createStudioReferenceBoardDocument()}
        onCommit={onCommit}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "참고 이미지 추가" }));
    const addAsset = await screen.findByRole("button", { name: "동작 A 보드에 추가" });
    fireEvent.click(addAsset);
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((addAsset as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(addAsset);
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(2));

    const finalDocument = onCommit.mock.calls[1]?.[0] as StudioReferenceBoardDocument;
    expect(finalDocument.items).toHaveLength(2);
    expect(finalDocument.items[0]?.id).not.toBe(finalDocument.items[1]?.id);
    expect(finalDocument.items.map((item) => item.asset.sha256)).toEqual([HASH_A, HASH_A]);
    expect(JSON.stringify(finalDocument)).not.toContain("data:image");
    expect(screen.getByText("2/32")).toBeTruthy();
  });

  it("does not add a library asset whose hash resolves after the document scope changes", async () => {
    const pendingHash = deferred<StudioAsset>();
    assetLibraryMock.ensureStudioAssetContentHash.mockReturnValueOnce(pendingHash.promise);
    const firstOnChange = vi.fn();
    const nextOnChange = vi.fn();
    const firstDocument = createStudioReferenceBoardDocument();
    const nextDocument = createStudioReferenceBoardDocument();
    const view = render(
      <StudioReferencePanel
        open
        onClose={vi.fn()}
        document={firstDocument}
        onChange={firstOnChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "참고 이미지 추가" }));
    fireEvent.click(await screen.findByRole("button", { name: "동작 A 보드에 추가" }));
    await waitFor(() => expect(assetLibraryMock.ensureStudioAssetContentHash).toHaveBeenCalledOnce());

    view.rerender(
      <StudioReferencePanel
        open
        onClose={vi.fn()}
        document={nextDocument}
        onChange={nextOnChange}
      />
    );
    await act(async () => {
      pendingHash.resolve(ASSET_A);
      await pendingHash.promise;
    });

    expect(firstOnChange).not.toHaveBeenCalled();
    expect(nextOnChange).not.toHaveBeenCalled();
    expect(screen.getByText("0/32")).toBeTruthy();
  });

  it("imports multiple device files in source order and commits the board once", async () => {
    const onCommit = vi.fn();
    render(
      <ControlledReferencePanel
        initialDocument={createStudioReferenceBoardDocument()}
        onCommit={onCommit}
      />
    );
    const input = screen.getByLabelText("참고 이미지 파일 선택");
    const files = [
      new File(["png"], "첫 포즈.png", { type: "image/png" }),
      new File(["jpg"], "둘째 포즈.jpg", { type: "image/jpeg" }),
    ];

    fireEvent.change(input, { target: { files } });

    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
    expect(canvasImageIoMock.loadImageFileForCanvas.mock.calls.map(([file]) => file.name))
      .toEqual(["첫 포즈.png", "둘째 포즈.jpg"]);
    expect(assetLibraryMock.saveAsset).toHaveBeenCalledTimes(2);
    const imported = onCommit.mock.calls[0]?.[0] as StudioReferenceBoardDocument;
    expect(imported.items.map((item) => item.asset.name)).toEqual(["첫 포즈", "둘째 포즈"]);
    expect(screen.getByText("2/32")).toBeTruthy();
    expect(screen.getByText("2개 참고 이미지를 추가했습니다.")).toBeTruthy();
  });

  it("imports a public image URL through the bounded server transport and persists only its hash reference", async () => {
    const onCommit = vi.fn();
    render(
      <ControlledReferencePanel
        initialDocument={createStudioReferenceBoardDocument()}
        onCommit={onCommit}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "참고 이미지 추가" }));
    fireEvent.change(screen.getByLabelText("공개 이미지 URL"), {
      target: { value: "https://images.example.test/poses/running.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "가져오기" }));

    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
    expect(remoteReferenceMock.importStudioRemoteReferenceImage).toHaveBeenCalledWith(
      "https://images.example.test/poses/running.png",
      expect.any(AbortSignal)
    );
    expect(assetLibraryMock.saveAsset).toHaveBeenCalledWith(expect.objectContaining({
      name: "running",
      width: 320,
      height: 180,
      kind: "remote-reference",
      contentHash: `sha256:${"d".repeat(64)}`,
    }));
    const committed = onCommit.mock.calls[0]?.[0] as StudioReferenceBoardDocument;
    expect(committed.items[0]?.asset.sha256).toBe(`sha256:${"d".repeat(64)}`);
    expect(JSON.stringify(committed)).not.toContain("images.example.test");
    expect(JSON.stringify(committed)).not.toContain("data:image");
  });

  it("does not continue a remote import after the panel unmounts", async () => {
    const pendingImport = deferred<typeof REMOTE_IMPORTED_IMAGE>();
    remoteReferenceMock.importStudioRemoteReferenceImage.mockReturnValueOnce(pendingImport.promise);
    const onChange = vi.fn();
    const { unmount } = render(
      <StudioReferencePanel
        open
        onClose={vi.fn()}
        document={createStudioReferenceBoardDocument()}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "참고 이미지 추가" }));
    fireEvent.change(screen.getByLabelText("공개 이미지 URL"), {
      target: { value: "https://images.example.test/unmount.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "가져오기" }));
    await waitFor(() => expect(remoteReferenceMock.importStudioRemoteReferenceImage).toHaveBeenCalledOnce());

    unmount();
    await act(async () => {
      pendingImport.resolve(REMOTE_IMPORTED_IMAGE);
      await pendingImport.promise;
    });

    expect(assetLibraryMock.saveAsset).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not commit a remote asset saved after the controlled document scope changes", async () => {
    const pendingSave = deferred<StudioAsset>();
    assetLibraryMock.saveAsset.mockReturnValueOnce(pendingSave.promise);
    const firstOnChange = vi.fn();
    const nextOnChange = vi.fn();
    const firstDocument = createStudioReferenceBoardDocument();
    const nextDocument = createStudioReferenceBoardDocument([makeItem("next-work")]);
    const view = render(
      <StudioReferencePanel
        open
        onClose={vi.fn()}
        document={firstDocument}
        onChange={firstOnChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "참고 이미지 추가" }));
    fireEvent.change(screen.getByLabelText("공개 이미지 URL"), {
      target: { value: "https://images.example.test/slow-save.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "가져오기" }));
    await waitFor(() => expect(assetLibraryMock.saveAsset).toHaveBeenCalledOnce());

    view.rerender(
      <StudioReferencePanel
        open
        onClose={vi.fn()}
        document={nextDocument}
        onChange={nextOnChange}
      />
    );
    await act(async () => {
      pendingSave.resolve({
        id: "late-remote",
        name: "slow-save",
        dataUrl: REMOTE_IMPORTED_IMAGE.dataUrl,
        contentHash: `sha256:${REMOTE_IMPORTED_IMAGE.sha256}`,
        width: REMOTE_IMPORTED_IMAGE.width,
        height: REMOTE_IMPORTED_IMAGE.height,
        createdAt: 99,
      });
      await pendingSave.promise;
    });

    expect(firstOnChange).not.toHaveBeenCalled();
    expect(nextOnChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "동작 A 이동 및 선택" })).toBeTruthy();
  });

  it("drops a local decode continuation when the panel closes", async () => {
    const pendingDecode = deferred<{
      src: string;
      width: number;
      height: number;
      isAnimatedGif: boolean;
    }>();
    canvasImageIoMock.loadImageFileForCanvas.mockReturnValueOnce(pendingDecode.promise);
    const onChange = vi.fn();
    const document = createStudioReferenceBoardDocument();
    const view = render(
      <StudioReferencePanel
        open
        onClose={vi.fn()}
        document={document}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByLabelText("참고 이미지 파일 선택"), {
      target: { files: [new File(["png"], "slow-local.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(canvasImageIoMock.loadImageFileForCanvas).toHaveBeenCalledOnce());

    view.rerender(
      <StudioReferencePanel
        open={false}
        onClose={vi.fn()}
        document={document}
        onChange={onChange}
      />
    );
    await act(async () => {
      pendingDecode.resolve({
        src: "data:image/webp;base64,LATE",
        width: 640,
        height: 480,
        isAnimatedGif: false,
      });
      await pendingDecode.promise;
    });

    expect(assetLibraryMock.saveAsset).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lets a reopened panel finish a newer import without resurrecting the older continuation", async () => {
    const firstImport = deferred<typeof REMOTE_IMPORTED_IMAGE>();
    remoteReferenceMock.importStudioRemoteReferenceImage
      .mockReturnValueOnce(firstImport.promise)
      .mockResolvedValueOnce(REMOTE_IMPORTED_IMAGE);
    const onChange = vi.fn();
    const document = createStudioReferenceBoardDocument();
    const view = render(
      <StudioReferencePanel
        open
        onClose={vi.fn()}
        document={document}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "참고 이미지 추가" }));
    const urlInput = screen.getByLabelText("공개 이미지 URL");
    fireEvent.change(urlInput, { target: { value: "https://images.example.test/old.png" } });
    fireEvent.click(screen.getByRole("button", { name: "가져오기" }));
    await waitFor(() => expect(remoteReferenceMock.importStudioRemoteReferenceImage).toHaveBeenCalledOnce());

    view.rerender(
      <StudioReferencePanel
        open={false}
        onClose={vi.fn()}
        document={document}
        onChange={onChange}
      />
    );
    view.rerender(
      <StudioReferencePanel
        open
        onClose={vi.fn()}
        document={document}
        onChange={onChange}
      />
    );
    await waitFor(() => expect(
      (screen.getByRole("button", { name: "가져오기" }) as HTMLButtonElement).disabled
    ).toBe(false));
    fireEvent.change(screen.getByLabelText("공개 이미지 URL"), {
      target: { value: "https://images.example.test/new.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "가져오기" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());

    await act(async () => {
      firstImport.resolve(REMOTE_IMPORTED_IMAGE);
      await firstImport.promise;
    });
    expect(onChange).toHaveBeenCalledOnce();
    expect(assetLibraryMock.saveAsset).toHaveBeenCalledOnce();
  });

  it("accepts board drops and image clipboard pastes as separate durable commits", async () => {
    const onCommit = vi.fn();
    render(
      <ControlledReferencePanel
        initialDocument={createStudioReferenceBoardDocument()}
        onCommit={onCommit}
      />
    );
    const dropzone = screen.getByTestId("reference-board-dropzone");
    const dropped = new File(["png"], "드롭.png", { type: "image/png" });
    // The callback precedes the controlled owner's render. Complete that render and its
    // document-scope effects before starting a second, independent import transaction.
    await act(async () => {
      fireEvent.drop(dropzone, {
        dataTransfer: { files: [dropped], types: ["Files"], dropEffect: "none" },
      });
    });
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "드롭 이동 및 선택" })).toBeTruthy();
    expect(screen.getByText("1/32")).toBeTruthy();

    const pasted = new File(["GIF89a"], "붙여넣기.gif", { type: "image/gif" });
    await act(async () => {
      fireEvent.paste(window, {
        clipboardData: { files: [pasted], items: [] },
      });
    });
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(2));

    const imported = onCommit.mock.calls[1]?.[0] as StudioReferenceBoardDocument;
    expect(imported.items.map((item) => item.asset.name)).toEqual(["드롭", "붙여넣기"]);
    expect(assetLibraryMock.saveAsset).toHaveBeenCalledTimes(2);
    expect(canvasImageIoMock.loadImageFileForCanvas.mock.calls.map(([file]) => file.name))
      .toEqual(["드롭.png", "붙여넣기.gif"]);
    expect(await screen.findByRole("button", { name: "붙여넣기 이동 및 선택" })).toBeTruthy();
    expect(screen.getByText("2/32")).toBeTruthy();
  });

  it("resolves bytes by content hash before the legacy assetId hint", async () => {
    const conflictingHintItem = makeItem("ref-a", HASH_A, ASSET_B.id, "문서 이름");
    render(
      <ControlledReferencePanel
        initialDocument={createStudioReferenceBoardDocument([conflictingHintItem])}
        onCommit={vi.fn()}
      />
    );

    expect(await screen.findByRole("button", { name: "동작 A 이동 및 선택" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "동작 B 이동 및 선택" })).toBeNull();
  });

  it("keeps an unresolved hash selectable and lets the user delete its placeholder", async () => {
    const onCommit = vi.fn();
    const missingItem = makeItem("ref-missing", HASH_MISSING, "gone", "삭제된 포즈");
    render(
      <ControlledReferencePanel
        initialDocument={createStudioReferenceBoardDocument([missingItem])}
        onCommit={onCommit}
      />
    );

    expect(await screen.findByRole("button", { name: "삭제된 포즈 이동 및 선택" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "선택 이미지 속성" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 이미지 삭제" }));

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0]?.[0].items).toEqual([]);
  });

  it("keeps the controlled document and selection intact when the editor rejects a locked commit", async () => {
    const document = createStudioReferenceBoardDocument([makeItem("ref-locked")]);
    const onChange = vi.fn((_next: StudioReferenceBoardDocument) => false);
    render(
      <StudioReferencePanel
        open
        onClose={vi.fn()}
        document={document}
        onChange={onChange}
      />
    );

    const item = await screen.findByRole("button", { name: "동작 A 이동 및 선택" });
    fireEvent.click(screen.getByRole("button", { name: "선택 이미지 속성" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 이미지 삭제" }));

    expect(onChange).toHaveBeenCalledOnce();
    const rejectedDocument = onChange.mock.calls.at(0)?.[0];
    expect(rejectedDocument?.items).toEqual([]);
    expect(item.isConnected).toBe(true);
    expect(screen.getByRole("button", { name: "선택 이미지 삭제" })).toBeTruthy();
  });

  it("previews an item drag locally and commits the normalized final position once", async () => {
    const onCommit = vi.fn();
    render(
      <ControlledReferencePanel
        initialDocument={createStudioReferenceBoardDocument([makeItem("ref-drag")])}
        onCommit={onCommit}
      />
    );
    const item = await screen.findByRole("button", { name: "동작 A 이동 및 선택" });
    const canvas = screen.getByTestId("reference-board-canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(item, { pointerId: 7, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(item, { pointerId: 7, clientX: 90, clientY: 60 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(item.style.left).toBe("70%");
    expect(item.style.top).toBe("60%");

    fireEvent.pointerUp(item, { pointerId: 7, clientX: 90, clientY: 60 });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0]?.[0].items[0]?.view).toMatchObject({ centerX: 0.7, centerY: 0.6 });
  });

  it("rolls a cancelled item drag back without creating a document commit", async () => {
    const onCommit = vi.fn();
    render(
      <ControlledReferencePanel
        initialDocument={createStudioReferenceBoardDocument([makeItem("ref-cancel")])}
        onCommit={onCommit}
      />
    );
    const item = await screen.findByRole("button", { name: "동작 A 이동 및 선택" });
    const canvas = screen.getByTestId("reference-board-canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(item, { pointerId: 9, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(item, { pointerId: 9, clientX: 90, clientY: 60 });
    fireEvent.pointerCancel(item, { pointerId: 9 });

    expect(onCommit).not.toHaveBeenCalled();
    expect(item.style.left).toBe("50%");
    expect(item.style.top).toBe("50%");

    fireEvent.pointerDown(item, { pointerId: 10, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(item, { pointerId: 10, clientX: 70, clientY: 70 });
    fireEvent.lostPointerCapture(item, { pointerId: 10 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(item.style.left).toBe("50%");
    expect(item.style.top).toBe("50%");
  });

  it("coalesces range previews into one transform commit and does not double-commit on blur", async () => {
    const onCommit = vi.fn();
    render(
      <ControlledReferencePanel
        initialDocument={createStudioReferenceBoardDocument([makeItem("ref-transform")])}
        onCommit={onCommit}
      />
    );
    await screen.findByRole("button", { name: "동작 A 이동 및 선택" });
    fireEvent.click(screen.getByRole("button", { name: "선택 이미지 속성" }));
    const zoom = screen.getByRole("slider", { name: "선택 이미지 크기" });

    fireEvent.pointerDown(zoom, { pointerId: 3 });
    fireEvent.change(zoom, { target: { value: "125" } });
    fireEvent.change(zoom, { target: { value: "150" } });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText("150%")).toBeTruthy();

    fireEvent.pointerUp(zoom, { pointerId: 3 });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0]?.[0].items[0]?.view.zoom).toBe(1.5);
    fireEvent.blur(zoom);
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it("extracts a six-color local palette and forwards a selected swatch without a document commit", async () => {
    const onCommit = vi.fn();
    const onPickColor = vi.fn();
    render(
      <ControlledReferencePanel
        initialDocument={createStudioReferenceBoardDocument([makeItem("ref-colors")])}
        onCommit={onCommit}
        onPickColor={onPickColor}
      />
    );

    await screen.findByRole("button", { name: "동작 A 이동 및 선택" });
    fireEvent.click(screen.getByRole("button", { name: "선택 이미지 속성" }));
    const red = await screen.findByRole("button", { name: "#ff0000 색상 선택" });

    expect(colorSamplerMock.loadStudioReferenceImageRaster).toHaveBeenCalledWith(
      ASSET_A.dataUrl,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    fireEvent.click(red);

    expect(onPickColor).toHaveBeenCalledOnce();
    expect(onPickColor).toHaveBeenCalledWith("#ff0000");
    expect(red.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("#ff0000 색상을 기본색으로 선택했습니다.")).toBeTruthy();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("samples the transformed selected image by pointer and keyboard, and Escape exits eyedropper mode", async () => {
    const onPickColor = vi.fn();
    render(
      <ControlledReferencePanel
        initialDocument={createStudioReferenceBoardDocument([makeItem("ref-eyedropper")])}
        onCommit={vi.fn()}
        onPickColor={onPickColor}
      />
    );

    const initialItem = await screen.findByRole("button", { name: "동작 A 이동 및 선택" });
    const canvas = screen.getByTestId("reference-board-canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });
    fireEvent.click(screen.getByRole("button", { name: "선택 이미지 속성" }));
    await screen.findByRole("button", { name: "#ffff00 색상 선택" });

    const toggle = screen.getByRole("button", { name: "참고 이미지 스포이드 켜기" });
    fireEvent.click(toggle);
    const samplingItem = screen.getByRole("button", { name: "동작 A 색상 추출" });
    fireEvent.pointerDown(samplingItem, { pointerId: 21, button: 0, clientX: 100, clientY: 50 });
    expect(onPickColor).toHaveBeenLastCalledWith("#ffff00");

    fireEvent.keyDown(samplingItem, { key: "Escape" });
    expect(screen.getByRole("button", { name: "참고 이미지 스포이드 켜기" }).getAttribute("aria-pressed"))
      .toBe("false");
    expect(screen.getByRole("button", { name: "동작 A 이동 및 선택" })).toBe(initialItem);

    fireEvent.click(screen.getByRole("button", { name: "참고 이미지 스포이드 켜기" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "동작 A 색상 추출" }), { key: "Enter" });
    expect(onPickColor).toHaveBeenCalledTimes(2);
    expect(onPickColor).toHaveBeenLastCalledWith("#ffff00");
  });

  it("reports local color-analysis failures and retries without changing the board", async () => {
    colorSamplerMock.loadStudioReferenceImageRaster.mockRejectedValueOnce(new Error("픽셀 디코드 실패"));
    const onCommit = vi.fn();
    render(
      <ControlledReferencePanel
        initialDocument={createStudioReferenceBoardDocument([makeItem("ref-retry")])}
        onCommit={onCommit}
        onPickColor={vi.fn()}
      />
    );

    await screen.findByRole("button", { name: "동작 A 이동 및 선택" });
    fireEvent.click(screen.getByRole("button", { name: "선택 이미지 속성" }));
    expect((await screen.findByRole("alert")).textContent).toContain("픽셀 디코드 실패");

    fireEvent.click(screen.getByRole("button", { name: "다시 분석" }));
    expect(await screen.findByRole("button", { name: "#ffff00 색상 선택" })).toBeTruthy();
    expect(colorSamplerMock.loadStudioReferenceImageRaster).toHaveBeenCalledTimes(2);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("promotes a SQLite-loaded pinned workspace image once, including its flip state", async () => {
    const preferences = createReferencePreferencesHarness(serializeReferencePanelSettings({
      x: 400,
      y: 100,
      width: 300,
      height: 260,
      assetId: ASSET_A.id,
      flipped: true,
    }));
    referencePreferencesMock.acquireProduct.mockResolvedValue(preferences.repository);
    const onCommit = vi.fn();
    render(
      <ControlledReferencePanel
        initialDocument={createStudioReferenceBoardDocument()}
        onCommit={onCommit}
      />
    );

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    const migrated = onCommit.mock.calls[0]?.[0] as StudioReferenceBoardDocument;
    expect(migrated.items).toHaveLength(1);
    expect(migrated.items[0]?.asset.sha256).toBe(HASH_A);
    expect(migrated.items[0]?.view.flipX).toBe(true);

    await new Promise((resolve) => window.setTimeout(resolve, 220));
    const stored = preferences.values.get(STUDIO_REFERENCE_PANEL_SETTINGS_KEY);
    expect(stored).not.toContain(ASSET_A.id);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("does not promote a SQLite-loaded pinned hash into a replacement document", async () => {
    const preferences = createReferencePreferencesHarness(serializeReferencePanelSettings({
      x: 400,
      y: 100,
      width: 300,
      height: 260,
      assetId: ASSET_A.id,
      flipped: false,
    }));
    referencePreferencesMock.acquireProduct.mockResolvedValue(preferences.repository);
    const pendingHash = deferred<StudioAsset>();
    assetLibraryMock.ensureStudioAssetContentHash.mockReturnValueOnce(pendingHash.promise);
    const firstOnChange = vi.fn();
    const nextOnChange = vi.fn();
    const firstDocument = createStudioReferenceBoardDocument();
    const nextDocument = createStudioReferenceBoardDocument();
    const view = render(
      <StudioReferencePanel
        open
        onClose={vi.fn()}
        document={firstDocument}
        onChange={firstOnChange}
      />
    );
    await waitFor(() => expect(assetLibraryMock.ensureStudioAssetContentHash).toHaveBeenCalledOnce());

    view.rerender(
      <StudioReferencePanel
        open
        onClose={vi.fn()}
        document={nextDocument}
        onChange={nextOnChange}
      />
    );
    await act(async () => {
      pendingHash.resolve(ASSET_A);
      await pendingHash.promise;
    });

    expect(firstOnChange).not.toHaveBeenCalled();
    expect(nextOnChange).not.toHaveBeenCalled();
    expect(screen.getByText("0/32")).toBeTruthy();
  });
});
