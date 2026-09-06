// TermsDesk(중앙 약관 게시 서비스)의 공개 API에서 게시 정본을 읽어 오는 순수 로직.
// 브라우저는 같은 출처 API 프록시(/api/legal/policies/:slug)를 호출하고,
// 서버가 TermsDesk 공개 JSON을 대신 가져온다(CORS/프리플라이트 배포 차이 회피).
// 본문은 마크다운/플레인텍스트가 섞일 수 있어 의존성 없이 최소 블록 파서로 렌더한다.
import { api, apiPath, httpStatus } from "@/src/infrastructure/api";

export const TERMSDESK_BASE = "https://termsdesk.vercel.app";
export const TERMSDESK_ORG_SLUG = "toonspectrum";

export type PolicySlug = "terms-of-service" | "privacy-policy";

export interface PolicyDocument {
  policySlug: string;
  name: string;
  versionLabel: string;
  contentHash: string;
  body: string;
  effectiveAt: string | null;
  source?: "termsdesk" | "static";
}

/** JSON 엔드포인트(GET, 무인증). */
export function policyApiUrl(slug: string): string {
  return apiPath(`/legal/policies/${slug}`);
}

/** 사람이 보는 TermsDesk 게시 페이지 — 에러 폴백·원문 확인 링크로 쓴다. */
export function policyPublicUrl(slug: string): string {
  return `${TERMSDESK_BASE}/p/${TERMSDESK_ORG_SLUG}/${slug}`;
}

/** 무결성 표기용 콘텐츠 해시 축약(앞 12자). */
export function shortContentHash(hash: string): string {
  return hash.slice(0, 12);
}

/** 시행일을 한국 표기(예: 2026년 6월 8일)로. 약관 시행일은 한국 기준이라 KST로 고정한다. */
export function formatPolicyDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeZone: "Asia/Seoul" }).format(date);
}

