import {
  IDBFactory,
  IDBObjectStore as FakeIDBObjectStore,
} from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmptyAnimationTimelineDoc } from "./studio-anim-tracks";

import type { El } from "./studio-element-model";
import type { PageState } from "./studio-page-state";

function pageFixture(overrides: Partial<PageState> = {}): PageState {
  return {
    id: "page-1",
    name: "옥상 장면",
    note: "해질녘 재회",
    elements: [
      {
        id: "bubble-1",
        type: "bubble",
        variant: "speech",
        text: "다시 만났네.",
        x: 20,
        y: 30,
        width: 220,
        height: 100,
        fill: "#ffffff",
        textFill: "#111111",
        rotation: 0,
      },
    ] as El[],
    bg: "#f8efe8",
    bgGrad: ["#f8efe8", "#dd9b78"],
    canvasH: 1_600,
    animTimeline: createEmptyAnimationTimelineDoc(24, 12),
    ...overrides,
  };
}

async function loadLibrary(factory = new IDBFactory()) {
  vi.stubGlobal("indexedDB", factory);
  vi.resetModules();
  const library = await import("./studio-scene-snapshot-library");
  return { factory, library };
}

async function openDatabase(
  factory: IDBFactory,
  name: string,
  version: number
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putRaw(database: IDBDatabase, raw: Record<string, unknown>): Promise<void> {
  const transaction = database.transaction("snapshots", "readwrite");
  transaction.objectStore("snapshots").put(raw);
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Studio scene snapshot personal library", () => {
  it("captures a structured-clone-isolated whole page and round-trips it through IndexedDB", async () => {
    const { library } = await loadLibrary();
    const source = pageFixture();
    const snapshot = library.createStudioSceneSnapshot(
      {
        name: "  옥상 재회  ",
        tags: ["로맨스", " 옥상 ", "로맨스"],
        page: source,
        theme: "soft",
        sourceWorkId: "work-7",
      },
      { id: "scene-rooftop", now: 1_000 }
    );

    (source.elements[0] as { text: string }).text = "원본 변경";
    expect((snapshot.page.elements[0] as { text: string }).text).toBe("다시 만났네.");
    expect(snapshot).toMatchObject({
      id: "scene-rooftop",
      name: "옥상 재회",
      tags: ["로맨스", "옥상"],
      version: 1,
      createdAt: 1_000,
      updatedAt: 1_000,
      sourceWorkId: "work-7",
      theme: "soft",
    });

    const saved = await library.saveStudioSceneSnapshot(snapshot);
    expect(saved).toHaveLength(1);
    (saved[0]!.page.elements[0] as { text: string }).text = "반환값 변경";
    const reloaded = await library.listStudioSceneSnapshots();
    expect((reloaded[0]!.page.elements[0] as { text: string }).text).toBe("다시 만났네.");
    expect(reloaded[0]!.page.animTimeline).toEqual(source.animTimeline);
  });

  it("searches metadata and page notes, duplicates versions, and deletes atomically", async () => {
    const { library } = await loadLibrary();
    const original = library.createStudioSceneSnapshot(
      {
        name: "옥상 재회",
        tags: ["로맨스", "해질녘"],
        page: pageFixture(),
        theme: "vivid",
      },
      { id: "scene-original", now: 2_000 }
    );
    await library.saveStudioSceneSnapshot(original);

    const matches = library.filterStudioSceneSnapshots(
      await library.listStudioSceneSnapshots(),
      "로맨스 재회"
    );
    expect(matches.map((entry) => entry.id)).toEqual(["scene-original"]);

    const duplicated = await library.duplicateStudioSceneSnapshot("scene-original", {
      id: "scene-copy",
      now: 3_000,
    });
    expect(duplicated).toHaveLength(2);
    expect(duplicated.find((entry) => entry.id === "scene-copy")).toMatchObject({
      name: "옥상 재회 복사본",
      version: 2,
      createdAt: 3_000,
      updatedAt: 3_000,
      theme: "vivid",
    });

    const remaining = await library.deleteStudioSceneSnapshot("scene-original");
    expect(remaining.map((entry) => entry.id)).toEqual(["scene-copy"]);
  });

  it("resolves save only after the readwrite transaction completes", async () => {
    const { library } = await loadLibrary();
    const originalPut = FakeIDBObjectStore.prototype.put;
    let putSucceeded!: () => void;
    const putSuccess = new Promise<void>((resolve) => {
      putSucceeded = resolve;
    });
    vi.spyOn(FakeIDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const request = originalPut.apply(this, args as Parameters<typeof originalPut>);
      request.addEventListener("success", () => putSucceeded(), { once: true });
      return request;
    });

    const snapshot = library.createStudioSceneSnapshot(
      { name: "원자 저장", page: pageFixture(), theme: "classic" },
      { id: "scene-atomic", now: 4_000 }
    );
    let settled = false;
    const saving = library.saveStudioSceneSnapshot(snapshot).finally(() => {
      settled = true;
    });

    await putSuccess;
    expect(settled).toBe(false);
    await expect(saving).resolves.toHaveLength(1);
  });

  it("excludes corrupt rows from reads and refuses to mutate across corrupt storage", async () => {
    const { factory, library } = await loadLibrary();
    const valid = library.createStudioSceneSnapshot(
      { name: "정상", page: pageFixture(), theme: "soft" },
      { id: "scene-valid", now: 5_000 }
    );
    await library.saveStudioSceneSnapshot(valid);
    const database = await openDatabase(
      factory,
      library.STUDIO_SCENE_SNAPSHOT_DATABASE_NAME,
      library.STUDIO_SCENE_SNAPSHOT_DATABASE_VERSION
    );
    await putRaw(database, {
      kind: "toonspectrum-studio-scene-snapshot",
      schemaVersion: 1,
      id: "scene-corrupt",
      name: "손상",
      tags: [],
      version: 1,
      createdAt: 5_001,
      updatedAt: 5_001,
      sourceWorkId: null,
      byteSize: 100,
      payloadJson: "{broken",
    });

    await expect(library.listStudioSceneSnapshots()).resolves.toMatchObject([
      { id: "scene-valid" },
    ]);
    const next = library.createStudioSceneSnapshot(
      { name: "추가", page: pageFixture(), theme: "classic" },
      { id: "scene-next", now: 5_002 }
    );
    await expect(library.saveStudioSceneSnapshot(next)).rejects.toMatchObject({
      code: "corrupt-data",
    });
    database.close();
  });

  it("fails closed for malformed pages and noncanonical animation timelines", async () => {
    const { library } = await loadLibrary();

    expect(() =>
      library.createStudioSceneSnapshot(
        {
          name: "잘못된 페이지",
          page: pageFixture({ canvasH: -1 }),
          theme: "soft",
        },
        { id: "scene-invalid-page", now: 6_000 }
      )
    ).toThrow(expect.objectContaining({ code: "invalid-entry" }));

    expect(() =>
      library.createStudioSceneSnapshot(
        {
          name: "잘못된 타임라인",
          page: pageFixture({
            animTimeline: {
              fps: 0,
              frameCount: 999,
              tracks: {},
            },
          }),
          theme: "soft",
        },
        { id: "scene-invalid-timeline", now: 6_001 }
      )
    ).toThrow(expect.objectContaining({ code: "invalid-entry" }));
  });

  it("accepts a canonical timeline regardless of harmless object key order", async () => {
    const { library } = await loadLibrary();
    const timeline = createEmptyAnimationTimelineDoc(24, 12);
    const reorderedTimeline = {
      tracks: timeline.tracks,
      frameCount: timeline.frameCount,
      fps: timeline.fps,
    };

    expect(() =>
      library.createStudioSceneSnapshot(
        {
          name: "타임라인 순서",
          page: pageFixture({ animTimeline: reorderedTimeline }),
          theme: "soft",
        },
        { id: "scene-timeline-order", now: 6_100 }
      )
    ).not.toThrow();
  });

  it("enforces data URL, 3D payload, item, entry and total byte budgets", async () => {
    const { library } = await loadLibrary();
    const oversizedDataUrl = `data:image/png;base64,${"a".repeat(
      library.STUDIO_SCENE_SNAPSHOT_DATA_URL_MAX_BYTES
    )}`;
    expect(() =>
      library.createStudioSceneSnapshot(
        {
          name: "대형 이미지",
          page: pageFixture({
            elements: [
              {
                id: "image-large",
                type: "image",
                src: oversizedDataUrl,
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                rotation: 0,
              } as El,
            ],
          }),
          theme: "soft",
        },
        { id: "scene-large-image", now: 7_000 }
      )
    ).toThrow(expect.objectContaining({ code: "data-url-too-large" }));

    expect(() =>
      library.createStudioSceneSnapshot(
        {
          name: "대형 3D",
          page: pageFixture({
            elements: [
              {
                id: "image-3d",
                type: "image",
                src: "asset://preview",
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                rotation: 0,
                bg3dScene: {
                  payload: "x".repeat(
                    library.STUDIO_SCENE_SNAPSHOT_3D_PAYLOAD_MAX_BYTES
                  ),
                },
              } as unknown as El,
            ],
          }),
          theme: "soft",
        },
        { id: "scene-large-3d", now: 7_001 }
      )
    ).toThrow(expect.objectContaining({ code: "3d-payload-too-large" }));

    const fullEntries = Array.from(
      { length: library.STUDIO_SCENE_SNAPSHOT_MAX_ENTRIES },
      (_, index) => ({ id: `scene-${index}`, byteSize: 1 })
    );
    expect(() =>
      library.assertStudioSceneSnapshotLibraryBudget(fullEntries, {
        id: "scene-new",
        byteSize: 1,
      })
    ).toThrow(expect.objectContaining({ code: "max-entries" }));

    expect(() =>
      library.assertStudioSceneSnapshotLibraryBudget(
        [{ id: "scene-a", byteSize: library.STUDIO_SCENE_SNAPSHOT_TOTAL_MAX_BYTES }],
        { id: "scene-b", byteSize: 1 }
      )
    ).toThrow(expect.objectContaining({ code: "total-too-large" }));
  });
});
