import { describe, expect, it } from "vitest";

import {
  StudioCrdtDocument,
  type StudioCrdtLayerGroupInput,
} from "./studio-crdt-document";
import { reconcileStudioCrdtSceneGraphHistory } from "./studio-crdt-history";
import {
  reconcileStudioCrdtSceneGraphPages,
  studioCrdtElementToSceneElement,
  studioElementToCrdtSceneElement,
} from "./studio-crdt-page-bridge";
import { publishStudioCrdtSceneGraphDiff } from "./studio-crdt-scene-publisher";

const FILTER_MASK_SURFACE_ID =
  "filter-mask:v1:10000000-0000-4000-8000-000000000001";

interface TestElement {
  id: string;
  type: string;
  groupId?: string;
  src?: string;
  x?: number;
  [key: string]: unknown;
}

interface TestGroup {
  id: string;
  name: string;
  hidden?: boolean;
  locked?: boolean;
}

interface TestPage {
  id: string;
  elements: TestElement[];
  groups: TestGroup[];
  bg: string;
  bgGrad: string[] | null;
  canvasH: number;
  note?: string;
}

function page(
  id: string,
  elements: TestElement[] = [],
  groups: TestGroup[] = [],
  note?: string
): TestPage {
  return { id, elements, groups, bg: "#ffffff", bgGrad: null, canvasH: 1600, note };
}

function group(id: string, name = id): TestGroup {
  return { id, name };
}

function groupInput(pageId: string, id: string): StudioCrdtLayerGroupInput {
  return { id, pageId, payload: { version: 1, props: { name: id } } };
}

function asset(
  id: string,
  type: string,
  src: string,
  groupId?: string,
  x = 10
): TestElement {
  return {
    id,
    type,
    src,
    groupId,
    x,
    y: 20,
    width: 300,
    height: 400,
    rotation: 5,
    opacity: 0.8,
    locked: false,
    flipped: true,
    blur: 4,
    authoredMetadata: { keep: true },
  };
}

function converge(left: StudioCrdtDocument, right: StudioCrdtDocument, base: StudioCrdtDocument) {
  const baseVector = base.encodeStateVector();
  const leftUpdate = left.encodeStateAsUpdate(baseVector);
  const rightUpdate = right.encodeStateAsUpdate(baseVector);
  left.applyUpdate(rightUpdate);
  right.applyUpdate(leftUpdate);
}

function reconcile(document: StudioCrdtDocument, pages: readonly TestPage[]): TestPage[] {
  return reconcileStudioCrdtSceneGraphPages(
    pages,
    document.getStrokes({ includeDeleted: true }),
    document.getSceneElements({ includeDeleted: true }),
    document.getPages(true),
    document.getLayerGroups({ includeDeleted: true })
  ).pages;
}

