import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchPolicyDocument,
  formatPolicyDate,
  getStaticPolicyDocument,
  groupPolicySections,
  parsePolicyBlocks,
  policyApiUrl,
  policyPublicUrl,
  shortContentHash,
  splitBoldSegments,
  type PolicyDocument,
} from "./policy-content";
import { PolicyArticle, PolicyErrorFallback } from "./PolicyPage";

const HASH = "746985ca84104e2b6f05bf0da2569c39b6909f7283badb7f3edbec47be5bb875";

const PAYLOAD = {
  orgName: "ToonSpectrum",
  policySlug: "terms-of-service",
  name: "이용약관",
  type: "terms",
  locale: "ko",
  versionLabel: "v1",
  contentHash: HASH,
  effectiveAt: "2026-06-08T00:00:00.000Z",
  publishedAt: "2026-06-08T00:00:00.000Z",
  body: "제1조 (목적)\n이 이용약관은 서비스 이용 조건을 정합니다.",
};

describe("policy URL builders", () => {
  it("points policy fetches at the same-origin API proxy and source links at TermsDesk", () => {
    expect(policyApiUrl("terms-of-service")).toBe("/api/legal/policies/terms-of-service");
    expect(policyPublicUrl("privacy-policy")).toBe(
      "https://termsdesk.vercel.app/p/toonspectrum/privacy-policy"
    );
  });
});

describe("fetchPolicyDocument", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches the JSON endpoint fresh and normalizes the payload", async () => {
    const mockFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(PAYLOAD), { status: 200 })
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const doc = await fetchPolicyDocument("terms-of-service");

    // ky 는 globalThis.fetch 를 Request 객체로 호출한다 — URL/캐시 정책이 보존됐는지 Request 로 검증.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const request = mockFetch.mock.calls[0]![0] as unknown as Request;
    expect(request).toBeInstanceOf(Request);
    expect(new URL(request.url).pathname).toBe(policyApiUrl("terms-of-service"));
    expect(request.cache).toBe("no-store");
    expect(doc).toEqual({
      policySlug: "terms-of-service",
      name: "이용약관",
      versionLabel: "v1",
      contentHash: HASH,
      body: PAYLOAD.body,
      effectiveAt: "2026-06-08T00:00:00.000Z",
      source: "termsdesk",
    });
  });

  it("rejects on HTTP errors", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("not found", { status: 404 })
    ) as unknown as typeof fetch;

    await expect(fetchPolicyDocument("terms-of-service")).rejects.toThrow("policy_fetch_failed:404");
  });

  it("rejects when required fields are missing from the payload", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ versionLabel: "v1" }), { status: 200 })
    ) as unknown as typeof fetch;

    await expect(fetchPolicyDocument("terms-of-service")).rejects.toThrow("policy_payload_malformed");
  });
});

describe("parsePolicyBlocks", () => {
  it("parses Korean article headings, paragraphs and lists (TermsDesk plain-text bodies)", () => {
    const body = [
      "제1조 (목적)",
      "이 약관은 서비스 이용 조건을 정합니다.",
      "",
      "제2조 (처리 항목)",
      "처리될 수 있는 정보는 다음과 같습니다.",
      "- 계정 정보: 이메일",
      "- 이용 정보: 접속 기록",
    ].join("\n");

    expect(parsePolicyBlocks(body)).toEqual([
      { kind: "heading", text: "제1조 (목적)" },
      { kind: "paragraph", text: "이 약관은 서비스 이용 조건을 정합니다." },
      { kind: "heading", text: "제2조 (처리 항목)" },
      { kind: "paragraph", text: "처리될 수 있는 정보는 다음과 같습니다." },
      { kind: "list", ordered: false, items: ["계정 정보: 이메일", "이용 정보: 접속 기록"] },
    ]);
  });

  it("parses markdown headings and ordered lists, and joins wrapped paragraph lines", () => {
    const body = "## 부가 안내\n첫 줄과\n둘째 줄은 한 문단입니다.\n\n1. 첫째\n2. 둘째";

    expect(parsePolicyBlocks(body)).toEqual([
      { kind: "heading", text: "부가 안내" },
      { kind: "paragraph", text: "첫 줄과 둘째 줄은 한 문단입니다." },
      { kind: "list", ordered: true, items: ["첫째", "둘째"] },
    ]);
  });

  it("does not treat a sentence that merely starts with 제N조 as a heading", () => {
    expect(parsePolicyBlocks("제3조에 따라 운영합니다.")).toEqual([
      { kind: "paragraph", text: "제3조에 따라 운영합니다." },
    ]);
  });
});

