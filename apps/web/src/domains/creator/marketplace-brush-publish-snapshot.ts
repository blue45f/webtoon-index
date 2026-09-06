function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function scoreBrushSnapshot(value: unknown, depth = 0): number {
  if (!isRecord(value) || depth > 4) return 0;
  let score = 0;
  const weights: Readonly<Record<string, number>> = {
    enginePrograms: 80,
    engineProgram: 40,
    dualBrush: 22,
    grain: 18,
    tipLayers: 18,
    extraTips: 16,
    brushTip: 14,
    pressureCurve: 12,
    dynamics: 12,
    colorDynamics: 10,
    wetMix: 10,
    watercolor: 10,
    impasto: 10,
    presetFamily: 8,
  };
  for (const [key, weight] of Object.entries(weights)) {
    if (key in value) score += weight;
  }
  for (const nested of Object.values(value)) {
    if (isRecord(nested)) score += Math.floor(scoreBrushSnapshot(nested, depth + 1) * 0.45);
  }
  return score;
}

type ReadableStorage = Pick<Storage, "length" | "key" | "getItem">;

export function findStoredBrushSnapshotForMarketplace(
  storage: ReadableStorage | null | undefined,
): unknown {
  if (!storage) return null;

  let length: number;
  try {
    length = storage.length;
  } catch {
    return null;
  }

  let best: { score: number; value: unknown } | null = null;
  const boundedLength = Math.min(Math.max(0, Math.trunc(length)), 10_000);
  for (let index = 0; index < boundedLength; index += 1) {
    let key: string | null;
    try {
      key = storage.key(index);
    } catch {
      continue;
    }
    if (!key || !/(brush|preset|studio|ink|pencil)/iu.test(key)) continue;

    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      continue;
    }
    if (!raw || raw.length > 8_000_000) continue;

    try {
      const value: unknown = JSON.parse(raw);
      const score = scoreBrushSnapshot(value);
      if (score > (best?.score ?? 0)) best = { score, value };
    } catch {
      // Non-JSON cache entries are unrelated to the portable authoring contract.
    }
  }
  return best?.value ?? null;
}
