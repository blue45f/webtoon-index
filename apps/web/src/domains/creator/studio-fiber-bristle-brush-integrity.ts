import { sha256HexPortable } from "./studio-sha256";

export interface StudioFiberBristleIntegritySample {
  readonly x: number;
  readonly y: number;
  readonly timeMilliseconds: number;
  readonly pressure: number;
  readonly tiltRadians: number;
  readonly azimuthRadians: number;
  readonly pickupColor?: readonly [number, number, number] | null;
}

export interface StudioFiberBristleRequestFlow {
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly strokeId: string;
  readonly operation: "replace" | "append";
  readonly recipeFingerprint: `sha256:${string}`;
  readonly previousReplayHash: `sha256:${string}` | null;
  readonly samples: readonly StudioFiberBristleIntegritySample[];
}

function hashBytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function wrapAngle(value: number): number {
  const wrapped = value % (Math.PI * 2);
  return wrapped > Math.PI
    ? wrapped - Math.PI * 2
    : wrapped < -Math.PI
      ? wrapped + Math.PI * 2
      : wrapped;
}

function canonicalSamples(
  samples: readonly StudioFiberBristleIntegritySample[],
): readonly StudioFiberBristleIntegritySample[] {
  const result: StudioFiberBristleIntegritySample[] = [];
  for (const sample of samples) {
    const canonical = Object.freeze({
      x: sample.x,
      y: sample.y,
      timeMilliseconds: sample.timeMilliseconds,
      pressure: sample.pressure,
      tiltRadians: sample.tiltRadians,
      azimuthRadians: wrapAngle(sample.azimuthRadians),
      ...(sample.pickupColor === undefined || sample.pickupColor === null
        ? {}
        : { pickupColor: Object.freeze([...sample.pickupColor]) as readonly [
            number,
            number,
            number,
          ] }),
    });
    const previous = result.at(-1);
    if (previous && canonical.x === previous.x && canonical.y === previous.y) {
      result[result.length - 1] = canonical;
    } else {
      result.push(canonical);
    }
  }
  return Object.freeze(result);
}

function hashSamples(
  samples: readonly StudioFiberBristleIntegritySample[],
): `sha256:${string}` {
  const canonical = canonicalSamples(samples);
  const stride = 9;
  const bytes = new Uint8Array(
    canonical.length * stride * Float64Array.BYTES_PER_ELEMENT,
  );
  const view = new DataView(bytes.buffer);
  for (let sampleIndex = 0; sampleIndex < canonical.length; sampleIndex += 1) {
    const sample = canonical[sampleIndex]!;
    const pickup = sample.pickupColor ?? [-1, -1, -1];
    const values = [
      sample.x,
      sample.y,
      sample.timeMilliseconds,
      sample.pressure,
      sample.tiltRadians,
      sample.azimuthRadians,
      pickup[0],
      pickup[1],
      pickup[2],
    ];
    for (let component = 0; component < stride; component += 1) {
      view.setFloat64(
        (sampleIndex * stride + component)
          * Float64Array.BYTES_PER_ELEMENT,
        values[component] ?? 0,
        true,
      );
    }
  }
  return hashBytes(bytes);
}

export function hashStudioFiberBristleRequestFlow(
  flow: StudioFiberBristleRequestFlow,
): `sha256:${string}` {
  const canonical = canonicalSamples(flow.samples);
  return hashBytes(new TextEncoder().encode(JSON.stringify({
    kind: "studio-fiber-bristle-request-flow",
    version: 1,
    requestSequence: flow.requestSequence,
    engineEpoch: flow.engineEpoch,
    strokeId: flow.strokeId,
    operation: flow.operation,
    recipeFingerprint: flow.recipeFingerprint,
    previousReplayHash: flow.previousReplayHash,
    sampleCount: canonical.length,
    samplesHash: hashSamples(canonical),
  })));
}
