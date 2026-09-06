/**
 * DOC-008 — Yjs scene/layer metadata CRDT.
 * Geometry buffers stay out of CRDT (architecture [S33]); only order, text, and properties.
 * Deterministic multi-peer merge via Yjs updates.
 */

import * as Y from "yjs";

export const STUDIO_DCC_YJS_SCENE_METADATA_REVISION = 1 as const;

export type StudioDccYjsLayerMeta = {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly locked: boolean;
  readonly order: number;
};

export type StudioDccYjsSceneSnapshot = {
  readonly revision: typeof STUDIO_DCC_YJS_SCENE_METADATA_REVISION;
  readonly layers: readonly StudioDccYjsLayerMeta[];
  readonly layerOrder: readonly string[];
  readonly title: string;
  readonly properties: Readonly<Record<string, string>>;
};

function roots(doc: Y.Doc) {
  return {
    order: doc.getArray<string>("layerOrder"),
    layers: doc.getMap<Y.Map<unknown>>("layers"),
    title: doc.getText("title"),
    properties: doc.getMap<string>("properties"),
  };
}

/** Create an empty Yjs scene/layer metadata document. */
export function createStudioDccYjsSceneMetadataDoc(
  clientId?: number,
): Y.Doc {
  const doc = new Y.Doc();
  if (typeof clientId === "number" && Number.isFinite(clientId)) {
    doc.clientID = clientId >>> 0;
  }
  // Touch roots so they exist before encode
  roots(doc);
  return doc;
}

export function studioDccYjsSceneUpsertLayer(
  doc: Y.Doc,
  layer: StudioDccYjsLayerMeta,
): void {
  const { order, layers } = roots(doc);
  doc.transact(() => {
    let layerMap = layers.get(layer.id);
    if (!layerMap) {
      layerMap = new Y.Map();
      layers.set(layer.id, layerMap);
    }
    layerMap.set("id", layer.id);
    layerMap.set("name", layer.name);
    layerMap.set("visible", layer.visible);
    layerMap.set("opacity", layer.opacity);
    layerMap.set("locked", layer.locked);
    layerMap.set("order", layer.order);
    const arr = order.toArray();
    if (!arr.includes(layer.id)) {
      order.push([layer.id]);
    }
  });
}

export function studioDccYjsSceneSetTitle(doc: Y.Doc, title: string): void {
  const { title: yTitle } = roots(doc);
  doc.transact(() => {
    yTitle.delete(0, yTitle.length);
    yTitle.insert(0, title);
  });
}

export function studioDccYjsSceneSetProperty(
  doc: Y.Doc,
  key: string,
  value: string,
): void {
  const { properties } = roots(doc);
  doc.transact(() => {
    properties.set(key, value);
  });
}

export function studioDccYjsSceneReorderLayers(
  doc: Y.Doc,
  nextOrder: readonly string[],
): void {
  const { order } = roots(doc);
  doc.transact(() => {
    order.delete(0, order.length);
    order.push([...nextOrder]);
  });
}

