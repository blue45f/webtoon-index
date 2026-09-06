import { AlertCircle, AlertTriangle, Compass, Globe, Monitor, RefreshCw, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

import { copyText } from "../shared/lib/copy-text";
import { checkBrowserCompatibility, getBrowserInfo } from "../compat/browser-check";


interface BrowserCompatModalProps {
  isOpen: boolean;
  onClose: () => void;
  reason?: string;
  missingFeatures?: string[];
  isBlocking?: boolean;
}

export const BrowserCompatModal: React.FC<BrowserCompatModalProps> = ({
  isOpen,
  onClose,
  reason,
  missingFeatures = [],
  isBlocking = false,
}) => {
  const [copyState, setCopyState] = useState<"copied" | "failed" | null>(null);
  // 언마운트 뒤 setState 를 막는다. 이 모달은 새로고침 버튼과 같은 화면에 있어 실제로 사라진다.
  const copyStateRef = useRef(true);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    copyStateRef.current = true;
    return () => {
      copyStateRef.current = false;
      if (copyResetRef.current !== null) clearTimeout(copyResetRef.current);
    };
  }, []);
  if (!isOpen) return null;

  const browser = getBrowserInfo();
  const compat = checkBrowserCompatibility();
  const actualMissing = missingFeatures.length > 0 ? missingFeatures : compat.missingFeatures;

  const handleRefresh = () => {
    window.location.reload();
  };

  // 이 버튼은 지원되지 않는 인앱 브라우저에서 사용자가 진짜 브라우저로 빠져나가는 유일한
  // 출구다. 그런데 인앱 WebView 는 clipboard 를 아예 안 주거나 사용자 제스처를 비동기
  // 클립보드까지 전달하지 않아 NotAllowedError 로 거절한다. 예전 코드는 결과를 기다리지 않고
  // "복사됨"을 띄웠으므로, 출구가 막힌 사용자에게 성공했다고 말하고 있었다.
  const handleCopyLink = () => {
    const href = window.location.href;
    void copyText(href).then((ok) => {
      if (!copyStateRef.current) return;
      setCopyState(ok ? "copied" : "failed");
      if (copyResetRef.current !== null) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => {
        if (copyStateRef.current) setCopyState(null);
      }, 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
      {/* 백드롭 레이어 (Glassmorphism & Backdrop Blur) */}
      <div
        role="button"
        tabIndex={0}
        aria-label="모달 닫기"
        className="fixed inset-0 bg-black/70 backdrop-blur-md transition-opacity"
        onClick={isBlocking ? undefined : onClose}
        onKeyDown={(e) => {
          if (!isBlocking && (e.key === "Enter" || e.key === "Escape" || e.key === " ")) {
            onClose();
          }
        }}
      />

      {/* 모달 팝업 컨테이너 */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/15 bg-[#1a1410]/95 p-6 sm:p-8 text-fg shadow-2xl backdrop-blur-xl transition-all">
        {/* 닫기 버튼 (비블로킹 모드일 때만 표시) */}
        {!isBlocking && (
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="absolute top-4 right-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-fg-3 hover:bg-white/10 hover:text-fg transition-colors"
          >
            <X size={18} />
          </button>
        )}

        {/* 메인 헤더 & 아이콘 */}
        <div className="flex items-start gap-4 mb-6">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/30 border border-amber-500/30 text-amber-400 shadow-inner">
            <Monitor size={28} />
          </div>
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400 border border-amber-500/20">
              <AlertCircle size={12} /> 브라우저 호환성 안내
            </span>
            <h3 className="mt-2 text-xl font-bold tracking-tight text-fg sm:text-2xl">
              최신 브라우저 업데이트가 필요합니다
            </h3>
          </div>
        </div>

        {/* 내용 가이드 */}
        <div className="space-y-4 text-sm text-fg-2 leading-relaxed">
          <p>
            현재 사용 중인 브라우저(<strong className="text-fg font-semibold">{browser.name} {browser.version}</strong>)는 
            툰스펙트럼의 3D 리더스튜디오 및 최신 웹 표준 기능을 완벽히 지원하지 않을 수 있습니다.
          </p>

          {reason && (
            <div className="rounded-xl border border-bad/30 bg-bad/10 p-3.5 text-xs text-bad-light font-mono break-all flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5 text-bad" />
              <span>{reason}</span>
            </div>
          )}

          {actualMissing.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3.5 text-xs">
              <span className="font-semibold text-fg block mb-1.5">미지원 감지 항목:</span>
              <ul className="list-disc list-inside space-y-1 text-fg-3">
                {actualMissing.map((feat, idx) => (
                  <li key={idx}>{feat}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-fg-3">
            더 빠르고 안전하며 쾌적한 이용을 위해 아래 추천 브라우저의 최신 버전으로 업데이트 후 접속해 주세요.
          </p>
        </div>

        {/* 추천 브라우저 다운로드 링크 그리드 */}
        <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <a
            href="https://www.google.com/chrome/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-3 text-center transition-all hover:border-accent/50 hover:bg-accent/10 hover:scale-[1.02] group"
          >
            <Globe size={24} className="mb-2 text-blue-400 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-semibold text-fg">Chrome</span>
            <span className="text-[10px] text-fg-3">권장</span>
          </a>

          <a
            href="https://www.microsoft.com/edge"
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-3 text-center transition-all hover:border-accent/50 hover:bg-accent/10 hover:scale-[1.02] group"
          >
            <Globe size={24} className="mb-2 text-teal-400 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-semibold text-fg">Edge</span>
            <span className="text-[10px] text-fg-3">최신</span>
          </a>

          <a
            href="https://www.apple.com/safari/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-3 text-center transition-all hover:border-accent/50 hover:bg-accent/10 hover:scale-[1.02] group"
          >
            <Compass size={24} className="mb-2 text-sky-400 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-semibold text-fg">Safari</span>
            <span className="text-[10px] text-fg-3">macOS/iOS</span>
          </a>

          <a
            href="https://www.mozilla.org/firefox/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-3 text-center transition-all hover:border-accent/50 hover:bg-accent/10 hover:scale-[1.02] group"
          >
            <Globe size={24} className="mb-2 text-orange-400 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-semibold text-fg">Firefox</span>
            <span className="text-[10px] text-fg-3">최신</span>
          </a>
        </div>

        {/* 푸터 하단 버튼 */}
        <div className="mt-7 flex flex-wrap items-center justify-end gap-2.5 pt-4 border-t border-white/10">
          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 text-xs font-medium text-fg hover:bg-white/10 transition-colors"
          >
            {copyState === "copied"
              ? "주소 복사됨!"
              : copyState === "failed"
                ? "복사할 수 없어요 — 주소창에서 직접 복사해 주세요"
                : "접속 주소 복사"}
          </button>

          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent/20 px-4 text-xs font-medium text-accent-light hover:bg-accent/30 transition-colors"
          >
            <RefreshCw size={14} />
            새로고침
          </button>

          {!isBlocking && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-accent px-4 text-xs font-semibold text-on-accent hover:bg-accent-2 transition-colors shadow-lg"
            >
              호환 모드로 계속하기
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
