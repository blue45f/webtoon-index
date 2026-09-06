/**
 * studio-3d-dynamic-components.ts
 *
 * Acon3D (ABLER) & Homestyler-inspired Dynamic Interactive Components Engine.
 * Allows 3D objects (doors, windows, lights, drawers, chests, vehicles) to have
 * interactive state toggles, parametric opening angles, sliding offsets, and emission toggles.
 */

export type DynamicComponentKind =
  | "door-single-swing"
  | "door-double-swing"
  | "window-sliding"
  | "furniture-drawer"
  | "treasure-chest"
  | "light-switchable"
  | "vehicle-wheel-turn"
  | "book-open-close";

export interface DynamicComponentState {
  readonly id: string;
  readonly kind: DynamicComponentKind;
  readonly label: string;
  readonly isOpen: boolean;
  readonly value: number; // 0.0 (fully closed/off) to 1.0 (fully open/on)
  readonly maxRange: number; // e.g., 90 (degrees) or 0.8 (meters for sliding)
  readonly transformAxis: "x" | "y" | "z";
  readonly pivotOffset: readonly [number, number, number];
}

export interface DynamicComponentTransformResult {
  readonly id: string;
  readonly rotation: readonly [number, number, number]; // in degrees
  readonly position: readonly [number, number, number]; // in meters
  readonly rotationDelta: readonly [number, number, number]; // in degrees
  readonly translationDelta: readonly [number, number, number]; // in meters
  readonly emissiveIntensity: number; // 0.0 to 1.0 for lights
  readonly isOpen: boolean;
  readonly stateLabel: string;
}

export const DYNAMIC_COMPONENT_PRESETS: readonly {
  readonly kind: DynamicComponentKind;
  readonly label: string;
  readonly interactionType: "revolve" | "slide" | "toggle";
  readonly defaultMaxRange: number;
  readonly defaultAxis: "x" | "y" | "z";
  readonly pivotOffset: readonly [number, number, number];
}[] = [
  {
    kind: "door-single-swing",
    label: "단일 여닫이문 (Door Swing)",
    interactionType: "revolve",
    defaultMaxRange: 90,
    defaultAxis: "y",
    pivotOffset: [-0.45, 0, 0],
  },
  {
    kind: "door-double-swing",
    label: "양개형 여닫이문 (Double Door)",
    interactionType: "revolve",
    defaultMaxRange: 90,
    defaultAxis: "y",
    pivotOffset: [0, 0, 0],
  },
  {
    kind: "window-sliding",
    label: "미닫이 창문 (Sliding Window)",
    interactionType: "slide",
    defaultMaxRange: 0.8,
    defaultAxis: "x",
    pivotOffset: [0, 0, 0],
  },
  {
    kind: "furniture-drawer",
    label: "서랍장 서랍 (Furniture Drawer)",
    interactionType: "slide",
    defaultMaxRange: 0.45,
    defaultAxis: "z",
    pivotOffset: [0, 0, 0],
  },
  {
    kind: "treasure-chest",
    label: "보물상자 / 뚜껑 (Chest Lid)",
    interactionType: "revolve",
    defaultMaxRange: 105,
    defaultAxis: "x",
    pivotOffset: [0, 0.2, -0.3],
  },
  {
    kind: "light-switchable",
    label: "전등 / 가로등 (Switchable Light)",
    interactionType: "toggle",
    defaultMaxRange: 1.0,
    defaultAxis: "y",
    pivotOffset: [0, 0, 0],
  },
  {
    kind: "vehicle-wheel-turn",
    label: "차량 조향 바퀴 (Wheel Steer)",
    interactionType: "revolve",
    defaultMaxRange: 35,
    defaultAxis: "y",
    pivotOffset: [0, 0, 0],
  },
  {
    kind: "book-open-close",
    label: "마법서 / 책 펼침 (Book Cover)",
    interactionType: "revolve",
    defaultMaxRange: 170,
    defaultAxis: "y",
    pivotOffset: [-0.15, 0, 0],
  },
];

/**
 * Creates an initial dynamic component state
 */
export function createDynamicComponent(
  id: string,
  kind: DynamicComponentKind,
  initialOpen = false,
  customMaxRange?: number,
): DynamicComponentState {
  const preset = DYNAMIC_COMPONENT_PRESETS.find((p) => p.kind === kind) ?? DYNAMIC_COMPONENT_PRESETS[0]!;
  const maxRange = customMaxRange ?? preset.defaultMaxRange;

  return {
    id,
    kind,
    label: preset.label,
    isOpen: initialOpen,
    value: initialOpen ? 1.0 : 0.0,
    maxRange,
    transformAxis: preset.defaultAxis,
    pivotOffset: preset.pivotOffset,
  };
}

/**
 * Toggles or sets the interpolation ratio for a dynamic component
 */
export function setDynamicComponentValue(
  state: DynamicComponentState,
  newValue: number,
): DynamicComponentState {
  const clampedValue = Math.max(0, Math.min(1, newValue));
  return {
    ...state,
    value: clampedValue,
    isOpen: clampedValue > 0.01,
  };
}

/**
 * Evaluates the transform deltas (rotation, translation, light intensity)
 * to be applied to the 3D scene node based on component state.
 */
export function evaluateDynamicComponentTransform(
  state: DynamicComponentState,
): DynamicComponentTransformResult {
  let rotX = 0;
  let rotY = 0;
  let rotZ = 0;
  let posX = 0;
  let posY = 0;
  let posZ = 0;
  let emissiveIntensity = 0;

  const currentAmount = state.value * state.maxRange;

  switch (state.kind) {
    case "door-single-swing":
    case "door-double-swing":
    case "vehicle-wheel-turn":
    case "book-open-close": {
      if (state.transformAxis === "y") {
        rotY = currentAmount;
      } else if (state.transformAxis === "x") {
        rotX = currentAmount;
      } else {
        rotZ = currentAmount;
      }
      break;
    }

    case "treasure-chest": {
      rotX = -currentAmount;
      break;
    }

    case "window-sliding": {
      if (state.transformAxis === "x") {
        posX = currentAmount;
      } else if (state.transformAxis === "y") {
        posY = currentAmount;
      } else {
        posZ = currentAmount;
      }
      break;
    }

    case "furniture-drawer": {
      posZ = currentAmount;
      break;
    }

    case "light-switchable": {
      emissiveIntensity = state.value;
      break;
    }
  }

  const percentLabel = Math.round(state.value * 100);
  const stateLabel =
    state.kind === "light-switchable"
      ? state.value > 0.5
        ? "ON (점등)"
        : "OFF (소등)"
      : state.value <= 0.01
        ? "닫힘 (Closed)"
        : state.value >= 0.99
          ? "완전 개방 (Open)"
          : `${percentLabel}% 개방`;

  const rotation = [rotX, rotY, rotZ] as const;
  const position = [posX, posY, posZ] as const;

  return {
    id: state.id,
    rotation,
    position,
    rotationDelta: rotation,
    translationDelta: position,
    emissiveIntensity,
    isOpen: state.isOpen,
    stateLabel,
  };
}
