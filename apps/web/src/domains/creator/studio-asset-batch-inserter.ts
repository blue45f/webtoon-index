/**
 * Studio Asset Batch Inserter
 *
 * 다중 에셋(스티커, 말풍선, 3D 소품, 배경 이미지)의 일괄 삽입(Batch Insert),
 * 자동 격자/지그재그 라이너 배치, Z-index 계층 정렬 및 삽입 트랜잭션을 관리합니다.
 */

export type AssetType = "image" | "bubble" | "3d-model" | "sticker" | "background" | "vector";

export interface BatchInsertItem {
  id: string;
  name: string;
  type: AssetType;
  src?: string;
  width: number;
  height: number;
  data?: Record<string, unknown>;
}

export interface PlacedAssetResult {
  id: string;
  type: AssetType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  data?: Record<string, unknown>;
}

export interface LayoutOptions {
  mode: "grid" | "horizontal" | "vertical" | "staggered" | "centered";
  spacing: number;
  startX: number;
  startY: number;
  maxRowWidth?: number;
  baseZIndex?: number;
}

export class StudioAssetBatchInserter {
  /**
   * 다중 에셋 항목들을 지정된 레이아웃 옵션에 따라 배치 좌표와 Z-index를 부여하여 산출합니다.
   */
  public static layoutBatchItems(
    items: BatchInsertItem[],
    options: LayoutOptions,
  ): PlacedAssetResult[] {
    const results: PlacedAssetResult[] = [];
    const spacing = options.spacing ?? 20;
    const baseZ = options.baseZIndex ?? 1;

    let currentX = options.startX;
    let currentY = options.startY;
    let maxLineHeight = 0;
    const maxWidth = options.maxRowWidth ?? 1200;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let posX: number;
      let posY: number;

      switch (options.mode) {
        case "horizontal":
          posX = currentX;
          posY = options.startY;
          currentX += item.width + spacing;
          break;

        case "vertical":
          posX = options.startX;
          posY = currentY;
          currentY += item.height + spacing;
          break;

        case "staggered":
          posX = options.startX + (i % 2 === 0 ? 0 : 40);
          posY = currentY;
          currentY += item.height + spacing;
          break;

        case "centered":
          posX = options.startX - item.width / 2;
          posY = options.startY - item.height / 2;
          break;

        case "grid":
        default:
          if (currentX + item.width > options.startX + maxWidth && currentX > options.startX) {
            currentX = options.startX;
            currentY += maxLineHeight + spacing;
            maxLineHeight = 0;
          }
          posX = currentX;
          posY = currentY;
          currentX += item.width + spacing;
          maxLineHeight = Math.max(maxLineHeight, item.height);
          break;
      }

      results.push({
        id: item.id,
        type: item.type,
        x: Math.round(posX),
        y: Math.round(posY),
        width: item.width,
        height: item.height,
        zIndex: baseZ + i,
        data: item.data,
      });
    }

    return results;
  }

  /**
   * 에셋 형태에 따른 기본 권장 크기를 반환합니다.
   */
  public static getDefaultDimensions(type: AssetType): { width: number; height: number } {
    switch (type) {
      case "bubble":
        return { width: 180, height: 120 };
      case "3d-model":
        return { width: 300, height: 300 };
      case "sticker":
        return { width: 120, height: 120 };
      case "background":
        return { width: 800, height: 1200 };
      case "vector":
        return { width: 200, height: 200 };
      case "image":
      default:
        return { width: 250, height: 250 };
    }
  }
}
