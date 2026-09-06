import { ExternalLink, FileCheck2 } from "lucide-react";
import { Fragment, useEffect, useState } from "react";

import {
  fetchPolicyDocument,
  formatPolicyDate,
  getStaticPolicyDocument,
  groupPolicySections,
  parsePolicyBlocks,
  policyPublicUrl,
  shortContentHash,
  shouldAutoFetchPolicyDocument,
  splitBoldSegments,
  type PolicyBlock,
  type PolicyDocument,
  type PolicySlug,
} from "./policy-content";

import { Container } from "@/shared/components/section";
import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";
import { ErrorState } from "@/src/components/error-state";


// 이용약관(/terms)·개인정보처리방침(/privacy).
// 외부 리다이렉트 대신 TermsDesk 공개 API에서 게시 정본을 받아 내부에서 렌더한다.
// 로컬 preview 처럼 API 프록시가 없을 때는 내장 정책 사본을 즉시 보여준다.

function InlineText({ text }: { text: string }) {
  const segments = splitBoldSegments(text);
  return (
    <>
      {segments.map((segment, i) =>
        segment.bold ? (
          <strong key={i} className="font-semibold text-fg">
            {segment.text}
          </strong>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        )
      )}
    </>
  );
}

function PolicyBlockView({ block }: { block: PolicyBlock }) {
  if (block.kind === "heading") {
    return <h2 className="mb-2 text-base font-bold text-fg">{block.text}</h2>;
  }
  if (block.kind === "list") {
    const ListTag = block.ordered ? "ol" : "ul";
    return (
      <ListTag className={cn("space-y-1.5 pl-5", block.ordered ? "list-decimal" : "list-disc")}>
        {block.items.map((item, i) => (
          <li key={i}>
            <InlineText text={item} />
          </li>
        ))}
      </ListTag>
    );
  }
  return (
    <p>
      <InlineText text={block.text} />
    </p>
  );
}

// 게시 정본 본문 + 신뢰 표면(버전·해시·시행일) 푸터. 테스트에서 직접 렌더한다.
export function PolicyArticle({ doc }: { doc: PolicyDocument }) {
  const sections = groupPolicySections(parsePolicyBlocks(doc.body));
  const effective = formatPolicyDate(doc.effectiveAt);
  const isStatic = doc.source === "static";
  return (
    <>
      <div className="mt-8 space-y-7 text-sm leading-relaxed text-fg-2">
        {sections.map((section, i) => (
          <section key={`${section.heading ?? "intro"}-${i}`}>
            {section.heading && <h2 className="mb-2 text-base font-bold text-fg">{section.heading}</h2>}
            <div className="space-y-3">
              {section.blocks.map((block, j) => (
                <PolicyBlockView key={j} block={block} />
              ))}
            </div>
          </section>
        ))}
      </div>
      <footer className="mt-10 rounded-2xl border border-line/60 bg-card/20 p-4 text-xs leading-relaxed text-fg-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <FileCheck2 size={14} className="shrink-0 text-accent" aria-hidden />
          <span className="font-medium text-fg-2">{isStatic ? "내장 정책 사본" : "TermsDesk 게시 정본"}</span>
          <span>{doc.versionLabel}</span>
          {effective && <span>· 시행일 {effective}</span>}
          <span>
            · {isStatic ? "사본 ID" : "해시"}{" "}
            <code className="font-mono text-fg-2">{shortContentHash(doc.contentHash)}</code>
          </span>
        </p>
        {isStatic && (
          <p className="mt-2">
            API 연결 없이도 정책을 확인할 수 있도록 포함한 사본입니다. 최신 게시 정본은 TermsDesk 링크에서
            확인할 수 있습니다.
          </p>
        )}
        <a
          href={policyPublicUrl(doc.policySlug)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-accent transition-colors hover:text-accent-2"
        >
          TermsDesk에서 원문·버전 이력 보기
          <ExternalLink size={12} aria-hidden />
        </a>
      </footer>
    </>
  );
}

function PolicySkeleton({ label }: { label: string }) {
  return (
    <div className="mt-8 space-y-7" role="status" aria-label={`${label} 불러오는 중`}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-2.5">
          <div className="skeleton h-5 w-44 rounded-md" />
          <div className="skeleton h-4 w-full rounded-md" />
          <div className="skeleton h-4 w-[88%] rounded-md" />
          <div className="skeleton h-4 w-[72%] rounded-md" />
        </div>
      ))}
    </div>
  );
}

