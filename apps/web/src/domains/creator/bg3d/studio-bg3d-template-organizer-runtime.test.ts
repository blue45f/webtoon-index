import { describe, expect, it, vi } from "vitest";

import {
  runStudioBg3dTemplateOrganizerCommand,
  type StudioBg3dTemplateOrganizerCommandRequest,
} from "./studio-bg3d-template-organizer-runtime";

function instance(id: string, nodeId = `${id}-node`) {
  return {
    id,
    nodes: [{ id: nodeId }],
  };
}

function request(
  session: object,
  overrides: Partial<StudioBg3dTemplateOrganizerCommandRequest> = {},
): StudioBg3dTemplateOrganizerCommandRequest {
  return {
    command: "delete-all",
    targetInstanceIds: ["confirmed"],
    membershipInstanceIds: ["confirmed"],
    session,
    sceneEpoch: 7,
    ...overrides,
  };
}

describe("Studio BG3D template organizer lazy command fence", () => {
  it("does not let a command from a closed session write into the reopened editor", () => {
    const capturedSession = {};
    const currentSession = {};
    const setError = vi.fn();
    const planRemoval = vi.fn();

    runStudioBg3dTemplateOrganizerCommand({
      templateInstances: [instance("confirmed")],
      modalAssetSessionRef: { current: currentSession },
      isModalAssetSessionCurrent: (candidate: object) => candidate === currentSession,
      ltInsertSceneEpochRef: { current: 7 },
      setError,
      planStudioBg3dSceneEntityRemoval: planRemoval,
    }, request(capturedSession));

    expect(planRemoval).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });

  it("fails closed when scene generation changes before the lazy module resolves", () => {
    const session = {};
    const setError = vi.fn();
    const planRemoval = vi.fn();

    runStudioBg3dTemplateOrganizerCommand({
      templateInstances: [instance("confirmed")],
      modalAssetSessionRef: { current: session },
      isModalAssetSessionCurrent: (candidate: object) => candidate === session,
      ltInsertSceneEpochRef: { current: 8 },
      setError,
      planStudioBg3dSceneEntityRemoval: planRemoval,
    }, request(session));

    expect(planRemoval).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith(expect.stringContaining("변경되어"));
  });

  it("never expands a confirmed delete-all target to a newly added template", () => {
    const session = {};
    const setError = vi.fn();
    const planRemoval = vi.fn();

    runStudioBg3dTemplateOrganizerCommand({
      templateInstances: [instance("confirmed"), instance("added-after-confirmation")],
      modalAssetSessionRef: { current: session },
      isModalAssetSessionCurrent: (candidate: object) => candidate === session,
      ltInsertSceneEpochRef: { current: 7 },
      setError,
      planStudioBg3dSceneEntityRemoval: planRemoval,
    }, request(session));

    expect(planRemoval).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith(expect.stringContaining("변경되어"));
  });

  it("deletes exactly the click-time targets when the session, scene, and membership still match", () => {
    const session = {};
    const live = {
      primitives: [{ id: "confirmed-node" }, { id: "ordinary-node" }],
      customModels: [],
      document: {},
    };
    const next = {
      ...live,
      primitives: [{ id: "ordinary-node" }],
    };
    let plannedEntityIds: string[] = [];
    const planRemoval = vi.fn((input: { readonly entityIds: ReadonlySet<string> }) => {
      plannedEntityIds = [...input.entityIds];
      return { ok: true, snapshot: next };
    });
    const commitHistory = vi.fn();
    const commitRemoval = vi.fn();
    const setSelectedIds = vi.fn();

    runStudioBg3dTemplateOrganizerCommand({
      templateInstances: [instance("confirmed", "confirmed-node")],
      modalAssetSessionRef: { current: session },
      isModalAssetSessionCurrent: (candidate: object) => candidate === session,
      ltInsertSceneEpochRef: { current: 7 },
      templateOrganizationBlockedReason: null,
      physicsRuntimeSourceRef: { current: live },
      planStudioBg3dSceneEntityRemoval: planRemoval,
      createStudioBg3dHistorySnapshot: vi.fn(() => ({ before: true })),
      commitImmediateHistoryTransition: commitHistory,
      commitSceneEntityRemoval: commitRemoval,
      setSelectedIds,
      setIsTransforming: vi.fn(),
      setError: vi.fn(),
    }, request(session));

    expect(planRemoval).toHaveBeenCalledTimes(1);
    expect(plannedEntityIds).toEqual(["confirmed-node"]);
    expect(commitHistory).toHaveBeenCalledTimes(1);
    expect(commitRemoval).toHaveBeenCalledWith({ ok: true, snapshot: next });
    expect(setSelectedIds).toHaveBeenCalledTimes(1);
  });
});
