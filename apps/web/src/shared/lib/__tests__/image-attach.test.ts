import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  dataUrlBytes,
  isAllowedImageDataUrl,
  validateAttachmentImages,
} from "../image-attach";

const webpUrl = (length = 64) => `data:image/webp;base64,${"A".repeat(length)}`;

describe("image-attach 첨부 검증", () => {
  it("데이터 URL의 디코딩 바이트 수를 계산한다", () => {
    // "hello" → aGVsbG8= (5바이트, 패딩 1)
    expect(dataUrlBytes("data:image/png;base64,aGVsbG8=")).toBe(5);
    // 패딩 없는 본문
    expect(dataUrlBytes(`data:image/webp;base64,${"A".repeat(8)}`)).toBe(6);
  });

  it("webp/jpeg/png 데이터 URL만 허용한다", () => {
    expect(isAllowedImageDataUrl(webpUrl())).toBe(true);
    expect(isAllowedImageDataUrl("data:image/jpeg;base64,aGVsbG8=")).toBe(true);
    expect(isAllowedImageDataUrl("data:image/png;base64,aGVsbG8=")).toBe(true);
    // svg·텍스트·외부 URL·비base64 본문은 거부 (XSS·스크립트 벡터 차단)
    expect(isAllowedImageDataUrl("data:image/svg+xml;base64,PHN2Zy8+")).toBe(false);
    expect(isAllowedImageDataUrl("data:text/html;base64,aGVsbG8=")).toBe(false);
    expect(isAllowedImageDataUrl("https://example.com/a.png")).toBe(false);
    expect(isAllowedImageDataUrl("data:image/png;base64,<script>alert(1)</script>")).toBe(false);
    expect(isAllowedImageDataUrl(123)).toBe(false);
  });

  it("첨부 개수·용량 한도를 강제한다", () => {
    expect(validateAttachmentImages(undefined).images).toEqual([]);
    expect(validateAttachmentImages(null).images).toEqual([]);
    expect(validateAttachmentImages("not-an-array").error).toBeTruthy();

    const tooMany = Array.from({ length: ATTACHMENT_MAX_COUNT + 1 }, () => webpUrl());
    expect(validateAttachmentImages(tooMany).error).toContain(`${ATTACHMENT_MAX_COUNT}장`);

    // 2MB 초과(디코딩 기준) 본문은 거부
    const oversizedLength = Math.ceil((ATTACHMENT_MAX_BYTES / 3) * 4) + 8;
    expect(validateAttachmentImages([webpUrl(oversizedLength)]).error).toContain("2MB");

    const ok = validateAttachmentImages([webpUrl(), webpUrl()]);
    expect(ok.error).toBeUndefined();
    expect(ok.images).toHaveLength(2);
  });

  it("허용되지 않은 형식이 섞이면 전체를 거부한다", () => {
    const result = validateAttachmentImages([webpUrl(), "data:image/svg+xml;base64,PHN2Zy8+"]);
    expect(result.error).toBeTruthy();
    expect(result.images).toBeUndefined();
  });
});