describe("studio CRDT universal reference topology", () => {
  it("keeps deployed topology-only images readable, then upgrades exact admitted assets", () => {
    const document = new StudioCrdtDocument();
    document.addLayerGroup(groupInput("page-a", "backgrounds"));
    const localImage = asset(
      "image-a",
      "image",
      `data:image/png;base64,${"A".repeat(80 * 1024)}`,
      "backgrounds"
    );
    publishStudioCrdtSceneGraphDiff(
      document,
      [page("page-a", [], [group("backgrounds")])],
      [page("page-a", [localImage], [group("backgrounds")])]
    );
    expect(document.getSceneElement("image-a", true)).toMatchObject({
      payload: { type: "reference", props: { elementType: "image" } },
    });
    expect(document.getSceneElement("image-a", true)?.payload.props).toEqual({
      elementType: "image",
    });
    expect(JSON.stringify(document.getSceneElement("image-a", true))).not.toContain("base64");
    expect(studioCrdtElementToSceneElement(
      document.getSceneElement("image-a")!,
      localImage
    )).toMatchObject({
      id: "image-a",
      src: localImage.src,
      x: 10,
    });

    const admittedImage = {
      ...localImage,
      src: "work-asset://image/image-a",
    };
    const background3d = asset(
      "scene-3d",
      "background3d",
      "work-asset://background3d/scene-3d",
      "backgrounds",
      40
    );
    const encodedImage = studioElementToCrdtSceneElement("page-a", admittedImage);
    const encoded3d = studioElementToCrdtSceneElement("page-a", background3d);

    expect(encodedImage).toMatchObject({
      id: "image-a",
      pageId: "page-a",
      layerId: "backgrounds",
      payload: {
        version: 1,
        type: "reference",
        props: {
          elementType: "image",
          x: 10,
          y: 20,
          width: 300,
          height: 400,
          rotation: 5,
          opacity: 0.8,
          locked: false,
          flipped: true,
          blur: 4,
        },
      },
    });
    expect(JSON.stringify(encodedImage)).not.toContain("base64");
    expect(encoded3d.payload).toMatchObject({
      version: 1,
      type: "reference",
      props: { elementType: "background3d", x: 40, width: 300 },
    });

    publishStudioCrdtSceneGraphDiff(
      document,
      [page("page-a", [localImage], [group("backgrounds")])],
      [page("page-a", [admittedImage], [group("backgrounds")])]
    );
    expect(document.getSceneElement("image-a")?.payload.props).toMatchObject({
      elementType: "image",
      x: 10,
      y: 20,
      width: 300,
      height: 400,
      rotation: 5,
    });
    document.addSceneElement(encoded3d, "image-a");
    expect(() => studioCrdtElementToSceneElement(document.getSceneElement("image-a")!))
      .toThrow("원본 에셋");
    expect(studioCrdtElementToSceneElement(
      document.getSceneElement("image-a")!,
      admittedImage
    )).toMatchObject({
      id: "image-a",
      type: "image",
      src: admittedImage.src,
      authoredMetadata: { keep: true },
      groupId: "backgrounds",
    });

    const result = reconcile(document, [
      page("page-a", [admittedImage, background3d], [group("backgrounds")]),
    ]);
    expect(result[0]!.elements.map(({ id }) => id)).toEqual(["scene-3d", "image-a"]);
    expect(result[0]!.elements[0]).toMatchObject({
      type: "background3d",
      src: "work-asset://background3d/scene-3d",
      groupId: "backgrounds",
      authoredMetadata: { keep: true },
    });
    expect(result[0]!.elements[1]!.src).toBe("work-asset://image/image-a");
    expect(JSON.stringify(result)).not.toContain("base64");
    document.destroy();
  });

  it("syncs an immutable mask binding without admitting or leaking a local image body", () => {
    const localImage = {
      ...asset(
        "masked-image",
        "image",
        "data:image/png;base64,local-image",
      ),
      filterMaskSurfaceId: FILTER_MASK_SURFACE_ID,
      filterMaskEnabled: true,
      filterMaskSrc: "data:image/png;base64,legacy-local-mask",
    };
    const encoded = studioElementToCrdtSceneElement("page-a", localImage);

    expect(encoded.payload).toEqual({
      version: 1,
      type: "reference",
      props: {
        elementType: "image",
        filterMaskSurfaceId: FILTER_MASK_SURFACE_ID,
        filterMaskEnabled: true,
      },
    });
    expect(JSON.stringify(encoded)).not.toContain("local-image");
    expect(JSON.stringify(encoded)).not.toContain("legacy-local-mask");
    expect(studioCrdtElementToSceneElement({
      ...encoded,
      deleted: false,
      orderIndex: 0,
    }, localImage)).toMatchObject({
      id: localImage.id,
      src: localImage.src,
      filterMaskSurfaceId: FILTER_MASK_SURFACE_ID,
      filterMaskEnabled: true,
    });

    const admittedImage = {
      ...localImage,
      src: "work-asset://image/masked-image",
    };
    expect(studioElementToCrdtSceneElement("page-a", admittedImage).payload.props).toMatchObject({
      elementType: "image",
      x: 10,
      y: 20,
      width: 300,
      height: 400,
      rotation: 5,
      filterMaskSurfaceId: FILTER_MASK_SURFACE_ID,
      filterMaskEnabled: true,
    });

    const malformedMaskImage: TestElement = {
      ...localImage,
      filterMaskSurfaceId: "data:image/png;base64,AA==",
    };
    const maskedModel: TestElement = {
      ...asset("model", "vrm", "data:model/gltf-binary;base64,AA=="),
      filterMaskSurfaceId: FILTER_MASK_SURFACE_ID,
    };
    expect(() => studioElementToCrdtSceneElement("page-a", malformedMaskImage))
      .toThrow("surface ID");
    expect(() => studioElementToCrdtSceneElement("page-a", maskedModel))
      .toThrow("이미지 참조");
  });

  it("converges an image page move with a peer z-order edit and resolves same-named groups by page", () => {
    const seed = new StudioCrdtDocument();
    const moving = asset("moving", "image", "work-asset://image/moving", "shared");
    const model = asset("model", "vrm", "work-asset://vrm/model", "shared", 30);
    const empty = [
      page("page-a", [], [group("shared", "A 공유")]),
      page("page-b", [], [group("shared", "B 공유")]),
    ];
    const initial = [
      page("page-a", [moving, model], [group("shared", "A 공유")]),
      page("page-b", [], [group("shared", "B 공유")]),
    ];
    publishStudioCrdtSceneGraphDiff(seed, empty, initial);
    const initialUpdate = seed.encodeStateAsUpdate();
    const left = new StudioCrdtDocument(initialUpdate);
    const right = new StudioCrdtDocument(initialUpdate);
    const moved = [
      page("page-a", [model], [group("shared", "A 공유")]),
      page("page-b", [moving], [group("shared", "B 공유")]),
    ];

    publishStudioCrdtSceneGraphDiff(left, initial, moved);
    right.moveElement("model", "moving");
    converge(left, right, seed);

    expect(left.getSceneElement("moving")).toEqual(right.getSceneElement("moving"));
    expect(left.getSceneElement("model")).toEqual(right.getSceneElement("model"));
    expect(left.getSceneElement("moving")).toMatchObject({
      pageId: "page-b",
      layerId: "shared",
      deleted: false,
      payload: { type: "reference", props: { elementType: "image" } },
    });
    expect(left.getSceneElement("model")).toMatchObject({
      pageId: "page-a",
      layerId: "shared",
      payload: { type: "reference", props: { elementType: "vrm" } },
    });
    const leftPages = reconcile(left, moved);
    const rightPages = reconcile(right, structuredClone(moved));
    expect(leftPages).toEqual(rightPages);
    expect(leftPages[0]!.elements).toHaveLength(1);
    expect(leftPages[0]!.elements[0]).toMatchObject({
      id: "model",
      src: "work-asset://vrm/model",
    });
    expect(leftPages[1]!.elements[0]).toMatchObject({
      id: "moving",
      src: "work-asset://image/moving",
      groupId: "shared",
    });
    expect(leftPages[0]!.groups[0]!.name).toBe("A 공유");
    expect(leftPages[1]!.groups[0]!.name).toBe("B 공유");
    seed.destroy();
    left.destroy();
    right.destroy();
  });

  it("merges concurrent reference placement and scalar-filter edits over the immutable descriptor", () => {
    const seed = new StudioCrdtDocument();
    const initial = asset("portrait", "image", "work-asset://image/portrait", undefined, 10);
    seed.addSceneElement(studioElementToCrdtSceneElement("page-a", initial));
    const initialUpdate = seed.encodeStateAsUpdate();
    const left = new StudioCrdtDocument(initialUpdate);
    const right = new StudioCrdtDocument(initialUpdate);

    left.patchSceneElement("portrait", { set: { x: 140, opacity: 0.45 } });
    right.patchSceneElement("portrait", { set: { y: 260, blur: 9, flippedY: true } });
    converge(left, right, seed);

    expect(left.getSceneElement("portrait")).toEqual(right.getSceneElement("portrait"));
    expect(left.getSceneElement("portrait")?.payload.props).toMatchObject({
      x: 140,
      y: 260,
      opacity: 0.45,
      blur: 9,
      flippedY: true,
    });
    const immutableDescriptorFallback = asset(
      "portrait",
      "image",
      "work-asset://image/portrait",
      undefined,
      1
    );
    const result = reconcileStudioCrdtSceneGraphPages(
      [page("page-a")],
      left.getStrokes({ includeDeleted: true }),
      left.getSceneElements({ includeDeleted: true }),
      left.getPages(true),
      left.getLayerGroups({ includeDeleted: true }),
      undefined,
      new Map([["portrait", immutableDescriptorFallback]])
    );
    expect(result.pages[0]!.elements[0]).toMatchObject({
      id: "portrait",
      src: "work-asset://image/portrait",
      x: 140,
      y: 260,
      opacity: 0.45,
      blur: 9,
      flippedY: true,
    });

    seed.destroy();
    left.destroy();
    right.destroy();
  });

  it("converges a concurrent group tombstone and reference reassignment without orphan membership", () => {
    const seed = new StudioCrdtDocument();
    seed.addLayerGroup(groupInput("page-a", "cast"));
    seed.addLayerGroup(groupInput("page-a", "props"));
    const image = asset("portrait", "image", "work-asset://image/portrait", "cast");
    seed.addSceneElement(studioElementToCrdtSceneElement("page-a", image));
    const initialUpdate = seed.encodeStateAsUpdate();
    const left = new StudioCrdtDocument(initialUpdate);
    const right = new StudioCrdtDocument(initialUpdate);

    left.deleteLayerGroup("page-a", "cast");
    right.patchSceneElement("portrait", { layerId: "props" });
    converge(left, right, seed);

    expect(left.getLayerGroup("page-a", "cast")).toBeNull();
    expect(right.getLayerGroup("page-a", "cast")).toBeNull();
    expect(left.getSceneElement("portrait")).toEqual(right.getSceneElement("portrait"));
    expect(left.getSceneElement("portrait")?.layerId).toBe("props");
    const stale = [page(
      "page-a",
      [image],
      [group("cast", "등장인물"), group("props", "소품")]
    )];
    const leftPages = reconcile(left, stale);
    const rightPages = reconcile(right, structuredClone(stale));
    expect(leftPages).toEqual(rightPages);
    expect(leftPages[0]!.groups.map(({ id }) => id)).toEqual(["props"]);
    expect(leftPages[0]!.elements[0]).toMatchObject({
      id: "portrait",
      groupId: "props",
      src: "work-asset://image/portrait",
    });

    seed.destroy();
    left.destroy();
    right.destroy();
  });

  it("preserves a moved asset body when its source page is concurrently tombstoned", () => {
    const seed = new StudioCrdtDocument();
    const photo = asset("moving-photo", "image", "work-asset://image/moving-photo");
    const initial = [
      page("page-a", [photo]),
      page("page-b"),
    ];
    publishStudioCrdtSceneGraphDiff(seed, [], initial);
    const initialUpdate = seed.encodeStateAsUpdate();
    const left = new StudioCrdtDocument(initialUpdate);
    const right = new StudioCrdtDocument(initialUpdate);

    left.deletePage("page-a");
    right.patchSceneElement("moving-photo", {
      pageId: "page-b",
      layerId: "page-root",
    });
    converge(left, right, seed);

    const leftPages = reconcile(left, initial);
    const rightPages = reconcile(right, structuredClone(initial));
    expect(leftPages).toEqual(rightPages);
    expect(leftPages.map(({ id }) => id)).toEqual(["page-b"]);
    expect(leftPages[0]!.elements).toEqual([
      expect.objectContaining({
        id: "moving-photo",
        type: "image",
        src: "work-asset://image/moving-photo",
      }),
    ]);

    seed.destroy();
    left.destroy();
    right.destroy();
  });

  it("carries remote reference moves and tombstones through undo snapshots without stale revival", () => {
    const document = new StudioCrdtDocument();
    document.addLayerGroup(groupInput("page-a", "cast"));
    document.addLayerGroup(groupInput("page-b", "props"));
    const original = asset("photo", "image", "work-asset://image/photo", "cast", 10);
    document.addSceneElement(studioElementToCrdtSceneElement("page-a", original));
    document.patchSceneElement("photo", { pageId: "page-b", layerId: "props" });
    const history = [
      [
        page("page-a", [original], [group("cast")]),
        page("page-b", [], [group("props")]),
      ],
      [
        page("page-a", [
          asset("photo", "image", "work-asset://image/photo", "cast", 90),
        ], [group("cast")]),
        page("page-b", [], [group("props")]),
      ],
    ];
    const frontier = {
      strokes: document.getStrokes({ includeDeleted: true }),
      sceneElements: document.getSceneElements({ includeDeleted: true }),
      pages: document.getPages(true),
      layerGroups: document.getLayerGroups({ includeDeleted: true }),
    };
    const moved = reconcileStudioCrdtSceneGraphHistory(history, 1, frontier, {
      strokeIds: new Set<string>(),
      sceneElementIds: new Set(["photo"]),
      pageIds: new Set<string>(),
      layerGroupIds: new Set<string>(),
    });

    expect(moved.history[0]![0]!.elements).toEqual([]);
    expect(moved.history[1]![0]!.elements).toEqual([]);
    expect(moved.history[0]![1]!.elements[0]).toMatchObject({
      id: "photo",
      src: "work-asset://image/photo",
      groupId: "props",
    });
    expect(moved.history[1]![1]!.elements[0]).toMatchObject({
      id: "photo",
      src: "work-asset://image/photo",
      // Placement is now a convergent CRDT property, so stale undo-local x=90 cannot override
      // the durable x=10 reference frontier.
      x: 10,
      groupId: "props",
    });

    document.deleteSceneElement("photo");
    const tombstoned = reconcileStudioCrdtSceneGraphHistory(moved.history, 1, {
      ...frontier,
      sceneElements: document.getSceneElements({ includeDeleted: true }),
    }, {
      strokeIds: new Set<string>(),
      sceneElementIds: new Set(["photo"]),
      pageIds: new Set<string>(),
      layerGroupIds: new Set<string>(),
    });
    for (const snapshot of tombstoned.history) {
      expect(snapshot.flatMap((candidate) => candidate.elements)).toEqual([]);
    }

    const staleBefore = [
      page("page-a", [original], [group("cast")]),
      page("page-b", [], [group("props")]),
    ];
    const staleAfter = [
      page("page-a", [structuredClone(original)], [group("cast")], "unrelated"),
      page("page-b", [], [group("props")]),
    ];
    publishStudioCrdtSceneGraphDiff(document, staleBefore, staleAfter);
    expect(document.getSceneElement("photo")).toBeNull();

    const absent = [
      page("page-a", [], [group("cast")]),
      page("page-b", [], [group("props")]),
    ];
    publishStudioCrdtSceneGraphDiff(document, absent, staleBefore);
    expect(document.getSceneElement("photo")).toMatchObject({
      pageId: "page-a",
      layerId: "cast",
      deleted: false,
      payload: { type: "reference", props: { elementType: "image" } },
    });
    document.destroy();
  });

  it("hydrates an exact remote reference with a stable URI across undo history", () => {
    const document = new StudioCrdtDocument();
    const local = asset(
      "remote-photo",
      "image",
      "data:image/png;base64,local-only",
      undefined,
      90
    );
    const stable = asset(
      "remote-photo",
      "image",
      "work-asset://image/remote-photo",
      undefined,
      12
    );
    const authored = { ...stable, x: 90 };
    document.addSceneElement(studioElementToCrdtSceneElement("page-a", authored));
    const referenceSources = new Map([[stable.id, stable]]);
    const frontier = {
      strokes: document.getStrokes({ includeDeleted: true }),
      sceneElements: document.getSceneElements({ includeDeleted: true }),
      pages: document.getPages(true),
      layerGroups: document.getLayerGroups({ includeDeleted: true }),
    };
    const result = reconcileStudioCrdtSceneGraphHistory(
      [
        [page("page-a", [local])],
        [page("page-a")],
      ],
      1,
      frontier,
      {
        strokeIds: new Set<string>(),
        sceneElementIds: new Set([stable.id]),
        pageIds: new Set<string>(),
        layerGroupIds: new Set<string>(),
      },
      referenceSources
    );

    for (const snapshot of result.history) {
      expect(snapshot[0]!.elements[0]).toMatchObject({
        id: "remote-photo",
        type: "image",
        src: "work-asset://image/remote-photo",
        // The immutable upload descriptor is only a fallback (x=12). The realtime reference
        // placement (x=90) is authoritative and must converge across every undo snapshot.
        x: 90,
        authoredMetadata: { keep: true },
      });
    }
    expect(JSON.stringify(result.history)).not.toContain("base64");
    document.destroy();
  });
});
