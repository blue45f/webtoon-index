import { describe, expect, it } from "vitest";

import { lintStudioContinuity, normalizeStudioContinuityValue } from "./studio-continuity";

const completeCharacter = {
  name: "민아",
  appearance: "검은 단발",
  voice: "짧고 차분함",
  goal: "사라진 친구 찾기",
};

describe("studio continuity lint", () => {
  it("NFKC·공백·대소문자만 정규화해 정확히 비교한다", () => {
    expect(normalizeStudioContinuityValue("  Ｍina\n KIM  ")).toBe("mina kim");
    expect(normalizeStudioContinuityValue("교실")).not.toBe(
      normalizeStudioContinuityValue("학교 교실")
    );
  });

  it("정규화된 중복 이름과 빠진 필수 캐릭터 정보를 고정 코드로 보고한다", () => {
    const issues = lintStudioContinuity({
      characters: [
        completeCharacter,
        { name: "  민아 ", appearance: " ", voice: null, goal: undefined },
      ],
      beats: [],
    });

    expect(issues.map(({ severity, code, sceneRefs }) => ({ severity, code, sceneRefs }))).toEqual([
      { severity: "error", code: "DUPLICATE_CHARACTER_NAME", sceneRefs: [] },
      { severity: "warning", code: "MISSING_CHARACTER_APPEARANCE", sceneRefs: [] },
      { severity: "warning", code: "MISSING_CHARACTER_VOICE", sceneRefs: [] },
      { severity: "warning", code: "MISSING_CHARACTER_GOAL", sceneRefs: [] },
    ]);
  });

  it("장면의 미등록 캐릭터를 장면별·정규화 이름별 한 번만 보고한다", () => {
    const issues = lintStudioContinuity({
      characters: [completeCharacter],
      beats: [
        {
          sceneId: "s1",
          characterNames: [" 민아 ", "도윤", "ＤＯＹＵＮ", "도윤"],
        },
      ],
    });

    expect(issues).toEqual([
      {
        severity: "error",
        code: "UNKNOWN_CHARACTER",
        message: expect.stringContaining("도윤"),
        sceneRefs: ["s1"],
      },
      {
        severity: "error",
        code: "UNKNOWN_CHARACTER",
        message: expect.stringContaining("DOYUN"),
        sceneRefs: ["s1"],
      },
    ]);
  });

  it("명시된 장소·시간이 달라지고 전환 설명이 없으면 앞뒤 장면을 연결한다", () => {
    const issues = lintStudioContinuity({
      characters: [completeCharacter],
      beats: [
        { sceneId: "s1", location: "교실", time: "아침" },
        { sceneId: "s-gap" },
        { sceneId: "s2", location: "옥상", time: "밤" },
      ],
    });

    expect(issues.map(({ code, sceneRefs }) => ({ code, sceneRefs }))).toEqual([
      { code: "LOCATION_CONTINUITY_CONTRADICTION", sceneRefs: ["s1", "s2"] },
      { code: "TIME_CONTINUITY_CONTRADICTION", sceneRefs: ["s1", "s2"] },
    ]);
  });

  it("현재 장면의 필드별 전환 설명이 있으면 해당 변경만 허용한다", () => {
    const issues = lintStudioContinuity({
      characters: [completeCharacter],
      beats: [
        { sceneId: "s1", location: "교실", time: "아침" },
        {
          sceneId: "s2",
          location: "옥상",
          time: "밤",
          transitionExplanations: { location: "계단으로 이동" },
        },
      ],
    });

    expect(issues.map((issue) => issue.code)).toEqual(["TIME_CONTINUITY_CONTRADICTION"]);
  });

  it("캐릭터별 의상과 소품별 상태를 마지막 명시 값과 비교한다", () => {
    const issues = lintStudioContinuity({
      characters: [completeCharacter],
      beats: [
        {
          sceneId: "s1",
          costumes: { 민아: "교복" },
          props: { 우산: "민아가 들고 있음" },
        },
        { sceneId: "s-gap" },
        {
          sceneId: "s2",
          costumes: { " 민아 ": "잠옷" },
          props: { 우산: "옥상 바닥에 있음" },
        },
      ],
    });

    expect(issues.map(({ code, sceneRefs }) => ({ code, sceneRefs }))).toEqual([
      { code: "COSTUME_CONTINUITY_CONTRADICTION", sceneRefs: ["s1", "s2"] },
      { code: "PROP_CONTINUITY_CONTRADICTION", sceneRefs: ["s1", "s2"] },
    ]);
  });

  it("의상·소품 전환 설명은 정규화된 대상 키에만 적용한다", () => {
    const issues = lintStudioContinuity({
      characters: [completeCharacter],
      beats: [
        {
          sceneId: "s1",
          costumes: { 민아: "교복", 도윤: "코트" },
          props: { 우산: "접힘", 열쇠: "민아 소유" },
        },
        {
          sceneId: "s2",
          costumes: { 도윤: "셔츠", 민아: "잠옷" },
          props: { 열쇠: "도윤 소유", 우산: "펼침" },
          transitionExplanations: {
            costumes: { " 민아 ": "귀가 후 갈아입음" },
            props: { " 우산 ": "비가 내리기 시작함" },
          },
        },
      ],
    });

    expect(issues.map((issue) => issue.code)).toEqual([
      "COSTUME_CONTINUITY_CONTRADICTION",
      "PROP_CONTINUITY_CONTRADICTION",
    ]);
    expect(issues[0].message).toContain("도윤");
    expect(issues[1].message).toContain("열쇠");
  });

  it("정규화 후 같은 값과 설명된 모든 변경은 문제를 만들지 않는다", () => {
    expect(
      lintStudioContinuity({
        characters: [completeCharacter],
        beats: [
          {
            sceneId: "s1",
            characterNames: ["민아"],
            location: "교실",
            time: "오후",
            costumes: { 민아: "파란 코트" },
            props: { 가방: "왼손" },
          },
          {
            sceneId: "s2",
            characterNames: [" 민아 "],
            location: " 교실 ",
            time: "오후",
            costumes: { 민아: "파란  코트" },
            props: { 가방: "오른손" },
            transitionExplanations: { props: { 가방: "손을 바꿈" } },
          },
        ],
      })
    ).toEqual([]);
  });
});
