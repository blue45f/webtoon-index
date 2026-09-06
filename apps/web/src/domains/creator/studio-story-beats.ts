export const SCENARIO_BEAT_TYPES = [
  "setup",
  "inciting",
  "escalation",
  "turn",
  "climax",
  "resolution",
  "transition",
] as const;

export type ScenarioBeatType = (typeof SCENARIO_BEAT_TYPES)[number];

export const SCENARIO_BEAT_LABELS: Record<ScenarioBeatType, string> = {
  setup: "도입",
  inciting: "사건 발생",
  escalation: "고조",
  turn: "전환",
  climax: "절정",
  resolution: "해결",
  transition: "연결",
};

const SCENARIO_BEAT_TYPE_SET = new Set<string>(SCENARIO_BEAT_TYPES);

export function normalizeScenarioBeatType(value: unknown): ScenarioBeatType {
  return typeof value === "string" && SCENARIO_BEAT_TYPE_SET.has(value)
    ? (value as ScenarioBeatType)
    : "transition";
}
