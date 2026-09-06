import { Check, Copy, Download, Palette } from "lucide-react";
import { useState } from "react";

import { buttonClass } from "@/shared/components/ui/button-utils";

interface MarketPalettePreviewProps {
  readonly colors: readonly string[];
  readonly paletteName?: string;
  className?: string;
}

export function MarketPalettePreview({
  colors,
  paletteName = "팔레트",
  className,
}: MarketPalettePreviewProps) {
  const [copiedColor, setCopiedColor] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const handleCopyColor = async (color: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(color);
      setCopyError(null);
      setCopiedColor(color);
      setTimeout(() => setCopiedColor(null), 1800);
    } catch {
      setCopiedColor(null);
      setCopyError(color);
    }
  };

  const handleDownloadPaletteJson = () => {
    const data = {
      name: paletteName,
      colors,
      exportedAt: new Date().toISOString(),
      generator: "ToonSpectrum Creator Market",
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${paletteName.toLowerCase().replace(/\s+/g, "-")}-palette.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="region"
      aria-labelledby="market-palette-heading"
      className={`overflow-hidden rounded-xl border border-line bg-card ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5 bg-panel/50">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-accent" aria-hidden="true" />
          <h2 id="market-palette-heading" className="text-xs font-semibold text-fg">색상 구성 ({colors.length}색)</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadPaletteJson}
            className={buttonClass({ variant: "ghost", size: "sm", className: "min-h-8 px-2 text-[0.68rem] pointer-coarse:min-h-11" })}
            title="JSON 파일로 다운로드"
          >
            <Download className="h-3 w-3 mr-1" aria-hidden="true" />
            JSON 저장
          </button>
        </div>
      </div>

      {/* Harmonized Gradient Bar */}
      <div
        className="h-6 w-full"
        style={{
          background: `linear-gradient(to right, ${colors.join(", ")})`,
        }}
        aria-hidden="true"
      />

      {/* Swatches Grid */}
      <div className="p-4">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {colors.map((color, index) => {
            const isCopied = copiedColor === color;

            return (
              <li key={`${color}-${index}`}>
                <button
                  type="button"
                  onClick={() => void handleCopyColor(color)}
                  aria-label={`${color} 색상 복사`}
                  className="group relative flex w-full flex-col overflow-hidden rounded-lg border border-line text-left transition-transform duration-150 hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <div
                    className="relative flex aspect-[4/3] w-full items-center justify-center p-2 transition-opacity group-hover:opacity-95"
                    style={{ backgroundColor: color }}
                  >
                    <span className="inline-flex min-h-6 items-center gap-1 rounded-md bg-canvas px-1.5 text-[0.65rem] font-bold text-fg opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                      {isCopied ? (
                        <>
                          <Check className="h-3 w-3 text-good" aria-hidden="true" />
                          복사됨
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" aria-hidden="true" />
                          복사
                        </>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-line bg-card px-2 py-1.5">
                    <span className="numeral tnum text-[0.68rem] font-semibold text-fg">{color}</span>
                    <span className="text-[0.6rem] text-fg-3">#{index + 1}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex min-h-8 items-center justify-between gap-3 border-t border-line bg-panel/30 px-4 py-2 text-[0.68rem] text-fg-3">
        <span>색상 타일을 선택하면 HEX 코드를 클립보드에 복사합니다.</span>
        {copiedColor ? (
          <span className="font-semibold text-good inline-flex items-center gap-1" aria-live="polite">
            <Check className="h-3 w-3" aria-hidden="true" /> {copiedColor} 복사 완료
          </span>
        ) : copyError ? (
          <span className="inline-flex items-center gap-1 font-semibold text-bad" role="alert">
            {copyError} 복사 실패 · 브라우저 권한을 확인해 주세요
          </span>
        ) : null}
      </div>
    </div>
  );
}
