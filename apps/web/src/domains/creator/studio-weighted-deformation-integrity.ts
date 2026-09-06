import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioWeightedDeformationRequest,
} from "./studio-weighted-deformation-provider";

type HashableRequest = Omit<StudioWeightedDeformationRequest, "signal">;

function hashBytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

export function hashStudioWeightedDeformationFloat32(
  values: Float32Array,
): `sha256:${string}` {
  const bytes = new Uint8Array(
    values.length * Float32Array.BYTES_PER_ELEMENT,
  );
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) {
    view.setFloat32(
      index * Float32Array.BYTES_PER_ELEMENT,
      values[index] ?? 0,
      true,
    );
  }
  return hashBytes(bytes);
}

export function hashStudioWeightedDeformationRequest(
  request: HashableRequest,
): `sha256:${string}` {
  const payload = {
    kind: "studio-weighted-deformation-request",
    version: 1,
    requestEpoch: request.requestEpoch,
    currentEpoch: request.currentEpoch,
    mesh: {
      dimension: request.mesh.dimension,
      positionsSha256:
        hashStudioWeightedDeformationFloat32(request.mesh.positions),
      textureCoordinatesSha256: request.mesh.textureCoordinates
        ? hashStudioWeightedDeformationFloat32(
            request.mesh.textureCoordinates,
          )
        : null,
    },
    sources: request.sources.map((source) => ({
      id: source.id,
      dimension: source.dimension,
      restPointsSha256:
        hashStudioWeightedDeformationFloat32(source.restPoints),
      deformedPointsSha256:
        hashStudioWeightedDeformationFloat32(source.deformedPoints),
      closed: source.closed,
      radius: source.radius,
      falloff: source.falloff,
      strength: source.strength,
    })),
    maximumWorkUnits: request.maximumWorkUnits ?? null,
  };
  return hashBytes(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
}
