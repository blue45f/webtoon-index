export const STUDIO_API_MAX_JSON_BYTES = 15 * 1024 * 1024;

export class StudioApiPayloadSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioApiPayloadSafetyError";
  }
}

export function studioApiJsonByteLength(value: unknown): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new StudioApiPayloadSafetyError(
      "저장 데이터를 JSON으로 직렬화하지 못했습니다."
    );
  }
  if (serialized === undefined) {
    throw new StudioApiPayloadSafetyError("저장할 JSON 데이터가 올바르지 않습니다.");
  }
  return new TextEncoder().encode(serialized).byteLength;
}

export function assertStudioApiJsonPayloadSize(
  value: unknown,
  maximumBytes = STUDIO_API_MAX_JSON_BYTES
): number {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new StudioApiPayloadSafetyError("저장 데이터 용량 제한이 올바르지 않습니다.");
  }
  const bytes = studioApiJsonByteLength(value);
  if (bytes > maximumBytes) {
    throw new StudioApiPayloadSafetyError(
      "저장 데이터가 안전 한도 15MB를 초과합니다. 이미지를 더 작게 줄이거나 원고를 여러 에피소드로 나눠 주세요."
    );
  }
  return bytes;
}
