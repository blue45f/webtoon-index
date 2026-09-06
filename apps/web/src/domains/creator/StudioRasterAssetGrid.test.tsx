import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { STUDIO_RASTER_ASSETS } from "./render/studio-raster-assets";
import {
  createStudioAssetFavoriteId,
  type StudioAssetFavoriteId,
  type StudioAssetFavoriteState,
} from "./studio-asset-favorites";
import { StudioRasterAssetGrid, type StudioRasterAssetGridProps } from "./StudioRasterAssetGrid";

const [CAFE_ASSET, SCHOOL_ASSET, FANTASY_ASSET] = STUDIO_RASTER_ASSETS;

function favoriteState(...ids: StudioAssetFavoriteId[]): StudioAssetFavoriteState {
  return { version: 1, ids };
}

function createProps(overrides: Partial<StudioRasterAssetGridProps> = {}): StudioRasterAssetGridProps {
  return {
    assets: [SCHOOL_ASSET, CAFE_ASSET, FANTASY_ASSET],
    busyId: null,
    onAdd: vi.fn(),
    favoriteState: favoriteState(),
    favoriteOnly: false,
    setFavoriteOnly: vi.fn(),
    onToggleFavorite: vi.fn(),
    ...overrides,
  };
}

interface TestButtonProps {
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  "aria-busy"?: boolean;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
}

function findButton(node: ReactNode, ariaLabel: string): ReactElement<TestButtonProps> {
  let result: ReactElement<TestButtonProps> | null = null;

  function visit(child: ReactNode) {
    if (Array.isArray(child)) {
      child.forEach(visit);
      return;
    }
    if (!isValidElement<TestButtonProps>(child)) return;
    if (child.type === "button" && child.props["aria-label"] === ariaLabel) {
      result = child;
      return;
    }
    visit(child.props.children);
  }

  visit(node);
  expect(result, `button with aria-label "${ariaLabel}"`).not.toBeNull();
  return result as unknown as ReactElement<TestButtonProps>;
}

function maximumNestedButtonDepth(html: string): number {
  let depth = 0;
  let maximum = 0;
  for (const [token] of html.matchAll(/<\/?button\b[^>]*>/gu)) {
    if (token.startsWith("</")) {
      depth -= 1;
    } else {
      depth += 1;
      maximum = Math.max(maximum, depth);
    }
  }
  return maximum;
}

describe("StudioRasterAssetGrid favorites", () => {
  it("places favorites first while preserving each group's incoming search order", () => {
    const cafeFavoriteId = createStudioAssetFavoriteId("raster", CAFE_ASSET.id);
    const html = renderToStaticMarkup(
      <StudioRasterAssetGrid {...createProps({ favoriteState: favoriteState(cafeFavoriteId) })} />
    );

    const cafeIndex = html.indexOf(`${CAFE_ASSET.label} 캔버스에 추가`);
    const schoolIndex = html.indexOf(`${SCHOOL_ASSET.label} 캔버스에 추가`);
    const fantasyIndex = html.indexOf(`${FANTASY_ASSET.label} 캔버스에 추가`);

    expect(cafeIndex).toBeGreaterThan(-1);
    expect(cafeIndex).toBeLessThan(schoolIndex);
    expect(schoolIndex).toBeLessThan(fantasyIndex);
  });

  it("shows only favorites and teaches an empty favorite-only state", () => {
    const schoolFavoriteId = createStudioAssetFavoriteId("raster", SCHOOL_ASSET.id);
    const html = renderToStaticMarkup(
      <StudioRasterAssetGrid
        {...createProps({ favoriteOnly: true, favoriteState: favoriteState(schoolFavoriteId) })}
      />
    );

    expect(html).toContain(`${SCHOOL_ASSET.label} 캔버스에 추가`);
    expect(html).not.toContain(`${CAFE_ASSET.label} 캔버스에 추가`);
    expect(html).not.toContain(`${FANTASY_ASSET.label} 캔버스에 추가`);
    expect(html).toContain('aria-pressed="true"');

    const emptyHtml = renderToStaticMarkup(
      <StudioRasterAssetGrid {...createProps({ favoriteOnly: true })} />
    );
    expect(emptyHtml).toContain("아직 즐겨찾기한 소품이 없습니다.");
    expect(emptyHtml).toContain("별 버튼을 눌러 자주 쓰는 소품을 이곳에 모아보세요.");
  });

  it("keeps favorite and canvas insertion as independent actions", () => {
    const onAdd = vi.fn();
    const onToggleFavorite = vi.fn();
    const tree = StudioRasterAssetGrid(createProps({ onAdd, onToggleFavorite }));

    const favoriteButton = findButton(tree, `${SCHOOL_ASSET.label} 즐겨찾기에 추가`);
    favoriteButton.props.onClick?.();

    expect(onToggleFavorite).toHaveBeenCalledOnce();
    expect(onToggleFavorite).toHaveBeenCalledWith(
      createStudioAssetFavoriteId("raster", SCHOOL_ASSET.id)
    );
    expect(onAdd).not.toHaveBeenCalled();

    const insertButton = findButton(tree, `${SCHOOL_ASSET.label} 캔버스에 추가`);
    insertButton.props.onClick?.();

    expect(onAdd).toHaveBeenCalledOnce();
    expect(onAdd).toHaveBeenCalledWith(SCHOOL_ASSET);
    expect(onToggleFavorite).toHaveBeenCalledOnce();
  });

  it("uses semantic sibling controls with 44px targets, pressed labels, and busy state", () => {
    const favoriteId = createStudioAssetFavoriteId("raster", SCHOOL_ASSET.id);
    const props = createProps({
      busyId: SCHOOL_ASSET.id,
      favoriteState: favoriteState(favoriteId),
    });
    const html = renderToStaticMarkup(<StudioRasterAssetGrid {...props} />);
    const tree = StudioRasterAssetGrid(props);

    expect(maximumNestedButtonDepth(html)).toBe(1);
    expect(html).toContain("grid grid-cols-2 gap-2");
    expect(html).toContain("min-h-11");
    expect(html.match(/size-11/gu)?.length).toBeGreaterThanOrEqual(6);
    expect(html).toContain('aria-label="교실 책상 학습 소품 세트 즐겨찾기에서 제거"');
    expect(html).toContain('aria-label="카페 테이블 2인 세트 즐겨찾기에 추가"');
    expect(html).toContain('aria-busy="true"');

    const busyInsertButton = findButton(tree, `${SCHOOL_ASSET.label} 캔버스에 추가`);
    expect(busyInsertButton.props.disabled).toBe(true);
    expect(busyInsertButton.props["aria-busy"]).toBe(true);
  });
});
