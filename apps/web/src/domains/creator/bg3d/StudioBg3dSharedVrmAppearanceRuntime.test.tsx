// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStudioShared3dSceneSession } from "../studio-shared-3d-scene-bridge";
import { DEFAULT_VRM_PROP_RIG_METRICS } from "../vrm/studio-vrm-prop-rig";
import { createPropInstance, serializeVrmProps } from "../vrm/studio-vrm-props";
import {
  createStudioVrmSceneDocument,
  type StudioVrmCanonicalData,
} from "../vrm/studio-vrm-scene-document";
import {
  FALLBACK_WARDROBE_METRICS,
  createWardrobeEquip,
  serializeWardrobe,
} from "../vrm/studio-vrm-wardrobe";

import { StudioBg3dSharedVrmAppearanceRuntime } from "./StudioBg3dSharedVrmAppearanceRuntime";

import type { StudioShared3dCharacterSource } from "../studio-shared-3d-scene-bridge";

const runtimeMocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  applyCostume: vi.fn(),
  commitCallbacks: [] as Array<((frame: number) => void) | null>,
  invalidate: vi.fn(),
  propCallbacks: new Map<string, (
    uid: string,
    propId: string,
    status: "ready" | "unavailable" | "detached",
  ) => void>(),
  propRigRevisions: [] as number[],
  wardrobeCallbacks: new Map<string, (
    slot: string,
    itemId: string,
    status: "ready" | "unavailable" | "detached",
  ) => void>(),
  wardrobeRigRevisions: [] as number[],
  propStatus: "ready" as "ready" | "unavailable",
  wardrobeStatus: "ready" as "ready" | "unavailable",
}));

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: { invalidate: typeof runtimeMocks.invalidate }) => unknown) =>
    selector({ invalidate: runtimeMocks.invalidate }),
}));

vi.mock("../vrm/studio-vrm-costume-runtime", () => ({
  applyStudioVrmCostumeState: runtimeMocks.applyCostume,
}));

vi.mock("../vrm/StudioVrmWardrobePropsProjection", async () => {
  const { useLayoutEffect } = await import("react");
  return {
    StudioVrmPropAttachment: (props: {
      instance: { uid: string; propId: string };
      rigRevision?: number;
      onAttachmentStatus?: (
        uid: string,
        propId: string,
        status: "ready" | "unavailable" | "detached",
      ) => void;
    }) => {
      const { instance, onAttachmentStatus, rigRevision } = props;
      useLayoutEffect(() => {
        if (rigRevision !== undefined) runtimeMocks.propRigRevisions.push(rigRevision);
        if (onAttachmentStatus) {
          runtimeMocks.propCallbacks.set(instance.uid, onAttachmentStatus);
        }
        onAttachmentStatus?.(
          instance.uid,
          instance.propId,
          runtimeMocks.propStatus,
        );
        return () => {
          if (runtimeMocks.propCallbacks.get(instance.uid) === onAttachmentStatus) {
            runtimeMocks.propCallbacks.delete(instance.uid);
          }
          onAttachmentStatus?.(
            instance.uid,
            instance.propId,
            "detached",
          );
        };
      }, [instance.propId, instance.uid, onAttachmentStatus, rigRevision]);
      return null;
    },
    StudioVrmWardrobeAttachment: (props: {
      slot: string;
      equip: { itemId: string };
      rigRevision?: number;
      onAttachmentStatus?: (
        slot: string,
        itemId: string,
        status: "ready" | "unavailable" | "detached",
      ) => void;
    }) => {
      const { equip, onAttachmentStatus, rigRevision, slot } = props;
      useLayoutEffect(() => {
        if (rigRevision !== undefined) runtimeMocks.wardrobeRigRevisions.push(rigRevision);
        if (onAttachmentStatus) {
          runtimeMocks.wardrobeCallbacks.set(slot, onAttachmentStatus);
        }
        onAttachmentStatus?.(
          slot,
          equip.itemId,
          runtimeMocks.wardrobeStatus,
        );
        return () => {
          if (runtimeMocks.wardrobeCallbacks.get(slot) === onAttachmentStatus) {
            runtimeMocks.wardrobeCallbacks.delete(slot);
          }
          onAttachmentStatus?.(
            slot,
            equip.itemId,
            "detached",
          );
        };
      }, [equip.itemId, onAttachmentStatus, rigRevision, slot]);
      return null;
    },
    StudioVrmRuntimeCommit: (props: { onCommitFrame?: (frame: number) => void }) => {
      const callbackIndex = runtimeMocks.commitCallbacks.length;
      useLayoutEffect(() => {
        runtimeMocks.commitCallbacks[callbackIndex] = props.onCommitFrame ?? null;
        return () => {
          runtimeMocks.commitCallbacks[callbackIndex] = null;
        };
      }, [callbackIndex, props.onCommitFrame]);
      return null;
    },
  };
});

