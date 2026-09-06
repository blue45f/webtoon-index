import { describe, expect, it, vi } from "vitest";

import {
  findStudioObjectInsertItem,
  planStudioObjectInsertPlacement,
} from "./studio-object-insert-catalog";
import {
  parseStudioObjectInsertDragPayload,
  resolveStudioObjectInsertOpenSeed,
  serializeStudioObjectInsertDragPayload,
  STUDIO_OBJECT_INSERT_DRAG_MIME,
  writeStudioObjectInsertDragPayload,
} from "./studio-object-insert-drag";

describe("studio object insert drag", () => {
  it("round-trips openTarget and sourceId for prop and template picks", () => {
    const sword = findStudioObjectInsertItem("obj-prop-sword");
    const classroom = findStudioObjectInsertItem("obj-scene-classroom");
    expect(sword).not.toBeNull();
    expect(classroom).not.toBeNull();

    const swordPlan = planStudioObjectInsertPlacement({
      itemId: sword!.id,
      canvasWidth: 800,
      canvasHeight: 1200,
    })!;
    const swordPayload = parseStudioObjectInsertDragPayload(
      serializeStudioObjectInsertDragPayload({ item: sword!, plan: swordPlan }),
    );
    expect(swordPayload).toMatchObject({
      openTarget: "vrm-poser",
      sourceId: "sword",
      itemId: "obj-prop-sword",
    });
    expect(resolveStudioObjectInsertOpenSeed(swordPayload!)).toEqual({
      bg3dSeedTemplateId: null,
      bg3dSeedPrimitiveKind: null,
      poserSeedPropId: "sword",
    });

    const classPlan = planStudioObjectInsertPlacement({
      itemId: classroom!.id,
      canvasWidth: 800,
      canvasHeight: 1200,
    })!;
    const classPayload = parseStudioObjectInsertDragPayload(
      serializeStudioObjectInsertDragPayload({ item: classroom!, plan: classPlan }),
    );
    expect(classPayload?.openTarget).toBe("bg3d-templates");
    expect(resolveStudioObjectInsertOpenSeed(classPayload!)).toEqual({
      bg3dSeedTemplateId: "classroom",
      bg3dSeedPrimitiveKind: null,
      poserSeedPropId: null,
    });

    const box = findStudioObjectInsertItem("obj-prim-box")!;
    const boxPlan = planStudioObjectInsertPlacement({
      itemId: box.id,
      canvasWidth: 800,
      canvasHeight: 1200,
    })!;
    expect(
      resolveStudioObjectInsertOpenSeed({
        openTarget: boxPlan.openTarget,
        sourceId: boxPlan.sourceId,
      }).bg3dSeedPrimitiveKind,
    ).toBe("box");

    expect(STUDIO_OBJECT_INSERT_DRAG_MIME).toContain("object-insert");
    expect(parseStudioObjectInsertDragPayload("not-json")).toBeNull();
    expect(parseStudioObjectInsertDragPayload("{}")).toBeNull();

    const setData = vi.fn();
    const transfer: {
      setData: typeof setData;
      effectAllowed: DataTransfer["effectAllowed"];
    } = { setData, effectAllowed: "none" };
    writeStudioObjectInsertDragPayload(transfer, {
      item: sword!,
      plan: swordPlan,
    });
    expect(setData).toHaveBeenCalledWith(
      STUDIO_OBJECT_INSERT_DRAG_MIME,
      expect.stringContaining("vrm-poser"),
    );
    expect(transfer.effectAllowed).toBe("copy");
  });
});
