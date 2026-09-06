import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  createStudioShared3dStageCollectionDocument,
  type StudioShared3dStageCollectionDocument,
  type StudioShared3dStageEntry,
} from "../studio-shared-3d-stage-collection";
import { createNativePluralShared3dStageFixture } from "../studio-shared-3d-stage-test-fixture";

import {
  StudioCrdtDocument,
  STUDIO_CRDT_ORIGIN_LOCAL,
  STUDIO_CRDT_PAGE_PAYLOAD_VERSION,
  STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION,
  STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT,
  STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT,
  studioCrdtShared3dStageCompositeKey,
  studioCrdtShared3dStageRecordRootName,
  studioCrdtShared3dStageVisibilityReceiptRootName,
} from "./studio-crdt-document";

function page(id = "page-a") {
  return {
    id,
    payload: {
      version: STUDIO_CRDT_PAGE_PAYLOAD_VERSION,
      props: { bg: "#fff", bgGrad: null, canvasH: 1_600 },
    },
  } as const;
}

function collection(
  stages: readonly StudioShared3dStageEntry[],
  base: StudioShared3dStageCollectionDocument,
): StudioShared3dStageCollectionDocument {
  const value = createStudioShared3dStageCollectionDocument({
    stages,
    visibilityReceipts: base.visibilityReceipts,
  });
  if (!value) throw new Error("invalid test collection");
  return value;
}

function editStage(
  base: StudioShared3dStageCollectionDocument,
  stageId: string,
  sourceHashCharacter: string,
): StudioShared3dStageCollectionDocument {
  return collection(base.stages.map((stage) => stage.id === stageId
    ? {
        ...stage,
        background: {
          ...stage.background,
          sourceHash: `sha256:${sourceHashCharacter.repeat(64)}` as `sha256:${string}`,
        },
      }
    : stage), base);
}

function localUpdates(document: StudioCrdtDocument): Uint8Array[] {
  const updates: Uint8Array[] = [];
  document.subscribe((update, origin) => {
    if (origin === STUDIO_CRDT_ORIGIN_LOCAL) updates.push(update);
  });
  return updates;
}

