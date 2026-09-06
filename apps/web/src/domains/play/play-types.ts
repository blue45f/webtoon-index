// 놀이터(/play) 아케이드 공용 타입.
// 게임들은 실제 웹툰 카탈로그(랭킹 스냅샷)를 카드/문제/말로 재사용한다.

import type { ComponentType } from "react";

/** 게임 친화적으로 정규화한 웹툰 — 랭킹/카탈로그 TitleCard에서 추출. */
export interface PlayTitle {
  id: string;
  title: string;
  author: string;
  /** OKLCH 그라디언트 2색(커버 폴백/배경). */
  cover: [string, string];
  /** 프록시된 실제 커버 이미지 URL(있으면). */
  coverImage?: string;
  genres: string[];
  /** "전체" | "12" | "15" | "19" 등. */
  ageRating: string;
  type: "webtoon" | "webnovel" | string;
  status: string;
  /** 누적 조회수(추정 포함). */
  views: number;
  likes: number;
  bookmarks: number;
}

/** 아케이드 게임 메타(허브 카드 + 라우팅). */
export interface PlayGameMeta {
  id: string;
  /** 한글 표시명. */
  label: string;
  /** 한 줄 소개. */
  tagline: string;
  /** 허브 카드 아이콘(lucide 등). */
  Icon: ComponentType<{ className?: string }>;
  /** OKLCH hue(0-360) — 게임별 강조색. */
  hue: number;
  /** 분류 칩. */
  category: "배틀" | "퍼즐" | "퀴즈" | "트래킹" | "보드" | "추천";
  /** 웹캠 필요 여부(권한 안내/접근성 대체 제공). */
  usesCamera?: boolean;
  /** 게임 본체 컴포넌트(허브가 인라인 렌더). */
  Component: ComponentType<PlayGameProps>;
}

/** 모든 게임 컴포넌트가 받는 공통 props. */
export interface PlayGameProps {
  /** 게임 종료/허브 복귀. */
  onExit: () => void;
}

/** 랭킹/카탈로그 원본(부분) → PlayTitle 정규화. */
export function normalizePlayTitle(raw: unknown): PlayTitle | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const id = typeof t.id === "string" ? t.id : null;
  const title = typeof t.title === "string" ? t.title : null;
  if (!id || !title) return null;
  const cover = Array.isArray(t.cover) && t.cover.length >= 2
    ? ([String(t.cover[0]), String(t.cover[1])] as [string, string])
    : (["oklch(0.45 0.12 280)", "oklch(0.3 0.1 320)"] as [string, string]);
  const stats = (t.stats && typeof t.stats === "object" ? t.stats : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    id,
    title,
    author: typeof t.author === "string" ? t.author : "작자미상",
    cover,
    // 표지 썸네일(프록시 경유 — 표지 정책 킬스위치·성인필터 적용). off면 차단되어 그라디언트 폴백.
    coverImage: typeof t.coverImage === "string" ? t.coverImage : undefined,
    genres: Array.isArray(t.genres) ? t.genres.map(String).slice(0, 4) : [],
    ageRating: typeof t.ageRating === "string" ? t.ageRating : "전체",
    type: typeof t.type === "string" ? t.type : "webtoon",
    status: typeof t.status === "string" ? t.status : "ongoing",
    views: num(stats.views),
    likes: num(stats.likes),
    bookmarks: num(stats.bookmarks),
  };
}

// 저작권: 표지는 사이트 전반(랭킹·검색·상세)과 동일하게 표지 정책(packages/core/src/server/cover-policy)
// 하에 노출한다 — 프록시 경유 + 성인필터 + 킬스위치(COVER_IMAGE_POLICY=off 면 프록시가 막혀
// 게임 표지까지 즉시 그라디언트 폴백). 게임 카드의 CardArt 는 coverImage 가 없으면 OKLCH
// 그라디언트로 폴백하므로, off 정책/이미지 실패 시 자동으로 자체 커버만 남는다.
