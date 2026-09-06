import { Download, Plus } from "lucide-react";

import {
  createStudioPitchPptxBlob,
  studioPitchPptxFileName,
} from "./studio-pptx-export";

import { buttonClass } from "@/shared/components/ui/button-utils";

interface PitchSlideLike {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export function StudioPitchPptxCard({
  title,
  slides,
  onChangeSlide,
  onAddSlide,
  onNotice,
}: {
  readonly title: string;
  readonly slides: readonly PitchSlideLike[];
  readonly onChangeSlide: (id: string, patch: { readonly title?: string; readonly body?: string }) => void;
  readonly onAddSlide: () => void;
  readonly onNotice: (message: string) => void;
}) {
  const download = () => {
    try {
      const blob = createStudioPitchPptxBlob({ title, slides });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = studioPitchPptxFileName(title);
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
      onNotice("편집 가능한 PowerPoint(.pptx)를 저장했습니다.");
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : "PPTX를 만들지 못했습니다.");
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-4 shadow-sm" data-studio-pptx-export>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-fg">PowerPoint 편집본</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-fg-2">
            제목과 본문을 PowerPoint의 편집 가능한 텍스트 상자로 내보냅니다. 글꼴은 수신 환경에서 대체될 수 있으며 복잡한 원고 그래픽은 이 모드에 자동 포함되지 않습니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass({ variant: "outline", size: "sm" })} onClick={onAddSlide}>
            <Plus className="size-4" aria-hidden="true" />
            슬라이드 추가
          </button>
          <button type="button" className={buttonClass({ size: "sm" })} onClick={download} disabled={slides.length === 0}>
            <Download className="size-4" aria-hidden="true" />
            PPTX 저장
          </button>
        </div>
      </header>
      <div className="space-y-3">
        {slides.map((slide, index) => (
          <article key={slide.id} className="grid gap-2 rounded-xl border border-line bg-panel p-3 md:grid-cols-[7rem_minmax(0,1fr)]">
            <div className="text-xs font-bold text-fg-3">SLIDE {index + 1}</div>
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-fg-2">
                제목
                <input
                  defaultValue={slide.title}
                  key={`${slide.id}:title:${slide.title}`}
                  className="mt-1 min-h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm font-bold text-fg outline-none focus:border-accent"
                  onBlur={(event) => {
                    const value = event.currentTarget.value.trim();
                    if (value !== slide.title) onChangeSlide(slide.id, { title: value });
                  }}
                />
              </label>
              <label className="block text-xs font-semibold text-fg-2">
                본문
                <textarea
                  defaultValue={slide.body}
                  key={`${slide.id}:body:${slide.body}`}
                  rows={3}
                  className="mt-1 w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-sm leading-relaxed text-fg outline-none focus:border-accent"
                  onBlur={(event) => {
                    const value = event.currentTarget.value.trim();
                    if (value !== slide.body) onChangeSlide(slide.id, { body: value });
                  }}
                />
              </label>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