describe("StudioCrdtDocument Shared 3D Stage sidecar", () => {
  it("uses the UTF-16 length-prefix key contract", () => {
    expect(studioCrdtShared3dStageCompositeKey("페이지😀", "stage-a"))
      .toBe("5:페이지😀7:stage-a");
  });

  it("decorates page records and reports sidecar edits through changedPageIds", () => {
    const document = new StudioCrdtDocument();
    const fixture = createNativePluralShared3dStageFixture();
    document.addPage(page());
    const changedPageIds: string[][] = [];
    document.subscribeChanges((change) => {
      if (change.changedPageIds.size > 0) changedPageIds.push([...change.changedPageIds]);
    }, { snapshotFields: [] });

    document.publishShared3dStagePageDiff("page-a", undefined, fixture);

    expect(document.getPage("page-a")).toMatchObject({
      shared3dStageManaged: true,
      shared3dStage: fixture,
    });
    expect(changedPageIds).toContainEqual(["page-a"]);
    document.destroy();
  });

  it("reads a many-page Shared Stage frontier once while hydrating the page cache", () => {
    const pageCount = 200;
    const raw = new Y.Doc();
    const pageIndex = raw.getMap<boolean>("studio-pages");
    const stageIndex = raw.getMap<boolean>(STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT);
    raw.getMap<boolean>(STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT);
    raw.transact(() => {
      for (let index = 0; index < pageCount; index += 1) {
        const pageId = `page-cache-${index}`;
        const pageRecord = raw.getMap<unknown>(`studio-page:${encodeURIComponent(pageId)}`);
        pageIndex.set(pageId, true);
        pageRecord.set("id", pageId);
        pageRecord.set("payloadVersion", STUDIO_CRDT_PAGE_PAYLOAD_VERSION);
        pageRecord.set("prop:bg", "#fff");
        pageRecord.set("prop:bgGrad", null);
        pageRecord.set("prop:canvasH", 1_600);

        const stageId = `stage-cache-${index}`;
        const stageKey = studioCrdtShared3dStageCompositeKey(pageId, stageId);
        const stageRecord = raw.getMap<unknown>(studioCrdtShared3dStageRecordRootName(stageKey));
        stageRecord.set("pageId", pageId);
        stageRecord.set("stageId", stageId);
        stageRecord.set("payloadVersion", STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION);
        stageRecord.set("order", 0);
        stageRecord.set("payload", JSON.stringify({
          id: stageId,
          capturePolicy: "background-only",
          background: {
            bundleId: `bundle-cache-${index}`,
            sourceHash: `sha256:${"a".repeat(64)}`,
          },
          characters: [],
        }));
        stageRecord.set("activate:0", true);
        stageIndex.set(stageKey, true);
      }
    });

    const parse = vi.spyOn(JSON, "parse");
    let document: StudioCrdtDocument | undefined;
    try {
      document = new StudioCrdtDocument(Y.encodeStateAsUpdate(raw));
      expect(document.getPages()).toHaveLength(pageCount);
      for (let index = 0; index < pageCount; index += 1) {
        expect(document.getPage(`page-cache-${index}`)).toMatchObject({
          id: `page-cache-${index}`,
          shared3dStageManaged: true,
        });
      }
      const stagePayloadParseCount = parse.mock.calls.filter(([value]) =>
        typeof value === "string" && value.startsWith('{"id":"stage-cache-'))
        .length;
      expect(stagePayloadParseCount).toBe(pageCount);
    } finally {
      parse.mockRestore();
      document?.destroy();
      raw.destroy();
    }
  });

  it("merges edits to different Stage records without replacing the other entry", () => {
    const fixture = createNativePluralShared3dStageFixture();
    const seed = new StudioCrdtDocument();
    seed.publishShared3dStagePageDiff("page-a", undefined, fixture);
    const base = seed.encodeStateAsUpdate();
    seed.destroy();
    const left = new StudioCrdtDocument(base);
    const right = new StudioCrdtDocument(base);
    const leftUpdates = localUpdates(left);
    const rightUpdates = localUpdates(right);
    left.publishShared3dStagePageDiff("page-a", fixture, editStage(fixture, "stage-native-a", "e"));
    right.publishShared3dStagePageDiff("page-a", fixture, editStage(fixture, "stage-native-b", "f"));

    for (const update of rightUpdates) left.applyUpdate(update);
    for (const update of leftUpdates) right.applyUpdate(update);

    for (const peer of [left, right]) {
      const stages = peer.getShared3dStagePageState("page-a").value?.stages ?? [];
      expect(stages.find(({ id }) => id === "stage-native-a")?.background.sourceHash)
        .toBe(`sha256:${"e".repeat(64)}`);
      expect(stages.find(({ id }) => id === "stage-native-b")?.background.sourceHash)
        .toBe(`sha256:${"f".repeat(64)}`);
      peer.destroy();
    }
  });

  it("observes hydrated dynamic record edits as page changes", () => {
    const fixture = createNativePluralShared3dStageFixture();
    const seed = new StudioCrdtDocument();
    seed.publishShared3dStagePageDiff("page-a", undefined, fixture);
    const base = seed.encodeStateAsUpdate();
    seed.destroy();
    const receiver = new StudioCrdtDocument(base);
    const sender = new StudioCrdtDocument(base);
    const changedPageIds: string[][] = [];
    receiver.subscribeChanges((change) => changedPageIds.push([...change.changedPageIds]), {
      snapshotFields: [],
    });
    const updates = localUpdates(sender);
    sender.publishShared3dStagePageDiff(
      "page-a",
      fixture,
      editStage(fixture, "stage-native-a", "e"),
    );
    for (const update of updates) receiver.applyUpdate(update);

    expect(changedPageIds).toContainEqual(["page-a"]);
    receiver.destroy();
    sender.destroy();
  });

  it("makes concurrent empty-base connect versus legacy unlink a generation-event union", () => {
    const fixture = createNativePluralShared3dStageFixture();
    const connector = new StudioCrdtDocument();
    const unlinker = new StudioCrdtDocument();
    const connectUpdates = localUpdates(connector);
    const unlinkUpdates = localUpdates(unlinker);
    connector.publishShared3dStagePageDiff("page-a", undefined, fixture);
    unlinker.publishShared3dStagePageDiff("page-a", fixture, undefined);
    expect(connectUpdates).toHaveLength(1);
    expect(unlinkUpdates).toHaveLength(1);

    const left = new StudioCrdtDocument();
    left.applyUpdate(connectUpdates[0]!);
    left.applyUpdate(unlinkUpdates[0]!);
    const right = new StudioCrdtDocument();
    right.applyUpdate(unlinkUpdates[0]!);
    right.applyUpdate(connectUpdates[0]!);

    expect(left.encodeStateAsUpdate()).toEqual(right.encodeStateAsUpdate());
    expect(left.getShared3dStagePageState("page-a")).toEqual({
      pageId: "page-a",
      managed: true,
      value: undefined,
    });
    expect(right.getShared3dStagePageState("page-a")).toEqual(
      left.getShared3dStagePageState("page-a"),
    );
    connector.destroy();
    unlinker.destroy();
    left.destroy();
    right.destroy();
  });

  it("keeps a receipt added concurrently with unlink dormant until an explicit relink", () => {
    const fixture = createNativePluralShared3dStageFixture();
    const stage = fixture.stages[0]!;
    const receipt = fixture.visibilityReceipts[0]!;
    const withoutReceipt = createStudioShared3dStageCollectionDocument({
      stages: [stage],
      visibilityReceipts: [],
    });
    const withReceipt = createStudioShared3dStageCollectionDocument({
      stages: [stage],
      visibilityReceipts: [receipt],
    });
    if (!withoutReceipt || !withReceipt) throw new Error("invalid dormant receipt fixture");

    const seed = new StudioCrdtDocument();
    seed.publishShared3dStagePageDiff("page-a", undefined, withoutReceipt);
    const base = seed.encodeStateAsUpdate();
    const baseVector = seed.encodeStateVector();
    const receiptAdder = new StudioCrdtDocument(base);
    const unlinker = new StudioCrdtDocument(base);
    receiptAdder.publishShared3dStagePageDiff("page-a", withoutReceipt, withReceipt);
    unlinker.publishShared3dStagePageDiff("page-a", withoutReceipt, undefined);
    const receiptUpdate = receiptAdder.encodeStateAsUpdate(baseVector);
    const unlinkUpdate = unlinker.encodeStateAsUpdate(baseVector);

    const left = new StudioCrdtDocument(base);
    left.applyUpdate(receiptUpdate);
    left.applyUpdate(unlinkUpdate);
    const right = new StudioCrdtDocument(base);
    right.applyUpdate(unlinkUpdate);
    right.applyUpdate(receiptUpdate);
    for (const peer of [left, right]) {
      expect(peer.getShared3dStagePageState("page-a")).toEqual({
        pageId: "page-a",
        managed: true,
        value: undefined,
      });
    }
    expect(left.encodeStateAsUpdate()).toEqual(right.encodeStateAsUpdate());

    const mergedVector = left.encodeStateVector();
    left.publishShared3dStagePageDiff("page-a", undefined, withReceipt);
    right.applyUpdate(left.encodeStateAsUpdate(mergedVector));
    expect(left.getShared3dStagePageState("page-a").value).toEqual(withReceipt);
    expect(right.getShared3dStagePageState("page-a").value).toEqual(withReceipt);

    seed.destroy();
    receiptAdder.destroy();
    unlinker.destroy();
    left.destroy();
    right.destroy();
  });

  it("does not resurrect a tombstone on content edit but permits an explicit relink", () => {
    const fixture = createNativePluralShared3dStageFixture();
    const document = new StudioCrdtDocument();
    document.publishShared3dStagePageDiff("page-a", fixture, undefined);
    const edited = editStage(fixture, "stage-native-a", "e");
    document.publishShared3dStagePageDiff("page-a", fixture, edited);
    expect(document.getShared3dStagePageState("page-a").value).toBeUndefined();

    document.publishShared3dStagePageDiff("page-a", undefined, edited);
    expect(document.getShared3dStagePageState("page-a").value).toEqual(edited);
    document.destroy();
  });

  it("keeps managed undefined/undefined as a no-op and requires pageDeleted for a sweep", () => {
    const fixture = createNativePluralShared3dStageFixture();
    const document = new StudioCrdtDocument();
    document.publishShared3dStagePageDiff("page-a", undefined, fixture);
    const before = document.encodeStateAsUpdate();
    document.publishShared3dStagePageDiff("page-a", undefined, undefined);
    expect(document.encodeStateAsUpdate()).toEqual(before);
    const beforePreflight = document.encodeStateAsUpdate();
    document.preflightShared3dStagePageDiff(
      "page-a",
      undefined,
      undefined,
      { pageDeleted: true },
    );
    expect(document.encodeStateAsUpdate()).toEqual(beforePreflight);
    document.publishShared3dStagePageDiff(
      "page-a",
      undefined,
      undefined,
      { pageDeleted: true },
    );
    expect(document.getShared3dStagePageState("page-a")).toEqual({
      pageId: "page-a",
      managed: true,
      value: undefined,
    });
    document.destroy();
  });

  it("strictly rejects receipt-only pages and inactive poisoned receipts", () => {
    const fixture = createNativePluralShared3dStageFixture();
    const receipt = fixture.visibilityReceipts[0]!;
    const raw = new Y.Doc();
    const receiptKey = studioCrdtShared3dStageCompositeKey("page-a", receipt.elementId);
    raw.getMap<boolean>(STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT)
      .set(receiptKey, true);
    const receiptRecord = raw.getMap<unknown>(
      studioCrdtShared3dStageVisibilityReceiptRootName(receiptKey),
    );
    receiptRecord.set("pageId", "page-a");
    receiptRecord.set("elementId", receipt.elementId);
    receiptRecord.set("payloadVersion", STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION);
    receiptRecord.set("modelRuntimeKey", "poisoned");
    receiptRecord.set("deactivate:0", true);
    const document = new StudioCrdtDocument(Y.encodeStateAsUpdate(raw));

    expect(() => document.getShared3dStageFrontier()).toThrow(/영수증/);
    document.destroy();
    raw.destroy();
  });

  it("rejects a dynamic record root that is not present in its grow-only index", () => {
    const fixture = createNativePluralShared3dStageFixture();
    const stage = fixture.stages[0]!;
    const raw = new Y.Doc();
    const stageKey = studioCrdtShared3dStageCompositeKey("page-a", stage.id);
    const record = raw.getMap<unknown>(studioCrdtShared3dStageRecordRootName(stageKey));
    record.set("pageId", "page-a");
    record.set("stageId", stage.id);
    record.set("payloadVersion", STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION);
    record.set("order", 0);
    record.set("payload", JSON.stringify(stage));
    record.set("activate:0", true);
    // Materialize the empty index root so the malformed document shape is explicit.
    raw.getMap<boolean>(STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT);
    const document = new StudioCrdtDocument(Y.encodeStateAsUpdate(raw));

    expect(() => document.getShared3dStageFrontier()).toThrow(/인덱스에 없는/);
    document.destroy();
    raw.destroy();
  });

  it("rejects explicit relink after the 256-event generation budget is exhausted", () => {
    const fixture = createNativePluralShared3dStageFixture();
    const stage = fixture.stages[0]!;
    const raw = new Y.Doc();
    const stageKey = studioCrdtShared3dStageCompositeKey("page-a", stage.id);
    raw.getMap<boolean>(STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT).set(stageKey, true);
    const record = raw.getMap<unknown>(studioCrdtShared3dStageRecordRootName(stageKey));
    record.set("pageId", "page-a");
    record.set("stageId", stage.id);
    record.set("payloadVersion", STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION);
    record.set("order", 0);
    record.set("payload", JSON.stringify(stage));
    for (let generation = 0; generation < 128; generation += 1) {
      record.set(`activate:${generation}`, true);
      record.set(`deactivate:${generation}`, true);
    }
    const document = new StudioCrdtDocument(Y.encodeStateAsUpdate(raw));

    expect(() => document.preflightShared3dStagePageDiff("page-a", undefined, fixture))
      .toThrow(/generation/);
    document.destroy();
    raw.destroy();
  });

  it("reserves the final generation event for unlink and rejects capped active poison", () => {
    const fixture = createNativePluralShared3dStageFixture();
    const stage = fixture.stages[0]!;
    const singleStage = createStudioShared3dStageCollectionDocument({
      stages: [stage],
      visibilityReceipts: [],
    });
    if (!singleStage) throw new Error("invalid single-stage fixture");

    const stageKey = studioCrdtShared3dStageCompositeKey("page-a", stage.id);
    const seedRecord = (raw: Y.Doc) => {
      raw.getMap<boolean>(STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT).set(stageKey, true);
      const record = raw.getMap<unknown>(studioCrdtShared3dStageRecordRootName(stageKey));
      record.set("pageId", "page-a");
      record.set("stageId", stage.id);
      record.set("payloadVersion", STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION);
      record.set("order", 0);
      record.set("payload", JSON.stringify(stage));
      return record;
    };

    const activeRaw = new Y.Doc();
    const activeRecord = seedRecord(activeRaw);
    activeRecord.set("activate:0", true);
    for (let generation = 0; generation < 127; generation += 1) {
      activeRecord.set(`deactivate:${generation}`, true);
      activeRecord.set(`activate:${generation + 1}`, true);
    }
    const active = new StudioCrdtDocument(Y.encodeStateAsUpdate(activeRaw));
    active.publishShared3dStagePageDiff("page-a", singleStage, undefined);
    expect(active.getShared3dStagePageState("page-a").value).toBeUndefined();

    const inactiveRaw = new Y.Doc();
    const inactiveRecord = seedRecord(inactiveRaw);
    inactiveRecord.set("deactivate:0", true);
    for (let generation = 1; generation <= 127; generation += 1) {
      inactiveRecord.set(`activate:${generation}`, true);
      inactiveRecord.set(`deactivate:${generation}`, true);
    }
    const inactive = new StudioCrdtDocument(Y.encodeStateAsUpdate(inactiveRaw));
    expect(() => inactive.preflightShared3dStagePageDiff("page-a", undefined, singleStage))
      .toThrow(/generation/);

    const cappedActiveRaw = new Y.Doc();
    Y.applyUpdate(cappedActiveRaw, Y.encodeStateAsUpdate(inactiveRaw));
    cappedActiveRaw.getMap<unknown>(studioCrdtShared3dStageRecordRootName(stageKey))
      .set("activate:128", true);
    const cappedActive = new StudioCrdtDocument(Y.encodeStateAsUpdate(cappedActiveRaw));
    expect(() => cappedActive.getShared3dStageFrontier()).toThrow(/Stage/);

    active.destroy();
    inactive.destroy();
    cappedActive.destroy();
    activeRaw.destroy();
    inactiveRaw.destroy();
    cappedActiveRaw.destroy();
  });
});
