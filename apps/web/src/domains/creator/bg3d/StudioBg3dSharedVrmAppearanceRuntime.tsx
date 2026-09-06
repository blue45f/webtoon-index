import { useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { parseAvatarForgeState } from "../vrm/studio-vrm-avatar-forge";
import { createStudioVrmAvatarForgeFaceController } from "../vrm/studio-vrm-avatar-forge-face-controller";
import { parseCostumeState } from "../vrm/studio-vrm-costume";
import {
  applyStudioVrmCostumeState,
  type StudioVrmCostumeMeshEntry,
} from "../vrm/studio-vrm-costume-runtime";
import { inspectStudioVrmGarmentFit } from "../vrm/studio-vrm-garment-fit";
import {
  applyStudioVrmLinkedAppearanceReadinessReceipt,
  type StudioVrmLinkedAppearanceReadinessReceipt,
  type StudioVrmLinkedAppearanceReadinessState,
} from "../vrm/studio-vrm-linked-appearance-readiness";
import { createStudioVrmLinkedAppearanceReadinessPlan } from "../vrm/studio-vrm-linked-appearance-readiness-plan";
import {
  scaleVrmPropRigMetrics,
} from "../vrm/studio-vrm-prop-rig";
import {
  WARDROBE_SLOTS,
  mergeWardrobeCostumeVisibility,
  type WardrobeSlot,
  type WardrobeState,
} from "../vrm/studio-vrm-wardrobe";
import { StudioVrmAvatarForge } from "../vrm/StudioVrmAvatarForge";
import {
  StudioVrmPropAttachment,
  StudioVrmRuntimeCommit,
  StudioVrmWardrobeAttachment,
  type StudioVrmProjectionAttachmentStatus,
  type StudioVrmWardrobeSurfaceReceipt,
} from "../vrm/StudioVrmWardrobePropsProjection";

import type {
  StudioBg3dLinkedVrmPreparedState,
  StudioBg3dLinkedVrmRuntimeOwner,
} from "./studio-bg3d-shared-vrm-runtime";
import type { StudioShared3dCharacterSource } from "../studio-shared-3d-scene-bridge";
import type { VRM } from "@pixiv/three-vrm";

type ProjectionStatus = "loading" | "ready" | "unavailable";

interface AttachmentRegistryEntry {
  readonly id: string;
  readonly status: Exclude<StudioVrmProjectionAttachmentStatus, "detached">;
}

interface AttachmentRegistry {
  readonly wardrobe: Map<string, AttachmentRegistryEntry>;
  readonly props: Map<string, AttachmentRegistryEntry>;
}

interface BaseProjectionState {
  readonly identityKey: string;
  readonly preparedIdentityKey: string | null;
  readonly rigRevision: number | null;
  readonly status: "pending" | "ready" | "unavailable";
}

interface AttachmentFailureSignal {
  readonly identityKey: string;
  readonly code: string;
  readonly detail: string;
}

let linkedAppearanceGeneration = 0;

function allocateLinkedAppearanceGeneration(): number {
  if (linkedAppearanceGeneration >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Linked appearance generation space exhausted.");
  }
  linkedAppearanceGeneration += 1;
  return linkedAppearanceGeneration;
}

function projectionIdentityKey(source: StudioShared3dCharacterSource): string {
  return JSON.stringify([
    source.runtimeKey,
    source.placementHash,
    source.compatibility.appearanceProjection.signature,
  ]);
}

function wardrobeStateFromSource(source: StudioShared3dCharacterSource): WardrobeState {
  const projection = source.compatibility.appearanceProjection;
  if (
    projection.wardrobe.status !== "supported"
    || projection.handProps.status === "unsupported"
  ) return {};

  return Object.fromEntries(projection.wardrobe.slots.map((entry) => [entry.slot, {
    itemId: entry.itemId,
    color: entry.color,
    fit: entry.fit,
    fitMode: entry.fitMode,
    fabricId: entry.fabricId,
  }])) as WardrobeState;
}

function applyProjectionCostume({
  source,
  costumeMeshes,
  wardrobeState,
  includeProjectedWardrobe,
}: {
  source: StudioShared3dCharacterSource;
  costumeMeshes: StudioVrmCostumeMeshEntry[];
  wardrobeState: WardrobeState;
  includeProjectedWardrobe: boolean;
}): boolean {
  try {
    const projection = source.compatibility.appearanceProjection;
    const authoredCostume = parseCostumeState(source.scene.appearance.costume);
    const autoHideOriginal = includeProjectedWardrobe
      && projection.wardrobe.status === "supported"
      ? projection.wardrobe.autoHideOriginal
      : false;
    applyStudioVrmCostumeState(
      costumeMeshes,
      mergeWardrobeCostumeVisibility(
        authoredCostume,
        includeProjectedWardrobe ? wardrobeState : {},
        costumeMeshes,
        autoHideOriginal,
      ),
    );
    return true;
  } catch {
    return false;
  }
}

function ignoreWardrobeSurfaceReceipt(
  _slot: WardrobeSlot,
  _receipt: StudioVrmWardrobeSurfaceReceipt | null,
) {}

function StudioBg3dSharedVrmReadinessGate({
  vrm,
  source,
  identityKey,
  preparedIdentityKey,
  rigRevision,
  registry,
  baseProjectionRef,
  attachmentFailureRef,
  onAttachmentsReady,
  onStatus,
}: {
  vrm: VRM;
  source: StudioShared3dCharacterSource;
  identityKey: string;
  preparedIdentityKey: string;
  rigRevision: number;
  registry: AttachmentRegistry;
  baseProjectionRef: RefObject<BaseProjectionState>;
  attachmentFailureRef: RefObject<AttachmentFailureSignal | null>;
  onAttachmentsReady: () => boolean;
  onStatus: (status: ProjectionStatus) => void;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const [run] = useState(() => ({
    result: createStudioVrmLinkedAppearanceReadinessPlan(
      source.compatibility.appearanceProjection,
      {
        runtimeKey: source.runtimeKey,
        placementHash: source.placementHash,
        generation: allocateLinkedAppearanceGeneration(),
      },
    ),
  }));
  const readinessStateRef = useRef<StudioVrmLinkedAppearanceReadinessState | null>(
    run.result.ok ? run.result.state : null,
  );
  const onStatusRef = useRef(onStatus);
  const activeRef = useRef(false);
  const settledRef = useRef<"ready" | "unavailable" | null>(null);
  const attachmentsActivatedRef = useRef(false);

  useLayoutEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useLayoutEffect(() => {
    activeRef.current = true;
    onStatusRef.current("loading");
    if (!run.result.ok) {
      settledRef.current = "unavailable";
      onStatusRef.current("unavailable");
    } else {
      invalidate();
    }
    return () => {
      activeRef.current = false;
    };
  }, [invalidate, run]);

  function finishUnavailable() {
    if (settledRef.current === "unavailable") return;
    settledRef.current = "unavailable";
    onStatusRef.current("unavailable");
  }

  function applyReceipt(receipt: StudioVrmLinkedAppearanceReadinessReceipt) {
    const current = readinessStateRef.current;
    if (!current) return null;
    try {
      const transition = applyStudioVrmLinkedAppearanceReadinessReceipt(current, receipt);
      readinessStateRef.current = transition.state;
      if (transition.snapshot.status === "unavailable") finishUnavailable();
      return transition.snapshot;
    } catch {
      finishUnavailable();
      return null;
    }
  }

  function failRuntime(code: string, detail: string) {
    const state = readinessStateRef.current;
    if (!state || settledRef.current === "unavailable") return;
    applyReceipt({
      kind: "failure",
      identity: state.identity,
      code,
      detail,
    });
  }

  function handleCommitFrame(frame: number) {
    if (!activeRef.current || settledRef.current === "unavailable" || !run.result.ok) return;
    const attachmentFailure = attachmentFailureRef.current;
    if (attachmentFailure?.identityKey === identityKey) {
      failRuntime(attachmentFailure.code, attachmentFailure.detail);
      return;
    }
    const baseProjection = baseProjectionRef.current;
    if (
      !baseProjection
      || baseProjection.identityKey !== identityKey
      || baseProjection.preparedIdentityKey !== preparedIdentityKey
      || baseProjection.rigRevision !== rigRevision
    ) return;
    if (baseProjection.status === "unavailable") {
      failRuntime("base-projection-unavailable", "The canonical VRM state could not be applied.");
      return;
    }
    if (baseProjection.status !== "ready") return;

    let current = readinessStateRef.current;
    if (!current) {
      finishUnavailable();
      return;
    }

    for (const expected of current.expectedWardrobe) {
      const received = current.receivedWardrobe.some((entry) => entry.slot === expected.slot);
      const attachment = registry.wardrobe.get(expected.slot);
      if (!attachment || attachment.id !== expected.itemId) {
        if (received || current.commitFrame !== null || settledRef.current === "ready") {
          failRuntime(
            "wardrobe-attachment-detached",
            `Wardrobe slot ${expected.slot} lost item ${expected.itemId} after attachment.`,
          );
        }
        return;
      }
      if (attachment.status === "unavailable") {
        failRuntime(
          "wardrobe-attachment-unavailable",
          `Wardrobe slot ${expected.slot} could not attach item ${expected.itemId}.`,
        );
        return;
      }
      if (received) continue;
      const snapshot = applyReceipt({
        kind: "wardrobe-attached",
        identity: current.identity,
        frame,
        slot: expected.slot,
        itemId: expected.itemId,
      });
      if (!snapshot || snapshot.status === "unavailable") return;
      current = readinessStateRef.current!;
    }

    for (const expected of current.expectedProps) {
      const received = current.receivedProps.some((entry) => entry.uid === expected.uid);
      const attachment = registry.props.get(expected.uid);
      if (!attachment || attachment.id !== expected.propId) {
        if (received || current.commitFrame !== null || settledRef.current === "ready") {
          failRuntime(
            "prop-attachment-detached",
            `Prop ${expected.uid} lost ${expected.propId} after attachment.`,
          );
        }
        return;
      }
      if (attachment.status === "unavailable") {
        failRuntime(
          "prop-attachment-unavailable",
          `Prop ${expected.uid} could not attach ${expected.propId}.`,
        );
        return;
      }
      if (received) continue;
      const snapshot = applyReceipt({
        kind: "prop-attached",
        identity: current.identity,
        frame,
        uid: expected.uid,
        propId: expected.propId,
      });
      if (!snapshot || snapshot.status === "unavailable") return;
      current = readinessStateRef.current!;
    }

    // A ready generation remains monitored. A later detach/unavailable transition must revoke
    // capture authority instead of leaving an old ready receipt permanently trusted.
    if (settledRef.current === "ready") return;

    if (!attachmentsActivatedRef.current) {
      try {
        if (!onAttachmentsReady()) {
          failRuntime(
            "appearance-activation-unavailable",
            "The projected appearance could not be activated.",
          );
          return;
        }
        attachmentsActivatedRef.current = true;
      } catch {
        failRuntime(
          "appearance-activation-unavailable",
          "The projected appearance could not be activated.",
        );
        return;
      }
    }

    if (current.commitFrame === null) {
      const snapshot = applyReceipt({
        kind: "runtime-commit",
        identity: current.identity,
        frame,
      });
      if (!snapshot || snapshot.status === "unavailable") return;
      invalidate();
      return;
    }

    if (current.postCommitFrame === null && frame > current.commitFrame) {
      const snapshot = applyReceipt({
        kind: "post-commit",
        identity: current.identity,
        frame,
      });
      if (snapshot?.status === "ready") {
        settledRef.current = "ready";
        onStatusRef.current("ready");
      }
    }
  }

  if (!run.result.ok) return null;
  return (
    <StudioVrmRuntimeCommit
      vrm={vrm}
      physicsPreview={false}
      webcamActive={false}
      onCommitFrame={handleCommitFrame}
    />
  );
}

/**
 * Projects the exact wardrobe and hand-prop subset admitted by the pure compatibility plan.
 * The base VRM remains source-authoritative; procedural attachments are runtime-only children.
 */
export function StudioBg3dSharedVrmAppearanceRuntime({
  vrm,
  source,
  runtimeOwner,
  costumeMeshes,
  onStatus,
}: {
  vrm: VRM;
  source: StudioShared3dCharacterSource;
  runtimeOwner: StudioBg3dLinkedVrmRuntimeOwner;
  costumeMeshes: StudioVrmCostumeMeshEntry[];
  onStatus: (identityKey: string, status: ProjectionStatus) => void;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const identityKey = projectionIdentityKey(source);
  const projection = source.compatibility.appearanceProjection;
  const fullySupported = projection.wardrobe.status !== "unsupported"
    && projection.handProps.status !== "unsupported";
  const wardrobeState = fullySupported ? wardrobeStateFromSource(source) : {};
  const registryRef = useRef<AttachmentRegistry>({
    wardrobe: new Map(),
    props: new Map(),
  });
  const baseProjectionRef = useRef<BaseProjectionState>({
    identityKey,
    preparedIdentityKey: null,
    rigRevision: null,
    status: "pending",
  });
  const attachmentFailureRef = useRef<AttachmentFailureSignal | null>(null);
  const activePreparedIdentityRef = useRef<string | null>(null);
  const activatedAppearanceIdentityRef = useRef<string | null>(null);
  const onStatusRef = useRef(onStatus);
  const sourceRef = useRef(source);
  const [prepared, setPrepared] = useState<StudioBg3dLinkedVrmPreparedState | null>(null);
  const [attachmentsQuarantined, setAttachmentsQuarantined] = useState(false);
  const [faceController] = useState(createStudioVrmAvatarForgeFaceController);
  const forgeState = parseAvatarForgeState(source.scene.appearance.avatarForge);

  useEffect(() => () => {
    faceController.dispose();
  }, [faceController]);

  useLayoutEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useLayoutEffect(() => {
    sourceRef.current = source;
  }, [source]);

  useLayoutEffect(() => {
    const preparedSource = sourceRef.current;
    // The primitive is already mounted by the model owner, but an unprepared/rest or stale prior
    // generation must never flash into the shared stage before its receipt gate is complete.
    vrm.scene.visible = false;
    activePreparedIdentityRef.current = null;
    activatedAppearanceIdentityRef.current = null;
    attachmentFailureRef.current = null;
    registryRef.current = { wardrobe: new Map(), props: new Map() };
    baseProjectionRef.current = {
      identityKey,
      preparedIdentityKey: null,
      rigRevision: null,
      status: "pending",
    };
    setPrepared(null);
    setAttachmentsQuarantined(false);
    onStatusRef.current(identityKey, "loading");
    try {
      if (runtimeOwner.vrm !== vrm) throw new Error("stale-vrm-runtime-owner");
      const result = runtimeOwner.prepare(preparedSource, identityKey, {
        projectHandProps: fullySupported,
      });
      if (!result.ok) {
        baseProjectionRef.current = {
          identityKey,
          preparedIdentityKey: null,
          rigRevision: null,
          status: "unavailable",
        };
        onStatusRef.current(identityKey, "unavailable");
        invalidate();
        return;
      }
      if (
        result.prepared.identityKey !== identityKey
        || result.prepared.preparedIdentityKey.length === 0
        || !Number.isSafeInteger(result.prepared.rigRevision)
        || result.prepared.rigRevision < 1
        || result.prepared.receipt.applyGeneration !== result.prepared.rigRevision
        || result.prepared.receipt.modelGeneration !== runtimeOwner.modelGeneration
      ) {
        baseProjectionRef.current = {
          identityKey,
          preparedIdentityKey: null,
          rigRevision: null,
          status: "unavailable",
        };
        onStatusRef.current(identityKey, "unavailable");
        invalidate();
        return;
      }

      if (!applyProjectionCostume({
        source: preparedSource,
        costumeMeshes,
        wardrobeState: fullySupported ? wardrobeStateFromSource(preparedSource) : {},
        includeProjectedWardrobe: false,
      })) {
        baseProjectionRef.current = {
          identityKey,
          preparedIdentityKey: null,
          rigRevision: null,
          status: "unavailable",
        };
        onStatusRef.current(identityKey, "unavailable");
        invalidate();
        return;
      }
      activePreparedIdentityRef.current = result.prepared.preparedIdentityKey;
      baseProjectionRef.current = {
        identityKey,
        preparedIdentityKey: result.prepared.preparedIdentityKey,
        rigRevision: result.prepared.rigRevision,
        status: "ready",
      };
      setPrepared(result.prepared);
    } catch {
      baseProjectionRef.current = {
        identityKey,
        preparedIdentityKey: null,
        rigRevision: null,
        status: "unavailable",
      };
      onStatusRef.current(identityKey, "unavailable");
    }
    invalidate();
  }, [
    costumeMeshes,
    fullySupported,
    identityKey,
    invalidate,
    runtimeOwner,
    vrm,
  ]);

  const preparedForIdentity = prepared?.identityKey === identityKey
    && activePreparedIdentityRef.current === prepared.preparedIdentityKey
    ? prepared
    : null;
  const preparedIdentityKey = preparedForIdentity?.preparedIdentityKey ?? null;
  const fitReport = preparedForIdentity
    ? inspectStudioVrmGarmentFit(wardrobeState, preparedForIdentity.wardrobeMetrics)
    : null;
  const effectivePropRigMetrics = preparedForIdentity
    ? scaleVrmPropRigMetrics(
        preparedForIdentity.propRigMetrics,
        source.scene.appearance.bodyScale,
      )
    : null;

  function handleAttachmentsReady(): boolean {
    if (
      !preparedIdentityKey
      || activePreparedIdentityRef.current !== preparedIdentityKey
    ) return false;
    if (!applyProjectionCostume({
      source,
      costumeMeshes,
      wardrobeState: fullySupported ? wardrobeStateFromSource(source) : {},
      includeProjectedWardrobe: true,
    })) return false;
    activatedAppearanceIdentityRef.current = preparedIdentityKey;
    invalidate();
    return true;
  }

  function handleProjectionStatus(status: ProjectionStatus) {
    if (
      !preparedIdentityKey
      || activePreparedIdentityRef.current !== preparedIdentityKey
    ) return;
    vrm.scene.visible = status === "ready";
    if (status === "loading" || status === "unavailable") {
      if (
        activatedAppearanceIdentityRef.current !== preparedIdentityKey
        || status === "unavailable"
      ) {
        activatedAppearanceIdentityRef.current = null;
        applyProjectionCostume({
          source,
          costumeMeshes,
          wardrobeState: {},
          includeProjectedWardrobe: false,
        });
      }
      if (status === "unavailable") {
        // A terminal generation must not leave a visibly broken rigid fallback, an ungripped prop,
        // or procedural clothing layered over the restored authored costume. Remounting this
        // identity is the only recovery path, so late "ready" callbacks cannot reveal it again.
        setAttachmentsQuarantined(true);
      }
    }
    onStatusRef.current(identityKey, status);
  }

  function handlePropAttachmentStatus(
    uid: string,
    propId: string,
    status: StudioVrmProjectionAttachmentStatus,
  ) {
    if (
      !preparedIdentityKey
      || activePreparedIdentityRef.current !== preparedIdentityKey
    ) return;
    const registry = registryRef.current.props;
    if (status === "detached") {
      if (registry.get(uid)?.id === propId) registry.delete(uid);
    } else {
      registry.set(uid, { id: propId, status });
    }
    if (status === "unavailable") {
      attachmentFailureRef.current = {
        identityKey,
        code: "prop-attachment-unavailable",
        detail: `Prop ${uid} could not keep ${propId} attached.`,
      };
    }
    invalidate();
  }

  function handleWardrobeAttachmentStatus(
    slot: WardrobeSlot,
    itemId: string,
    status: StudioVrmProjectionAttachmentStatus,
  ) {
    if (
      !preparedIdentityKey
      || activePreparedIdentityRef.current !== preparedIdentityKey
    ) return;
    const registry = registryRef.current.wardrobe;
    if (status === "detached") {
      if (registry.get(slot)?.id === itemId) registry.delete(slot);
    } else {
      registry.set(slot, { id: itemId, status });
    }
    if (status === "unavailable") {
      attachmentFailureRef.current = {
        identityKey,
        code: "wardrobe-attachment-unavailable",
        detail: `Wardrobe slot ${slot} could not keep item ${itemId} attached.`,
      };
    }
    invalidate();
  }

  return (
    <>
      {preparedForIdentity
        && effectivePropRigMetrics
        && fullySupported
        && !attachmentsQuarantined
        && projection.handProps.status === "supported"
        ? projection.handProps.props.map((prop) => (
            <StudioVrmPropAttachment
              key={`${preparedForIdentity.preparedIdentityKey}:${prop.uid}`}
              vrm={vrm}
              instance={prop.instance}
              metrics={effectivePropRigMetrics}
              rigRevision={preparedForIdentity.rigRevision}
              onAttachmentStatus={handlePropAttachmentStatus}
            />
          ))
        : null}
      {preparedForIdentity
        && fitReport
        && fullySupported
        && !attachmentsQuarantined
        && projection.wardrobe.status === "supported"
        ? WARDROBE_SLOTS.map((slot) => {
            const equip = wardrobeState[slot];
            const slotFit = fitReport.slots[slot];
            return equip ? (
              <StudioVrmWardrobeAttachment
                key={`${preparedForIdentity.preparedIdentityKey}:${slot}`}
                vrm={vrm}
                slot={slot}
                equip={equip}
                metrics={preparedForIdentity.wardrobeMetrics}
                effectiveFit={slotFit?.effectiveFit ?? equip.fit}
                rigRevision={preparedForIdentity.rigRevision}
                onSurfaceReceipt={ignoreWardrobeSurfaceReceipt}
                onAttachmentStatus={handleWardrobeAttachmentStatus}
              />
            ) : null;
          })
        : null}
      {preparedForIdentity ? (
        <StudioVrmAvatarForge
          vrm={vrm}
          state={forgeState}
          rigRevision={preparedForIdentity.rigRevision}
          faceController={faceController}
        />
      ) : null}
      {preparedForIdentity ? (
        <StudioBg3dSharedVrmReadinessGate
          key={preparedForIdentity.preparedIdentityKey}
          vrm={vrm}
          source={source}
          identityKey={identityKey}
          preparedIdentityKey={preparedForIdentity.preparedIdentityKey}
          rigRevision={preparedForIdentity.rigRevision}
          registry={registryRef.current}
          baseProjectionRef={baseProjectionRef}
          attachmentFailureRef={attachmentFailureRef}
          onAttachmentsReady={handleAttachmentsReady}
          onStatus={handleProjectionStatus}
        />
      ) : null}
    </>
  );
}