function supportedSource(positionX = 0): StudioShared3dCharacterSource {
  const scene = createStudioVrmSceneDocument();
  const wardrobe = serializeWardrobe({ top: createWardrobeEquip("shirt")! })!;
  const props = serializeVrmProps([createPropInstance("mug", "shared-mug")!])!;
  const projectedScene = {
    ...scene,
    appearance: {
      ...scene.appearance,
      wardrobe: wardrobe as unknown as StudioVrmCanonicalData,
    },
    props: props as unknown as StudioVrmCanonicalData,
  };
  return createStudioShared3dSceneSession([{
    elementId: "character-a",
    scene: projectedScene,
    stageTransform: { position: [positionX, 0, 0], rotationY: 0 },
  }]).characters[0]!;
}

function renderRuntime(
  source: StudioShared3dCharacterSource,
  onStatus = vi.fn(),
) {
  const vrm = {
    scene: new THREE.Group(),
    update: vi.fn(),
  } as never;
  const costumeMeshes = [{
    key: "baked-shirt",
    label: "Baked shirt",
    slot: "tops",
    mesh: new THREE.Mesh(),
  }] as never;
  const runtimeOwner = {
    vrm,
    modelRuntimeKey: source.modelRuntimeKey,
    modelGeneration: "test-model-generation",
    runtime: {},
    disposed: false,
    prepare: runtimeMocks.prepare,
    dispose: vi.fn(),
  } as never;
  const result = render(
    <StudioBg3dSharedVrmAppearanceRuntime
      vrm={vrm}
      source={source}
      runtimeOwner={runtimeOwner}
      costumeMeshes={costumeMeshes}
      onStatus={onStatus}
    />,
  );
  return { ...result, costumeMeshes, onStatus, runtimeOwner, vrm };
}

function latestCommitCallback(): (frame: number) => void {
  const callback = [...runtimeMocks.commitCallbacks].reverse().find(Boolean);
  if (!callback) throw new Error("expected mounted runtime commit callback");
  return callback;
}