// 로드 실패 시: 재시도 + TermsDesk 게시 페이지로 가는 외부 폴백 카드.
export function PolicyErrorFallback({
  slug,
  label,
  onRetry,
}: {
  slug: PolicySlug;
  label: string;
  onRetry?: () => void;
}) {
  return (
    <div className="mt-8 space-y-4">
      <ErrorState
        title={`${label}을 불러오지 못했습니다.`}
        message="네트워크 상태를 확인한 뒤 다시 시도해 주세요."
        onRetry={onRetry}
      />
      <div className="rounded-2xl border border-line/60 bg-card/20 p-5 text-sm leading-relaxed text-fg-2">
        <p>
          지금 바로 확인이 필요하다면 TermsDesk에 게시된 정본을 새 탭에서 열 수 있어요. 내용은 이
          페이지와 동일한 게시본입니다.
        </p>
        <a
          href={policyPublicUrl(slug)}
          target="_blank"
          rel="noreferrer"
          className={buttonClass({ size: "sm", variant: "outline", className: "mt-3 gap-1.5" })}
        >
          TermsDesk에서 열기
          <ExternalLink size={14} aria-hidden />
        </a>
      </div>
    </div>
  );
}

function PolicyPageShell({
  slug,
  eyebrow,
  fallbackName,
}: {
  slug: PolicySlug;
  eyebrow: string;
  fallbackName: string;
}) {
  const fallbackDoc = getStaticPolicyDocument(slug);
  const [doc, setDoc] = useState<PolicyDocument | null>(fallbackDoc);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!shouldAutoFetchPolicyDocument()) {
      setDoc(fallbackDoc);
      setLoading(false);
      setError(false);
      return;
    }

    let alive = true;
    const controller = new AbortController();
    setLoading(false);
    setError(false);
    fetchPolicyDocument(slug, controller.signal)
      .then((payload) => {
        if (alive) setDoc(payload);
      })
      .catch(() => {
        if (!alive || controller.signal.aborted) return;
        setDoc(fallbackDoc);
        setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [fallbackDoc, slug, reloadKey]);

  return (
    <Container size="prose" className="py-8 sm:py-12 lg:py-16">
      <p className="eyebrow text-accent">{eyebrow}</p>
      <h1 className="mt-3 text-pretty text-[clamp(1.6rem,7vw,1.875rem)] font-bold leading-tight sm:text-4xl">
        {doc?.name || fallbackName}
      </h1>
      {error && doc ? (
        <div className="mt-5 rounded-2xl border border-line/60 bg-card/20 p-4 text-sm leading-relaxed text-fg-2">
          <p>TermsDesk 게시 정본을 동기화하지 못해 내장 정책 사본을 표시합니다.</p>
          <button
            type="button"
            className={buttonClass({ size: "sm", variant: "outline", className: "mt-3" })}
            onClick={() => setReloadKey((v) => v + 1)}
          >
            다시 시도
          </button>
        </div>
      ) : null}
      {loading ? (
        <PolicySkeleton label={fallbackName} />
      ) : !doc ? (
        <PolicyErrorFallback slug={slug} label={fallbackName} onRetry={() => setReloadKey((v) => v + 1)} />
      ) : (
        <PolicyArticle doc={doc} />
      )}
    </Container>
  );
}

export function TermsPage() {
  return <PolicyPageShell slug="terms-of-service" eyebrow="TERMS" fallbackName="이용약관" />;
}

export function PrivacyPage() {
  return <PolicyPageShell slug="privacy-policy" eyebrow="PRIVACY" fallbackName="개인정보처리방침" />;
}
