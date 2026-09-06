// 문의(Inquiry) 게시판 API 클라이언트 — desk-platform 공개 REST API 직접 호출.
//
// desk-platform이 모든 형제 앱을 위한 공개 문의 게시판 백엔드(인증 없음, CORS 오픈)를
// 제공한다. 별도 SDK/npm 의존성 없이 fetch만으로 내부 /support 페이지의 등록(POST)·
// 목록(GET)을 처리한다. 베이스 URL은 VITE_DESK_PLATFORM_URL 로 오버라이드한다.
// 계약: desk-platform/docs/INQUIRY_INTEGRATION.md
//
// (기존 lib/inquiry.ts 의 TermsDesk 비공개 문의함과 별개 — 이 모듈은 공개 게시판 통합용.)

const BASE = import.meta.env.VITE_DESK_PLATFORM_URL ?? "https://desk-platform.vercel.app";

/** 이 앱의 슬러그(레포 이름). desk-platform이 앱별 게시판을 구분하는 키. */
export const APP_ID = "toonspectrum";

/** 문의 카테고리 value. @desk/shared의 INQUIRY_CATEGORIES와 동일(가이드 §3). */
export type InquiryCategory = "partnership" | "bug" | "feedback" | "usage";

/** 문의 처리 상태. @desk/shared의 INQUIRY_STATUSES와 동일(가이드 §4). */
export type InquiryStatus = "new" | "in_progress" | "resolved" | "closed";

/** value → 한국어 라벨(가이드 §3). */
export const INQUIRY_CATEGORY_LABELS: Record<InquiryCategory, string> = {
  partnership: "제휴 문의",
  bug: "버그 신고",
  feedback: "사이트 의견",
  usage: "이용 문의",
};

/** 셀렉터·필터에서 순서를 보장하기 위한 카테고리 배열. */
export const INQUIRY_CATEGORIES: InquiryCategory[] = ["partnership", "bug", "feedback", "usage"];

/** 카테고리별 안내 문구(셀렉터 보조 설명). */
export const INQUIRY_CATEGORY_HINTS: Record<InquiryCategory, string> = {
  partnership: "협업·제휴 제안",
  bug: "사이트 오류 신고",
  feedback: "개선 의견·제안",
  usage: "사용법·일반 문의",
};

/** status → 한국어 라벨. */
export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  new: "접수",
  in_progress: "처리 중",
  resolved: "해결됨",
  closed: "종료",
};

/** 입력 제한(가이드 §4). */
export const INQUIRY_TITLE_MAX = 120;
export const INQUIRY_BODY_MAX = 4000;
export const INQUIRY_NAME_MAX = 80;

/** 공개 게시판에 노출되는 문의 항목(가이드 §4). contactEmail/originUrl은 마스킹됨. */
export interface Inquiry {
  id: string;
  appId: string;
  category: InquiryCategory;
  status: InquiryStatus;
  title: string;
  body: string;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** GET 응답 봉투(가이드 §4 InquiryListDto). */
export interface InquiryList {
  appId: string;
  items: Inquiry[];
  limit: number;
  offset: number;
}

/** 문의 등록 입력. originUrl/website(허니팟)는 submitInquiry가 자동 주입한다. */
export interface SubmitInquiryInput {
  category: InquiryCategory;
  title: string;
  body: string;
  contactEmail?: string;
  authorName?: string;
}

/** 에러 응답 본문에서 사람이 읽을 메시지를 뽑아낸다(검증 실패는 message: string[]). */
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(data.message)) {
      const joined = data.message.filter((item) => typeof item === "string" && item.trim()).join(", ");
      if (joined) return joined;
    }
    if (typeof data.message === "string" && data.message.trim()) return data.message;
  } catch {
    // JSON 본문이 없거나 깨졌으면 폴백 메시지를 쓴다.
  }
  return fallback;
}

/**
 * 문의를 등록한다(`POST /api/v1/apps/:appId/inquiries`, 10/min/IP).
 * - 허니팟 `website`는 항상 빈 값으로 보내 봇을 무음 처리한다.
 * - `originUrl`은 현재 위치를 자동 첨부한다(공개 목록에서는 마스킹됨).
 * - 검증 실패(400)는 message 배열을 합쳐 Error로 던진다.
 */
export async function submitInquiry(input: SubmitInquiryInput): Promise<Inquiry> {
  const res = await fetch(`${BASE}/api/v1/apps/${APP_ID}/inquiries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...input,
      originUrl: typeof location !== "undefined" ? location.href : undefined,
      website: "", // 허니팟 — 항상 빈 값 유지.
    }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "문의 등록에 실패했어요. 잠시 후 다시 시도해 주세요."));
  }
  return (await res.json()) as Inquiry;
}

/**
 * 공개 게시판 목록을 최신순으로 불러온다(`GET …/inquiries?limit&offset`, 60/min/IP).
 * limit은 1~50(기본 20)으로 클램프한다.
 */
export async function listInquiries(limit = 20, offset = 0): Promise<InquiryList> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const safeOffset = Math.max(Math.trunc(offset), 0);
  const res = await fetch(`${BASE}/api/v1/apps/${APP_ID}/inquiries?limit=${safeLimit}&offset=${safeOffset}`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "문의 목록을 불러오지 못했어요."));
  }
  return (await res.json()) as InquiryList;
}
