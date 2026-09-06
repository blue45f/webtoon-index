import { toPng } from "html-to-image";
import { Download, Share2, Link2, X, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FortuneShareCard } from "./FortuneShareCard";

import type { FortuneResult, FortuneTab } from "./FortunePage";

interface ShareCharacter {
  id: string;
  name: string;
  origin: string;
  avatarUrl: string;
}

interface FortuneShareModalProps {
  result: FortuneResult;
  character: ShareCharacter;
  tab: FortuneTab;
  onClose: () => void;
}

const TAB_LABEL: Record<FortuneTab, string> = {
  today: "오늘의 운세",
  zodiac: "별자리 운세",
  saju: "사주팔자",
  compatibility: "인연 궁합",
  tarot: "오늘의 타로",
  prescription: "독서 처방",
};

export function FortuneShareModal({
  result,
  character,
  tab,
  onClose,
}: FortuneShareModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateLabel = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const fileName = `toonspectrum-fortune-${character.id}-${tab}.png`;
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/fortune`
      : "https://www.toonstudio.cloud/fortune";

  // Esc로 닫기 + 진입 시 포커스
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function renderPng(): Promise<string | null> {
    if (!cardRef.current) return null;
    // skipFonts: 크로스도메인 폰트(Google/Pretendard CDN)는 CORS로 cssRules를 못 읽어
    // 임베딩이 실패하며 콘솔 에러만 남긴다. 어차피 시스템 폰트로 렌더되므로 건너뛴다.
    return toPng(cardRef.current, {
      pixelRatio: 3,
      cacheBust: true,
      skipFonts: true,
    });
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await renderPng();
      if (!dataUrl) return;
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = fileName;
      a.click();
    } catch (e) {
      console.error(e);
      setError("이미지 저장에 실패했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function handleShare() {
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await renderPng();
      const nav = navigator as Navigator & {
        canShare?: (d: ShareData) => boolean;
      };
      if (dataUrl && typeof nav.share === "function") {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], fileName, { type: "image/png" });
        const data: ShareData & { files?: File[] } = {
          title: "ToonSpectrum 캐릭터 운세",
          text: `${character.name}가 본 나의 ${TAB_LABEL[tab]} 🔮`,
          url: shareUrl,
        };
        if (nav.canShare && nav.canShare({ files: [file] }))
          data.files = [file];
        await nav.share(data);
      } else {
        await copyLink();
      }
    } catch (e) {
      // 사용자가 공유 시트를 닫은 경우(AbortError)는 무시
      if ((e as Error)?.name !== "AbortError") {
        console.error(e);
        await copyLink();
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("링크 복사에 실패했어요.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="운세 결과 공유"
        tabIndex={-1}
        className="relative flex max-h-[92vh] w-full max-w-[420px] flex-col gap-4 overflow-y-auto rounded-2xl border border-line bg-panel p-4 outline-none"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-fg">운세 결과 공유</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-lg border border-line p-1.5 text-fg-2 transition-colors hover:bg-card"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 카드 미리보기 (이 노드를 그대로 PNG로 캡처) */}
        <div className="flex justify-center overflow-x-auto">
          <FortuneShareCard
            ref={cardRef}
            result={result}
            character={character}
            tab={tab}
            dateLabel={dateLabel}
          />
        </div>

        {error && <p className="text-center text-xs text-bad">{error}</p>}

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="flex flex-col items-center gap-1 rounded-xl border border-line bg-card py-2.5 text-[11px] font-bold text-fg-2 transition-colors hover:bg-raised disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            이미지 저장
          </button>
          <button
            type="button"
            onClick={handleShare}
            disabled={busy}
            className="flex flex-col items-center gap-1 rounded-xl bg-accent py-2.5 text-[11px] font-bold text-on-accent transition-colors hover:bg-accent-2 disabled:opacity-50"
          >
            <Share2 className="h-4 w-4" />
            공유하기
          </button>
          <button
            type="button"
            onClick={copyLink}
            disabled={busy}
            className="flex flex-col items-center gap-1 rounded-xl border border-line bg-card py-2.5 text-[11px] font-bold text-fg-2 transition-colors hover:bg-raised disabled:opacity-50"
          >
            {copied ? (
              <Check className="h-4 w-4 text-good" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            {copied ? "복사됨" : "링크 복사"}
          </button>
        </div>
        {busy && (
          <p className="text-center text-[11px] text-fg-3">
            이미지를 만드는 중…
          </p>
        )}
      </div>
    </div>
  );
}