describe("groupPolicySections", () => {
  it("groups blocks under their heading and keeps a heading-less preface", () => {
    const sections = groupPolicySections(
      parsePolicyBlocks("머리말 문단\n\n제1조 (목적)\n본문")
    );
    expect(sections).toEqual([
      { heading: null, blocks: [{ kind: "paragraph", text: "머리말 문단" }] },
      { heading: "제1조 (목적)", blocks: [{ kind: "paragraph", text: "본문" }] },
    ]);
  });
});

describe("inline + trust-surface formatting", () => {
  it("splits **bold** runs without touching surrounding text", () => {
    expect(splitBoldSegments("이 중 **중요** 항목")).toEqual([
      { text: "이 중 ", bold: false },
      { text: "중요", bold: true },
      { text: " 항목", bold: false },
    ]);
    expect(splitBoldSegments("플레인")).toEqual([{ text: "플레인", bold: false }]);
  });

  it("shortens the content hash to 12 chars and formats dates in KST", () => {
    expect(shortContentHash(HASH)).toBe("746985ca8410");
    expect(formatPolicyDate("2026-06-08T00:00:00.000Z")).toBe("2026년 6월 8일");
    expect(formatPolicyDate("nonsense")).toBeNull();
    expect(formatPolicyDate(null)).toBeNull();
  });
});

describe("PolicyArticle", () => {
  const doc: PolicyDocument = {
    policySlug: "terms-of-service",
    name: "이용약관",
    versionLabel: "v1",
    contentHash: HASH,
    body: "제1조 (목적)\n이 약관은 **서비스** 이용 조건을 정합니다.\n- 항목 하나",
    effectiveAt: "2026-06-08T00:00:00.000Z",
  };

  it("renders headings, lists and the version/hash/effective-date trust footer", () => {
    const html = renderToStaticMarkup(<PolicyArticle doc={doc} />);

    expect(html).toContain("제1조 (목적)");
    expect(html).toMatch(/<h2[^>]*>제1조 \(목적\)<\/h2>/);
    expect(html).toContain("<strong");
    expect(html).toContain("<li>항목 하나</li>");
    expect(html).toContain("v1");
    expect(html).toContain("TermsDesk 게시 정본");
    expect(html).toContain("746985ca8410");
    expect(html).not.toContain(HASH); // 풀 해시가 아니라 12자 축약만 노출
    expect(html).toContain("2026년 6월 8일");
    expect(html).toContain(policyPublicUrl("terms-of-service"));
  });

  it("renders the bundled static policy copy as a distinct fallback source", () => {
    const doc = getStaticPolicyDocument("privacy-policy");
    const html = renderToStaticMarkup(<PolicyArticle doc={doc} />);

    expect(doc.source).toBe("static");
    expect(html).toContain("1. 수집하는 항목");
    expect(html).toContain("기기 내 AI 기능과 MediaPipe");
    expect(html).toContain("이용·성능 메타데이터");
    expect(html).toContain("내장 정책 사본");
    expect(html).toContain("TermsDesk에서 원문·버전 이력 보기");
    expect(html).toContain(policyPublicUrl("privacy-policy"));
  });
});

describe("PolicyErrorFallback", () => {
  it("offers a retryable alert plus an external TermsDesk fallback link", () => {
    const html = renderToStaticMarkup(
      <PolicyErrorFallback slug="privacy-policy" label="개인정보처리방침" onRetry={() => {}} />
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("개인정보처리방침을 불러오지 못했습니다.");
    expect(html).toContain("다시 시도");
    expect(html).toContain(`href="${policyPublicUrl("privacy-policy")}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });
});