describe("Shared Stage linked VRM appearance runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMocks.commitCallbacks.length = 0;
    runtimeMocks.propCallbacks.clear();
    runtimeMocks.propRigRevisions.length = 0;
    runtimeMocks.wardrobeCallbacks.clear();
    runtimeMocks.wardrobeRigRevisions.length = 0;
    runtimeMocks.propStatus = "ready";
    runtimeMocks.wardrobeStatus = "ready";
    runtimeMocks.prepare.mockImplementation((
      _source: StudioShared3dCharacterSource,
      identityKey: string,
    ) => ({
      ok: true,
      prepared: {
        identityKey,
        preparedIdentityKey: `${identityKey}:test-model-generation:7`,
        rigRevision: 7,
        receipt: {
          ok: true,
          applyGeneration: 7,
          modelGeneration: "test-model-generation",
        },
        wardrobeMetrics: FALLBACK_WARDROBE_METRICS,
        propRigMetrics: DEFAULT_VRM_PROP_RIG_METRICS,
      },
    }));
  });

  afterEach(() => cleanup());

  it("requires attachments, a runtime commit, and a strictly later demand frame before ready", () => {
    const { onStatus, vrm } = renderRuntime(supportedSource());
    const commit = latestCommitCallback();

    expect(onStatus.mock.calls.map((call) => call[1])).toContain("loading");
    expect(onStatus.mock.calls.map((call) => call[1])).not.toContain("ready");
    expect(runtimeMocks.propRigRevisions).toContain(7);
    expect(runtimeMocks.wardrobeRigRevisions).toContain(7);
    expect((vrm as { scene: THREE.Group }).scene.visible).toBe(false);

    act(() => commit(0));
    expect(onStatus.mock.calls.map((call) => call[1])).not.toContain("ready");
    expect(runtimeMocks.invalidate).toHaveBeenCalled();
    expect(runtimeMocks.applyCostume).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ hidden: ["baked-shirt"] }),
    );

    act(() => commit(1));
    expect(onStatus.mock.calls.at(-1)?.[1]).toBe("ready");
    expect((vrm as { scene: THREE.Group }).scene.visible).toBe(true);
  });

  it("does not mount attachments or a commit gate before proportion preparation succeeds", () => {
    runtimeMocks.prepare.mockReturnValueOnce({
      ok: false,
      code: "proportion-runtime-failed",
      detail: "rebuild failed",
    });

    const { onStatus, vrm } = renderRuntime(supportedSource());

    expect(onStatus.mock.calls.at(-1)?.[1]).toBe("unavailable");
    expect(onStatus.mock.calls.filter((call) => call[1] === "ready")).toHaveLength(0);
    expect(runtimeMocks.propCallbacks).toHaveLength(0);
    expect(runtimeMocks.wardrobeCallbacks).toHaveLength(0);
    expect(runtimeMocks.commitCallbacks.filter(Boolean)).toHaveLength(0);
    expect((vrm as { scene: THREE.Group }).scene.visible).toBe(false);
  });

  it("rejects a stale prepared identity before attachments can claim readiness", () => {
    runtimeMocks.prepare.mockImplementationOnce((
      _source: StudioShared3dCharacterSource,
      identityKey: string,
    ) => ({
      ok: true,
      prepared: {
        identityKey: `${identityKey}:stale`,
        preparedIdentityKey: "stale-preparation",
        rigRevision: 7,
        receipt: {
          ok: true,
          applyGeneration: 7,
          modelGeneration: "test-model-generation",
        },
        wardrobeMetrics: FALLBACK_WARDROBE_METRICS,
        propRigMetrics: DEFAULT_VRM_PROP_RIG_METRICS,
      },
    }));

    const { onStatus } = renderRuntime(supportedSource());

    expect(onStatus.mock.calls.at(-1)?.[1]).toBe("unavailable");
    expect(runtimeMocks.propCallbacks).toHaveLength(0);
    expect(runtimeMocks.wardrobeCallbacks).toHaveLength(0);
    expect(runtimeMocks.commitCallbacks.filter(Boolean)).toHaveLength(0);
  });

  it("does not restart preparation when an equivalent source object is reconstructed", () => {
    const source = supportedSource();
    const rendered = renderRuntime(source);
    const loadingCalls = rendered.onStatus.mock.calls
      .filter((call) => call[1] === "loading").length;

    rendered.rerender(
      <StudioBg3dSharedVrmAppearanceRuntime
        vrm={rendered.vrm}
        source={supportedSource()}
        runtimeOwner={rendered.runtimeOwner}
        costumeMeshes={rendered.costumeMeshes}
        onStatus={rendered.onStatus}
      />,
    );

    expect(runtimeMocks.prepare).toHaveBeenCalledTimes(1);
    expect(rendered.onStatus.mock.calls.filter((call) => call[1] === "loading"))
      .toHaveLength(loadingCalls);
  });

  it("keeps the authored costume visible and fails closed when an attachment is unavailable", () => {
    runtimeMocks.propStatus = "unavailable";
    const { onStatus } = renderRuntime(supportedSource());

    act(() => latestCommitCallback()(0));

    expect(onStatus.mock.calls.at(-1)?.[1]).toBe("unavailable");
    expect(runtimeMocks.applyCostume).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ hidden: [] }),
    );
    expect(runtimeMocks.propCallbacks).toHaveLength(0);
    expect(runtimeMocks.wardrobeCallbacks).toHaveLength(0);
  });

  it("revokes the generation when secondary grip becomes unavailable before post-commit", () => {
    const { onStatus } = renderRuntime(supportedSource());
    const commit = latestCommitCallback();

    act(() => commit(0));
    expect(onStatus.mock.calls.map((call) => call[1])).not.toContain("ready");

    act(() => {
      runtimeMocks.propCallbacks.get("shared-mug")?.(
        "shared-mug",
        "mug",
        "unavailable",
      );
    });
    act(() => commit(1));

    expect(onStatus.mock.calls.at(-1)?.[1]).toBe("unavailable");
    expect(onStatus.mock.calls.filter((call) => call[1] === "ready")).toHaveLength(0);
    expect(runtimeMocks.applyCostume).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ hidden: [] }),
    );
    expect(runtimeMocks.propCallbacks).toHaveLength(0);
    expect(runtimeMocks.wardrobeCallbacks).toHaveLength(0);
  });

  it("revokes an already-ready generation when an attachment later fails", () => {
    const { onStatus } = renderRuntime(supportedSource());
    const commit = latestCommitCallback();

    act(() => commit(0));
    act(() => commit(1));
    expect(onStatus.mock.calls.at(-1)?.[1]).toBe("ready");

    act(() => {
      runtimeMocks.propCallbacks.get("shared-mug")?.(
        "shared-mug",
        "mug",
        "unavailable",
      );
    });
    act(() => commit(2));

    expect(onStatus.mock.calls.at(-1)?.[1]).toBe("unavailable");
    expect(runtimeMocks.applyCostume).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ hidden: [] }),
    );
    expect(runtimeMocks.propCallbacks).toHaveLength(0);
    expect(runtimeMocks.wardrobeCallbacks).toHaveLength(0);
  });

  it("detects a received attachment that detaches before the later frame", () => {
    const { onStatus } = renderRuntime(supportedSource());
    const commit = latestCommitCallback();

    act(() => commit(0));
    act(() => {
      runtimeMocks.propCallbacks.get("shared-mug")?.(
        "shared-mug",
        "mug",
        "detached",
      );
    });
    act(() => commit(1));

    expect(onStatus.mock.calls.at(-1)?.[1]).toBe("unavailable");
    expect(onStatus.mock.calls.filter((call) => call[1] === "ready")).toHaveLength(0);
    expect(runtimeMocks.propCallbacks).toHaveLength(0);
    expect(runtimeMocks.wardrobeCallbacks).toHaveLength(0);
  });

  it("fails closed when a received prop uid is rebound to a different catalog item", () => {
    const { onStatus } = renderRuntime(supportedSource());
    const commit = latestCommitCallback();

    act(() => commit(0));
    act(() => {
      runtimeMocks.propCallbacks.get("shared-mug")?.(
        "shared-mug",
        "smartphone",
        "ready",
      );
      commit(1);
    });

    expect(onStatus.mock.calls.at(-1)?.[1]).toBe("unavailable");
    expect(onStatus.mock.calls.filter((call) => call[1] === "ready")).toHaveLength(0);
    expect(runtimeMocks.propCallbacks).toHaveLength(0);
    expect(runtimeMocks.wardrobeCallbacks).toHaveLength(0);
  });

  it("keeps a failed generation quarantined when a late callback reports ready", () => {
    runtimeMocks.propStatus = "unavailable";
    const { onStatus } = renderRuntime(supportedSource());
    const commit = latestCommitCallback();
    const stalePropCallback = runtimeMocks.propCallbacks.get("shared-mug");

    act(() => commit(0));
    const callsAfterFailure = onStatus.mock.calls.length;
    act(() => {
      stalePropCallback?.("shared-mug", "mug", "ready");
      commit(1);
    });

    expect(onStatus).toHaveBeenCalledTimes(callsAfterFailure);
    expect(onStatus.mock.calls.at(-1)?.[1]).toBe("unavailable");
    expect(runtimeMocks.propCallbacks).toHaveLength(0);
    expect(runtimeMocks.wardrobeCallbacks).toHaveLength(0);
  });

  it("deactivates an old generation callback after placement changes", () => {
    const firstSource = supportedSource(0);
    const nextSource = supportedSource(1);
    const nextVrm = { scene: new THREE.Group(), update: vi.fn() } as never;
    const onStatus = vi.fn();
    const rendered = renderRuntime(firstSource, onStatus);
    const oldCommit = latestCommitCallback();

    rendered.rerender(
      <StudioBg3dSharedVrmAppearanceRuntime
        vrm={nextVrm}
        source={nextSource}
        runtimeOwner={{
          vrm: nextVrm,
          modelRuntimeKey: nextSource.modelRuntimeKey,
          modelGeneration: "next-model-generation",
          runtime: {},
          disposed: false,
          prepare: runtimeMocks.prepare,
          dispose: vi.fn(),
        } as never}
        costumeMeshes={[]}
        onStatus={onStatus}
      />,
    );
    const callsBeforeStaleFrame = onStatus.mock.calls.length;

    act(() => {
      oldCommit(0);
      oldCommit(1);
    });

    expect(onStatus).toHaveBeenCalledTimes(callsBeforeStaleFrame);
  });
});
