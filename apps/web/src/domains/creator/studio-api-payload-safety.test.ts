import { describe, expect, it } from "vitest";

import {
  STUDIO_API_MAX_JSON_BYTES,
  StudioApiPayloadSafetyError,
  assertStudioApiJsonPayloadSize,
  studioApiJsonByteLength,
} from "./studio-api-payload-safety";

describe("studio API payload safety", () => {
  it("실제 JSON UTF-8 byte를 계산하고 기본 상한 이하를 허용한다", () => {
    const payload = { text: "한글", pages: ["data:image/png;base64,AA=="] };
    expect(studioApiJsonByteLength(payload)).toBe(
      new TextEncoder().encode(JSON.stringify(payload)).byteLength
    );
    expect(assertStudioApiJsonPayloadSize(payload)).toBeLessThan(
      STUDIO_API_MAX_JSON_BYTES
    );
  });

  it("상한과 같은 JSON은 허용하고 한 byte라도 초과하면 저장 전에 안내한다", () => {
    const payload = { page: "가" };
    const bytes = studioApiJsonByteLength(payload);
    expect(assertStudioApiJsonPayloadSize(payload, bytes)).toBe(bytes);
    expect(() => assertStudioApiJsonPayloadSize(payload, bytes - 1)).toThrow(
      /15MB.*이미지를.*에피소드/
    );
  });

  it("순환 참조와 JSON으로 표현할 수 없는 최상위 값을 거부한다", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => studioApiJsonByteLength(circular)).toThrow(
      StudioApiPayloadSafetyError
    );
    expect(() => studioApiJsonByteLength(circular)).toThrow(/직렬화/);
    expect(() => studioApiJsonByteLength(undefined)).toThrow(/올바르지 않습니다/);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "잘못된 용량 제한 %s를 거부한다",
    (maximumBytes) => {
      expect(() => assertStudioApiJsonPayloadSize({ ok: true }, maximumBytes)).toThrow(
        /용량 제한이 올바르지 않습니다/
      );
    }
  );
});
