import { describe, it, expect } from "vitest";

import { statsAreEstimated } from "../estimate";

import { makeTitle } from "./fixtures";

describe("statsAreEstimated", () => {
  it("웹소설은 추정", () => {
    expect(statsAreEstimated(makeTitle({ type: "webnovel" }))).toBe(true);
  });

  it("네이버 웹툰(naver-webtoon 가용성)은 실수집", () => {
    const t = makeTitle({ type: "webtoon", availability: [{ platformId: "naver-webtoon", pricing: "free" }] });
    expect(statsAreEstimated(t)).toBe(false);
  });

  it("네이버웹툰이 아닌 웹툰(카카오웹툰)은 추정", () => {
    const t = makeTitle({ type: "webtoon", availability: [{ platformId: "kakao-webtoon", pricing: "wait-free" }] });
    expect(statsAreEstimated(t)).toBe(true);
  });

  it("네이버웹툰 가용성이 하나라도 있으면 실수집", () => {
    const t = makeTitle({
      type: "webtoon",
      availability: [
        { platformId: "kakao-webtoon", pricing: "free" },
        { platformId: "naver-webtoon", pricing: "free" },
      ],
    });
    expect(statsAreEstimated(t)).toBe(false);
  });

  it("statsEstimated 플래그가 켜진 작품은 네이버 웹툰이어도 추정으로 본다(0 노출 방지 보정)", () => {
    // 랭킹 산식은 이 판별로 신뢰계수 감점·모멘텀 감쇠·베이즈 사전값 가중(25%)을 일관 적용한다.
    const t = makeTitle({
      type: "webtoon",
      statsEstimated: true,
      availability: [{ platformId: "naver-webtoon", pricing: "free" }],
    });
    expect(statsAreEstimated(t)).toBe(true);
  });
});
