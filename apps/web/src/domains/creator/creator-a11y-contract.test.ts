// 창작 화면(게시판·공용 패널 UI) 모바일 고대비·a11y 계약 테스트.
// 소유 파일들이 (1) 미정의 디자인 토큰, (2) 8.8~10.9px 초소형 폰트,
// (3) focus-visible 을 무력화하는 bare outline-none 으로 회귀하지 않도록 정적 검사한다.
// 장식 요소는 해당 라인에 "a11y-exempt" 주석을 달아 예외 처리한다.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

// 이 계약이 지키는 파일들 (창작 게시판 + 스튜디오 공용 패널 프리미티브)
const GUARDED_FILES = [
  "CreateWorkPage.tsx",
  "CreateGalleryPage.tsx",
  "CreateSeriesPage.tsx",
  "CreateChallengesPage.tsx",
  "CreateFeaturedSections.tsx",
  "creator-community-ui.tsx",
  "studio-panel-ui.tsx",
] as const;

// globals.css @theme 에 실존하지 않는(사일런트 no-op) 토큰 유틸리티들.
const UNDEFINED_TOKEN_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "text-fg-4 (fg-3 까지만 존재)", pattern: /\bfg-4\b/ },
  { name: "bg-background (canvas/panel/card/raised 만 존재)", pattern: /\bbg-background\b/ },
  { name: "ring-offset-background", pattern: /\bring-offset-background\b/ },
];

// 폰트 하한 — 본문/라벨은 최소 0.72rem(11.52px). 0.69rem(=11.04px) 미만을 초소형으로 간주.
const MIN_FONT_PX = 11;

function readGuarded(file: (typeof GUARDED_FILES)[number]): string {
  return readFileSync(join(HERE, file), "utf-8");
}

function guardedLines(file: (typeof GUARDED_FILES)[number]): { line: string; no: number }[] {
  return readGuarded(file)
    .split("\n")
    .map((line, index) => ({ line, no: index + 1 }))
    .filter(({ line }) => !line.includes("a11y-exempt"));
}

describe("창작 화면 a11y 계약", () => {
  it("미정의 디자인 토큰을 사용하지 않는다 (사일런트 no-op 방지)", () => {
    const violations: string[] = [];
    for (const file of GUARDED_FILES) {
      for (const { line, no } of guardedLines(file)) {
        for (const { name, pattern } of UNDEFINED_TOKEN_PATTERNS) {
          if (pattern.test(line)) violations.push(`${file}:${no} → ${name}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("본문/라벨 폰트가 11px(≈0.69rem) 미만으로 내려가지 않는다", () => {
    const sizePattern = /text-\[(\d*\.?\d+)(rem|px)\]/g;
    const violations: string[] = [];
    for (const file of GUARDED_FILES) {
      for (const { line, no } of guardedLines(file)) {
        for (const match of line.matchAll(sizePattern)) {
          const value = Number(match[1]);
          const px = match[2] === "rem" ? value * 16 : value;
          if (px < MIN_FONT_PX) {
            violations.push(`${file}:${no} → ${match[0]} (${px.toFixed(1)}px)`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("focus-visible 대체 없이 outline-none 을 쓰지 않는다", () => {
    const violations: string[] = [];
    for (const file of GUARDED_FILES) {
      for (const { line, no } of guardedLines(file)) {
        if (line.includes("outline-none") && !line.includes("focus-visible:outline")) {
          violations.push(`${file}:${no}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("패널 칩/레인지/회독은 24px 시각 타깃과 판독 가능한 폰트를 유지한다", () => {
    const panelUi = readGuarded("studio-panel-ui.tsx");
    // 칩: 최소 높이 24px + 0.72rem 라벨
    expect(panelUi).toMatch(/PANEL_CHIP_CLASS =\s*\n?\s*"[^"]*min-h-6[^"]*"/);
    expect(panelUi).toMatch(/PANEL_CHIP_CLASS =\s*\n?\s*"[^"]*text-\[0\.72rem\][^"]*"/);
    expect(panelUi).toMatch(/PANEL_SWATCH_CHIP_CLASS =\s*\n?\s*"[^"]*min-h-6[^"]*"/);
    // 슬라이더 회독(readout): 0.72rem 이상
    expect(panelUi).toMatch(/PANEL_READOUT_CLASS =\s*\n?\s*"[^"]*text-\[0\.72rem\][^"]*"/);
    // 터치 기기 레인지 슬라이더: WCAG 권장 44px(h-11) 조작 타깃
    expect(panelUi).toContain("pointer-coarse:h-11");
  });

  it("폼 컨트롤이 접근 가능한 이름(aria-label 또는 label 연결)을 가진다", () => {
    // 댓글 입력(placeholder 만으로는 접근 가능한 이름이 불안정)
    expect(readGuarded("CreateWorkPage.tsx")).toContain('aria-label="댓글 입력"');
    // 시리즈 생성/수정 폼 3필드
    const communityUi = readGuarded("creator-community-ui.tsx");
    expect(communityUi).toContain('aria-label="시리즈 제목"');
    expect(communityUi).toContain('aria-label="시리즈 소개"');
    expect(communityUi).toContain('aria-label="시리즈 태그 (쉼표로 구분)"');
    // 갤러리 태그 필터 해제 버튼(X 아이콘)의 목적 명시
    expect(readGuarded("CreateGalleryPage.tsx")).toContain("태그 필터 해제");
  });
});
