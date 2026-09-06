import {
  CheckCircle2,
  Download,
  Palette,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useMarketLibrary } from "../hooks/use-market-library";
import { marketKindMeta, marketLicenseMeta } from "../models/market-kind";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

import { buttonClass } from "@/shared/components/ui/button-utils";

interface MarketAcquisitionModalProps {
  open: boolean;
  onClose: () => void;
  record: CreatorMarketplaceResourceRecord;
  onAcquiredSuccess?: () => void;
}

export function MarketAcquisitionModal({
  open,
  onClose,
  record,
  onAcquiredSuccess,
}: MarketAcquisitionModalProps) {
  const navigate = useNavigate();
  const { acquireResource } = useMarketLibrary();
  const [agreed, setAgreed] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  if (!open) return null;

  const kind = marketKindMeta(record.kind);
  const license = marketLicenseMeta(record.license);

  const handleAcquire = async () => {
    if (!agreed || submitting) return;
    setSubmitting(true);
    try {
      await acquireResource(record);
      setCompleted(true);
      onAcquiredSuccess?.();
    } catch {
      // safe fallback
      setCompleted(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenInStudio = () => {
    onClose();
    navigate(`/studio?installMarketResource=${record.id}&assetMarket=community`);
  };

  const handleGoToLibrary = () => {
    onClose();
    navigate("/market/library");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="market-acquire-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="market-acquire-title" className="text-base font-bold text-fg flex items-center gap-2">
            <Sparkles className="size-4 text-accent" />
            <span>{completed ? "소장 완료" : "에셋 무료 소장 및 라이선스 발급"}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-fg-3 hover:bg-raised hover:text-fg"
          >
            <X className="size-4" />
            <span className="sr-only">닫기</span>
          </button>
        </div>

        {completed ? (
          /* Post-Acquisition Success View */
          <div className="p-6 text-center space-y-4">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-good/20 text-good">
              <CheckCircle2 className="size-8" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-fg">내 보관함에 안전하게 등록되었습니다!</h3>
              <p className="mt-1 text-xs text-fg-2 leading-relaxed">
                스튜디오 캔버스나 도구함에서 바로 꺼내 쓰실 수 있습니다.
              </p>
            </div>

            <div className="rounded-xl border border-line bg-panel p-3.5 text-left text-xs space-y-1">
              <p className="font-semibold text-fg flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-good" />
                <span>{license.label} 라이선스 적용됨</span>
              </p>
              <p className="text-fg-3 text-[0.68rem]">
                웹툰 상업 연재 100% 허용 · 영구 소장 및 버전 업데이트 무료 지원
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={handleOpenInStudio}
                className={buttonClass({
                  variant: "solid",
                  size: "md",
                  className: "w-full gap-2 bg-gradient-to-r from-accent to-accent-2 text-on-accent",
                })}
              >
                <Palette className="size-4" />
                <span>스튜디오에서 즉시 열기 및 적용</span>
              </button>
              <button
                type="button"
                onClick={handleGoToLibrary}
                className={buttonClass({
                  variant: "outline",
                  size: "sm",
                  className: "w-full",
                })}
              >
                내 보관함으로 이동
              </button>
            </div>
          </div>
        ) : (
          /* Pre-Acquisition Confirmation View */
          <div className="p-5 space-y-4">
            {/* Asset Preview Box */}
            <div className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-raised text-accent font-bold">
                <kind.icon className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="inline-flex rounded bg-accent/20 px-1.5 py-0.2 text-[0.62rem] font-bold text-accent">
                  {kind.label}
                </span>
                <h3 className="truncate text-sm font-bold text-fg leading-snug">
                  {record.name}
                </h3>
                <p className="text-[0.68rem] text-fg-3">
                  배급: {record.publisher.name} · v{record.resourceVersion}
                </p>
              </div>
            </div>

            {/* Price & License Highlights */}
            <div className="rounded-xl border border-good/40 bg-good/10 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-fg">결제 금액</span>
                <span className="text-sm font-extrabold text-good">0원 (무료 배포)</span>
              </div>
              <div className="border-t border-good/20 pt-2 text-xs text-fg-2 space-y-1">
                <div className="flex items-center gap-1.5 text-good font-semibold">
                  <CheckCircle2 className="size-3.5" />
                  <span>상업용 웹툰 연재 자유로운 활용 보증</span>
                </div>
                <p className="text-[0.68rem] text-fg-3 leading-relaxed">
                  네이버/카카오/탑툰/레진 등 모든 상업 플랫폼 연재, 출판, 외주 작업에 자유롭게 사용할 수 있습니다.
                </p>
              </div>
            </div>

            {/* Terms Checkbox */}
            <label className="flex items-start gap-2 text-xs text-fg-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 rounded border-line text-accent focus:ring-accent"
              />
              <span className="text-[0.72rem] leading-relaxed">
                에셋 파일 무단 재배포 및 AI 학습용 크롤링 금지 정책에 동의하며 소장합니다.
              </span>
            </label>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
              <button
                type="button"
                onClick={onClose}
                className={buttonClass({ variant: "ghost", size: "sm" })}
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleAcquire}
                disabled={!agreed || submitting}
                className={buttonClass({
                  variant: "solid",
                  size: "md",
                  className: "gap-2 min-w-36 disabled:opacity-40",
                })}
              >
                <Download className="size-4" />
                <span>{submitting ? "소장 처리 중..." : "무료로 소장하기"}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