/** Encode local state as Yjs update bytes (v1). */
export function encodeStudioDccYjsSceneUpdate(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/** Apply remote update; concurrent ops converge deterministically. */
export function applyStudioDccYjsSceneUpdate(
  doc: Y.Doc,
  update: Uint8Array,
): void {
  Y.applyUpdate(doc, update);
}

/**
 * Merge peer A and peer B states: apply both updates into a fresh doc.
 * Returns a canonical snapshot used for conflict-deterministic tests.
 */
export function mergeStudioDccYjsSceneMetadata(
  updateA: Uint8Array,
  updateB: Uint8Array,
  clientId = 0xdecaf,
): StudioDccYjsSceneSnapshot {
  const merged = createStudioDccYjsSceneMetadataDoc(clientId);
  applyStudioDccYjsSceneUpdate(merged, updateA);
  applyStudioDccYjsSceneUpdate(merged, updateB);
  return snapshotStudioDccYjsSceneMetadata(merged);
}

export function snapshotStudioDccYjsSceneMetadata(
  doc: Y.Doc,
): StudioDccYjsSceneSnapshot {
  const { order, layers, title, properties } = roots(doc);
  const layerOrder = order.toArray();
  const layerList: StudioDccYjsLayerMeta[] = [];
  for (const id of layerOrder) {
    const m = layers.get(id);
    if (!m) continue;
    layerList.push({
      id: String(m.get("id") ?? id),
      name: String(m.get("name") ?? id),
      visible: Boolean(m.get("visible") ?? true),
      opacity: Number(m.get("opacity") ?? 1),
      locked: Boolean(m.get("locked") ?? false),
      order: Number(m.get("order") ?? layerList.length),
    });
  }
  // Include orphan layer maps not in order (deterministically sorted)
  const known = new Set(layerOrder);
  const orphans = [...layers.keys()].filter((k) => !known.has(k)).sort();
  for (const id of orphans) {
    const m = layers.get(id)!;
    layerList.push({
      id: String(m.get("id") ?? id),
      name: String(m.get("name") ?? id),
      visible: Boolean(m.get("visible") ?? true),
      opacity: Number(m.get("opacity") ?? 1),
      locked: Boolean(m.get("locked") ?? false),
      order: Number(m.get("order") ?? layerList.length),
    });
  }
  const props: Record<string, string> = {};
  for (const [k, v] of properties.entries()) {
    props[k] = String(v);
  }
  return {
    revision: STUDIO_DCC_YJS_SCENE_METADATA_REVISION,
    layers: layerList,
    layerOrder: [...layerOrder, ...orphans],
    title: title.toString(),
    properties: props,
  };
}

/**
 * Concurrent edit scenario: peer A renames layer + reorders; peer B sets property + title.
 * Both order of applyUpdate produce the same snapshot keys (Yjs CRDT guarantee).
 */
export function exerciseStudioDccYjsSceneMetadataConvergence(): {
  readonly ab: StudioDccYjsSceneSnapshot;
  readonly ba: StudioDccYjsSceneSnapshot;
  readonly orderEqual: boolean;
  readonly titleEqual: boolean;
  readonly propertyEqual: boolean;
  readonly layerCount: number;
} {
  const a = createStudioDccYjsSceneMetadataDoc(1);
  const b = createStudioDccYjsSceneMetadataDoc(2);
  studioDccYjsSceneUpsertLayer(a, {
    id: "L1",
    name: "Ink",
    visible: true,
    opacity: 1,
    locked: false,
    order: 0,
  });
  studioDccYjsSceneUpsertLayer(a, {
    id: "L2",
    name: "Tone",
    visible: true,
    opacity: 0.8,
    locked: false,
    order: 1,
  });
  // Sync base to B
  applyStudioDccYjsSceneUpdate(b, encodeStudioDccYjsSceneUpdate(a));

  // Concurrent: A renames + reorders; B sets title + prop
  studioDccYjsSceneUpsertLayer(a, {
    id: "L1",
    name: "Ink-A",
    visible: true,
    opacity: 1,
    locked: false,
    order: 0,
  });
  studioDccYjsSceneReorderLayers(a, ["L2", "L1"]);
  studioDccYjsSceneSetTitle(b, "Episode-01");
  studioDccYjsSceneSetProperty(b, "shot", "s1");

  const updateA = encodeStudioDccYjsSceneUpdate(a);
  const updateB = encodeStudioDccYjsSceneUpdate(b);
  const ab = mergeStudioDccYjsSceneMetadata(updateA, updateB, 9);
  const ba = mergeStudioDccYjsSceneMetadata(updateB, updateA, 9);
  return {
    ab,
    ba,
    orderEqual: ab.layerOrder.join("|") === ba.layerOrder.join("|"),
    titleEqual: ab.title === ba.title,
    propertyEqual: ab.properties.shot === ba.properties.shot,
    layerCount: ab.layers.length,
  };
}