const STATIC_POLICY_DOCUMENTS: Record<PolicySlug, PolicyDocument> = {
  "terms-of-service": {
    policySlug: "terms-of-service",
    name: "이용약관",
    versionLabel: "내장본 v2026.06.04",
    contentHash: "static-terms-20260604-toonspectrum",
    effectiveAt: "2026-06-04T00:00:00.000+09:00",
    source: "static",
    body: [
      "제1조 (목적)",
      "본 약관은 툰스펙트럼이 제공하는 웹툰·웹소설 통합 색인, 검색, 랭킹, 리뷰, 커뮤니티 및 창작 도구 이용과 관련하여 서비스와 이용자 간의 권리·의무 및 책임사항을 정합니다.",
      "",
      "제2조 (서비스의 성격)",
      "서비스는 공개 카탈로그 정보를 정리해 작품 발견을 돕는 색인·추천 도구입니다. 서비스는 작품 본편 이미지나 텍스트를 호스팅하거나 재배포하지 않으며, 실제 열람은 각 원 플랫폼 링크를 통해 이루어집니다.",
      "",
      "제3조 (계정과 이용자 책임)",
      "이용자는 정확한 계정 정보를 유지해야 하며 타인의 권리 침해, 서비스 운영 방해, 불법 정보 게시, 자동화 남용을 해서는 안 됩니다.",
      "",
      "제4조 (커뮤니티와 창작물)",
      "이용자가 게시한 리뷰, 댓글, 창작물의 책임은 이용자에게 있습니다. 비방, 차별, 저작권 침해, 불법 정보, 스팸은 숨김·삭제·이용 제한 대상이 될 수 있습니다.",
      "",
      "제5조 (콘텐츠 권리)",
      "작품 메타데이터와 표지 등 원천 콘텐츠 권리는 각 플랫폼과 권리자에게 있습니다. 툰스펙트럼이 제작한 UI, 데이터 가공 결과, 편집 콘텐츠의 권리는 서비스 또는 정당한 권리자에게 귀속됩니다.",
      "",
      "제6조 (서비스 변경과 중단)",
      "서비스는 운영상 필요에 따라 기능을 변경하거나 일시 중단할 수 있습니다. 중요한 변경은 서비스 내 공지 또는 정책 페이지를 통해 안내합니다.",
      "",
      "제7조 (약관 변경)",
      "약관 변경 시 시행일과 변경 내용을 서비스 내에서 고지합니다. 이용자는 변경된 약관에 동의하지 않을 경우 서비스 이용을 중단할 수 있습니다.",
    ].join("\n"),
  },
  "privacy-policy": {
    policySlug: "privacy-policy",
    name: "개인정보처리방침",
    versionLabel: "내장본 v2026.08.14",
    contentHash: "static-privacy-20260814-toonspectrum-mediapipe",
    effectiveAt: "2026-08-14T00:00:00.000+09:00",
    source: "static",
    body: [
      "## 1. 수집하는 항목",
      "- 계정 정보: 이메일, 닉네임, 프로필 이미지 또는 소셜 로그인 식별자",
      "- 이용 활동: 리뷰, 별점, 컬렉션, 커뮤니티 게시물, 창작 게시물 등 이용자가 작성한 콘텐츠",
      "- 자동 수집 정보: 서비스 운영과 보안에 필요한 최소한의 접속 기록",
      "",
      "## 2. 이용 목적",
      "수집한 정보는 회원 식별, 로그인 유지, 리뷰·커뮤니티·창작 기능 제공, 맞춤 추천, 취향 분석, 운영·보안, 문의 응대에 사용합니다.",
      "",
      "## 3. 브라우저 저장 정보",
      "읽음 상태, 관심 작품, 일부 필터와 표시 설정은 이용자 브라우저의 localStorage에 저장될 수 있으며 서버로 전송되지 않을 수 있습니다.",
      "",
      "## 4. 기기 내 AI 기능과 MediaPipe",
      "3D 캐릭터의 참고 이미지 프리셋 추천은 이용자가 화면에서 별도로 동의한 경우에만 Google MediaPipe API를 사용합니다. 선택한 이미지 픽셀은 기기의 메모리 Worker에서 처리되며 툰스펙트럼 서버나 브라우저 영구 저장소에 보관하지 않습니다. MediaPipe API는 앱 식별자, 처리 매체의 일반적 특성, 추론·세션 수, 호스트 환경 등 이용·성능 메타데이터를 처리할 수 있습니다. 이용자는 동의하지 않고 수동 프리셋을 사용할 수 있으며, 동의 상태는 저장하지 않습니다.",
      "",
      "## 5. 보유 및 파기",
      "개인정보는 수집 목적 달성 또는 회원 탈퇴 시 지체 없이 파기합니다. 관련 법령에서 보관 의무를 정한 경우 해당 기간 동안 보관합니다.",
      "",
      "## 6. 제3자 제공 및 처리위탁",
      "법령에 근거하거나 이용자 동의가 있는 경우를 제외하고 개인정보를 제3자에게 제공하지 않습니다. 서비스 운영을 위해 클라우드 호스팅, 데이터베이스, 인증 제공자를 이용할 수 있습니다.",
      "",
      "## 7. 이용자의 권리",
      "이용자는 개인정보 열람, 정정, 삭제, 처리정지를 요청할 수 있으며 설정 페이지에서 프로필과 공개 범위를 직접 관리할 수 있습니다.",
      "",
      "## 8. 문의",
      "개인정보 관련 문의는 서비스의 문의 게시판 또는 운영팀이 제공하는 지원 채널을 통해 접수할 수 있습니다.",
    ].join("\n"),
  },
};

export function getStaticPolicyDocument(slug: PolicySlug): PolicyDocument {
  return STATIC_POLICY_DOCUMENTS[slug];
}

