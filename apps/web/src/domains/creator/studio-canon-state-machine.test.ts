import { describe, expect, it } from "vitest";

import {
  addCanonStateTransition,
  createStudioCanonStateMachine,
  detectCanonRuleViolations,
  queryCanonStateAtPanel,
  removeCanonStateTransition,
  updateCanonStateTransition,
  type CanonStateTransition,
} from "./studio-canon-state-machine";

describe("Studio Canon State Machine", () => {
  function makeTransition(
    id: string,
    characterId: string,
    panelOrderIndex: number,
    panelId: string,
    partial: Partial<CanonStateTransition> = {},
  ): CanonStateTransition {
    return {
      id,
      characterId,
      panelOrderIndex,
      panelId,
      stage: "canon",
      reason: "기본 진행",
      snapshot: {
        characterId,
        survivalStatus: "alive",
        appearance: { costumeRef: "school_uniform", hairstyleRef: "bob" },
        possessions: ["wooden_sword"],
        currentLocationRef: "classroom",
      },
      ...partial,
    };
  }

  it("queries canon state at specific panel index", () => {
    const t0 = makeTransition("t0", "hero", 0, "p0");
    const t5 = makeTransition("t5", "hero", 5, "p5", {
      reason: "부상 획득",
      snapshot: {
        characterId: "hero",
        survivalStatus: "alive",
        appearance: { costumeRef: "school_uniform", wounds: ["left_arm_cut"] },
      },
    });

    const sm = createStudioCanonStateMachine({ id: "sm_1", transitions: [t0, t5] });

    // Panel 3 -> should return t0
    const stateAt3 = queryCanonStateAtPanel(sm, "hero", 3);
    expect(stateAt3?.appearance.wounds).toBeUndefined();

    // Panel 6 -> should return t5
    const stateAt6 = queryCanonStateAtPanel(sm, "hero", 6);
    expect(stateAt6?.appearance.wounds).toEqual(["left_arm_cut"]);

    // Unknown character
    expect(queryCanonStateAtPanel(sm, "unknown", 10)).toBeNull();
  });

  it("detects unexplained healing violation", () => {
    const t1 = makeTransition("t1", "hero", 1, "p1", {
      reason: "전투 부상",
      snapshot: {
        characterId: "hero",
        survivalStatus: "alive",
        appearance: { wounds: ["face_scar"] },
      },
    });
    const t2 = makeTransition("t2", "hero", 2, "p2", {
      reason: "교실 대화", // No healing keyword
      snapshot: {
        characterId: "hero",
        survivalStatus: "alive",
        appearance: { wounds: [] }, // suddenly healed
      },
    });

    const sm = createStudioCanonStateMachine({ id: "sm_err", transitions: [t1, t2] });
    const diags = detectCanonRuleViolations(sm);

    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("UNEXPLAINED_HEALING");
    expect(diags[0].characterId).toBe("hero");
  });

  it("detects post mortem resurrection violation", () => {
    const t1 = makeTransition("t1", "rival", 1, "p1", {
      reason: "최후의 결전 사망",
      snapshot: {
        characterId: "rival",
        survivalStatus: "deceased",
        appearance: {},
      },
    });
    const t2 = makeTransition("t2", "rival", 5, "p5", {
      reason: "일상 장면 등장",
      snapshot: {
        characterId: "rival",
        survivalStatus: "alive",
        appearance: {},
      },
    });

    const sm = createStudioCanonStateMachine({ id: "sm_dead", transitions: [t1, t2] });
    const diags = detectCanonRuleViolations(sm);

    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("POST_MORTEM_ACTION");
    expect(diags[0].severity).toBe("error");
  });

  it("supports adding, updating, removing transitions", () => {
    let sm = createStudioCanonStateMachine({ id: "sm_ops" });
    const t1 = makeTransition("t1", "char1", 1, "p1");
    sm = addCanonStateTransition(sm, t1);
    expect(sm.transitions).toHaveLength(1);

    sm = updateCanonStateTransition(sm, "t1", { reason: "수정된 사유" });
    expect(sm.transitions[0].reason).toBe("수정된 사유");

    sm = removeCanonStateTransition(sm, "t1");
    expect(sm.transitions).toHaveLength(0);
  });
});
