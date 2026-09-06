/**
 * Studio Sticker Grid — FX 스티커 팔레트의 카테고리 그리드(만화/동물/소품 등)가 복붙하던
 * 4열 버튼 그리드를 한 컴포넌트로 모은 것. 각 항목 svg 미리보기 + 라벨, 클릭 시 onAdd 호출.
 * 상태 없는 순수 프레젠테이션.
 */
import { svgToDataUrl } from "./studio-characters";

type StickerGridItem = { id: string; label: string; svg: string; width: number; height: number };

export function StudioStickerGrid({
  title,
  items,
  onAdd,
}: {
  title: string;
  items: readonly StickerGridItem[];
  onAdd: (svg: string, width: number, height: number) => void;
}): React.ReactElement {
  return (
    <>
      <p className="mb-1 mt-2 text-[0.66rem] font-medium text-fg-3 border-t border-line pt-2">{title}</p>
      <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto pr-1">
        {items.map((sticker) => (
          <button
            key={sticker.id}
            type="button"
            title={sticker.label}
            onClick={() => onAdd(sticker.svg, sticker.width, sticker.height)}
            className="group flex flex-col items-center justify-center rounded-lg border border-line bg-card p-1 hover:border-accent/50"
          >
            <div className="flex h-12 w-full items-center justify-center overflow-hidden rounded bg-[oklch(0.94_0.01_78)] p-1">
              <img
                src={svgToDataUrl(sticker.svg)}
                alt={sticker.label}
                className="h-full w-full object-contain transition-transform group-hover:scale-105"
              />
            </div>
            <span className="mt-0.5 block w-full truncate text-center text-[0.55rem] text-fg-3">{sticker.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