export function shouldAutoFetchPolicyDocument(): boolean {
  if (typeof window === "undefined") return true;
  const explicit = import.meta.env.VITE_POLICY_API_AUTO;
  if (explicit === "false") return false;
  if (explicit === "true") return true;
  const { hostname } = globalThis.location;
  const isLocalPreview = hostname === "127.0.0.1" || hostname === "localhost";
  return !isLocalPreview;
}

/** 게시 정본을 가져와 화면에 필요한 필드만 검증·정규화한다. 형식이 어긋나면 throw. */
export async function fetchPolicyDocument(slug: string, signal?: AbortSignal): Promise<PolicyDocument> {
  let payload: Record<string, unknown> | null;
  try {
    payload = await api.get<Record<string, unknown> | null>(`/legal/policies/${slug}`, {
      cache: "no-store",
      signal,
    });
  } catch (err) {
    const status = httpStatus(err);
    if (status !== null) throw new Error(`policy_fetch_failed:${status}`, { cause: err });
    throw err;
  }
  if (
    !payload ||
    typeof payload.body !== "string" ||
    typeof payload.contentHash !== "string" ||
    typeof payload.versionLabel !== "string"
  ) {
    throw new Error("policy_payload_malformed");
  }
  return {
    policySlug: typeof payload.policySlug === "string" ? payload.policySlug : slug,
    name: typeof payload.name === "string" ? payload.name : "",
    versionLabel: payload.versionLabel,
    contentHash: payload.contentHash,
    body: payload.body,
    effectiveAt: typeof payload.effectiveAt === "string" ? payload.effectiveAt : null,
    source: "termsdesk",
  };
}

export type PolicyBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] };

// "제1조 (목적)" / "부칙" 처럼 조항 번호(+선택적 괄호 제목)만 있는 줄을 헤딩으로 본다.
// "제3조에 따라 …" 같이 문장이 이어지는 줄은 매치되지 않는다.
const ARTICLE_HEADING = /^(제\d+조|부칙)(\s*\([^)]*\))?$/;
const MD_HEADING = /^#{1,6}\s+(.*)$/;
const UL_ITEM = /^[-*]\s+(.*)$/;
const OL_ITEM = /^\d+[.)]\s+(.*)$/;

/** 본문을 헤딩·문단·리스트 블록으로 파싱한다(마크다운 #, -, 1. + 한국 약관 조항 컨벤션). */
export function parsePolicyBlocks(body: string): PolicyBlock[] {
  const blocks: PolicyBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
      list = null;
    }
  };

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const md = line.match(MD_HEADING);
    if (md || ARTICLE_HEADING.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", text: (md ? md[1] : line).trim() });
      continue;
    }
    const ol = line.match(OL_ITEM);
    const ul = ol ? null : line.match(UL_ITEM);
    if (ol || ul) {
      flushParagraph();
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((ol?.[1] ?? ul?.[1] ?? "").trim());
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

export interface PolicySection {
  heading: string | null;
  blocks: PolicyBlock[];
}

/** 헤딩 단위로 묶어 CopyrightPage와 같은 섹션 리듬(space-y)으로 렌더할 수 있게 한다. */
export function groupPolicySections(blocks: PolicyBlock[]): PolicySection[] {
  const sections: PolicySection[] = [];
  for (const block of blocks) {
    if (block.kind === "heading") {
      sections.push({ heading: block.text, blocks: [] });
      continue;
    }
    let current = sections[sections.length - 1];
    if (!current) {
      current = { heading: null, blocks: [] };
      sections.push(current);
    }
    current.blocks.push(block);
  }
  return sections;
}

export interface InlineSegment {
  text: string;
  bold: boolean;
}

/** 인라인 마크다운 중 **굵게**만 지원한다(HTML 미사용 — XSS 표면 없음). */
export function splitBoldSegments(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index), bold: false });
    segments.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), bold: false });
  return segments.length > 0 ? segments : [{ text, bold: false }];
}
