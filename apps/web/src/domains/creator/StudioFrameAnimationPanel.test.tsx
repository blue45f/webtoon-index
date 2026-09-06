import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StudioFrameAnimationPanel } from "./StudioFrameAnimationPanel";
import source from "./StudioFrameAnimationPanel.tsx?raw";

const onionSkin = {
  enabled: true,
  prevCount: 1,
  nextCount: 1,
  opacity: 0.35,
  tint: true,
} as const;

function renderFrames(frameCount: number, captureDisabledReason?: string): string {
  const frames = Array.from({ length: frameCount }, (_, index) => ({
    id: `frame-${index + 1}`,
    src: "data:image/png;base64,AA==",
  }));
  return renderToStaticMarkup(
    <StudioFrameAnimationPanel
      element={{
        id: "image-1",
        src: "data:image/png;base64,AA==",
        width: 400,
        height: 600,
        rotation: 0,
        frames,
        frameFps: 12,
        frameLoop: true,
        activeFrameId: frames[0]?.id,
      }}
      title="테스트 작품"
      onClose={vi.fn()}
      onFramesChange={vi.fn()}
      onSettingsChange={vi.fn()}
      onActiveFrameChange={vi.fn()}
      onCaptureFrame={vi.fn()}
      captureDisabledReason={captureDisabledReason}
      onRemoveAnimation={vi.fn()}
      onionSkin={onionSkin}
      onOnionSkinChange={vi.fn()}
    />
  );
}

describe("StudioFrameAnimationPanel motion coach", () => {
  it("coaches capture, playback, frame actions, and onion-skin controls", () => {
    const html = renderFrames(1, "캔버스 캡처 준비가 끝나면 새 프레임을 만들 수 있어요.");

    expect(html.match(/data-studio-tool-hint-target="true"/g)?.length ?? 0).toBe(11);
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="선택 프레임 1 작업"');
    expect(html).toContain('aria-label="현재 그림을 새 프레임으로 캡처"');
    expect(html).toContain('aria-label="프레임 애니메이션 재생"');
    expect(html).toContain('aria-label="프레임을 앞으로 이동"');
    expect(html).toContain('aria-label="프레임 복제"');
    expect(html).toContain('aria-label="프레임 삭제"');
    expect(source).toContain('id: "frame-capture"');
    expect(source).toContain('id: "frame-playback"');
    expect(source).toContain('id: "frame-onion-skin"');
    expect(source).toContain('preview: "frame-capture"');
    expect(source).toContain('preview: "frame-playback"');
    expect(source).toContain('title: "프레임 애니메이션 정지"');
    expect(source).toContain('previewVariant: "play"');
    expect(source).toContain('previewVariant: "pause"');
    expect(source).toContain('preview: "frame-reorder"');
    expect(source).toContain('preview: "frame-duplicate"');
    expect(source).toContain('preview: "frame-delete"');
    expect(source).toContain('preview: "onion-skin"');
  });

  it("keeps every unavailable filmstrip action focusable with its exact reason", () => {
    const html = renderFrames(1);

    expect(html.match(/data-studio-tool-hint-unavailable="true"/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(source).toContain("이미 첫 번째 프레임이에요.");
    expect(source).toContain("애니메이션을 유지하려면 프레임이 최소 1장 필요해요.");
    expect(source).toContain("이미 마지막 프레임이에요.");
    expect(source).toContain("unavailableReason={captureReason ?? undefined}");
  });

  it("keeps one touch-sized contextual action bar regardless of frame count", () => {
    const singleFrame = renderFrames(1);
    const manyFrames = renderFrames(12);
    const countTargets = (html: string) => html.match(/data-studio-tool-hint-target="true"/g)?.length ?? 0;

    expect(countTargets(singleFrame)).toBe(11);
    expect(countTargets(manyFrames)).toBe(11);
    expect(source.match(/className="flex min-h-11 w-full/g)?.length ?? 0).toBe(4);
    expect(source).not.toContain("size-4 place-items-center");
  });

  it("keeps wrapped onion-skin rows stretched to the inspector width", () => {
    expect(source.match(/className="w-full \[&>\*\]:w-full"/g)?.length ?? 0).toBe(4);
  });

  it("removes duplicate native titles from controls that now use the rich coach", () => {
    expect(source).not.toContain('title="앞으로"');
    expect(source).not.toContain('title="복제"');
    expect(source).not.toContain('title="삭제"');
    expect(source).not.toContain('title="뒤로"');
    expect(source).not.toContain('title="현재 캔버스 내용을 새 프레임으로 캡처합니다."');
    expect(source).not.toContain('title="어니언스키닝 사용 켜기/끄기"');
  });
});
