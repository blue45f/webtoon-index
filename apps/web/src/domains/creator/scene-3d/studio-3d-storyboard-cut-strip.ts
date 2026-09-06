/**
 * Studio 3D Vertical Webtoon Storyboard Cut Strip & Multi-Pass PSD Exporter
 *
 * Implements:
 * - Vertical Webtoon Strip Cut manager (reordering, framing, camera snapshots, dialog lines)
 * - Multi-Pass PSD Layer separation manifest (Line Art, Base Color, Cel Shadow, AO, Rim, FX, Speech, BG)
 * - Aspect ratio framing presets (21:9 Wide Action, 1:1 Medium, 9:16 Vertical Close-Up, 16:9 Cinematic)
 */

export type CutAspectRatio = "21:9-wide-action" | "1:1-square-medium" | "9:16-vertical-climax" | "16:9-cinematic";

export interface StoryboardCut {
  readonly id: string;
  readonly cutNumber: number;
  readonly title: string;
  readonly aspectRatio: CutAspectRatio;
  readonly cameraPosition: readonly [number, number, number];
  readonly cameraTarget: readonly [number, number, number];
  readonly cameraFovDeg: number;
  readonly cameraRollDeg: number;
  readonly characterIds: readonly string[];
  readonly dialogueLine?: string;
  readonly sfxSoundName?: string;
  readonly durationSeconds?: number;
}

export interface PsdLayerChannel {
  readonly name: string;
  readonly blendMode: "normal" | "multiply" | "screen" | "overlay" | "color-dodge";
  readonly opacity: number;
  readonly isVisible: boolean;
}

export interface PsdMultiPassExportManifest {
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly cuts: readonly StoryboardCut[];
  readonly channels: readonly PsdLayerChannel[];
  readonly colorSpace: "sRGB" | "Display-P3";
}

export class Studio3DStoryboardCutStrip {
  private cuts: StoryboardCut[] = [];
  private documentWidth = 800; // Standard Webtoon width 800px or 1600px

  constructor(initialCuts?: readonly StoryboardCut[]) {
    if (initialCuts) {
      this.cuts = [...initialCuts];
    }
  }

  public getCuts(): readonly StoryboardCut[] {
    return this.cuts;
  }

  public getDocumentWidth(): number {
    return this.documentWidth;
  }

  public setDocumentWidth(width: number): void {
    this.documentWidth = Math.max(300, width);
  }

  public addCut(cut: StoryboardCut): void {
    this.cuts.push(cut);
    this.reindexCuts();
  }

  public removeCut(id: string): void {
    this.cuts = this.cuts.filter((c) => c.id !== id);
    this.reindexCuts();
  }

  public moveCut(fromIndex: number, toIndex: number): void {
    if (
      fromIndex < 0 ||
      fromIndex >= this.cuts.length ||
      toIndex < 0 ||
      toIndex >= this.cuts.length
    ) {
      return;
    }
    const [cut] = this.cuts.splice(fromIndex, 1);
    if (cut) {
      this.cuts.splice(toIndex, 0, cut);
      this.reindexCuts();
    }
  }

  private reindexCuts(): void {
    this.cuts = this.cuts.map((cut, idx) => ({
      ...cut,
      cutNumber: idx + 1,
    }));
  }

  /**
   * Calculates pixel dimensions for a given cut aspect ratio.
   */
  public evaluateCutPixelDimensions(aspectRatio: CutAspectRatio): { readonly width: number; readonly height: number } {
    const w = this.documentWidth;
    switch (aspectRatio) {
      case "21:9-wide-action":
        return { width: w, height: Math.round((w * 9) / 21) };
      case "1:1-square-medium":
        return { width: w, height: w };
      case "9:16-vertical-climax":
        return { width: w, height: Math.round((w * 16) / 9) };
      case "16:9-cinematic":
        return { width: w, height: Math.round((w * 9) / 16) };
    }
  }

  /**
   * Generates the total cumulative height of the full vertical webtoon strip.
   */
  public evaluateTotalStripHeight(interCutSpacingPx = 80): number {
    if (this.cuts.length === 0) return 0;
    const heightsSum = this.cuts.reduce(
      (sum, cut) => sum + this.evaluateCutPixelDimensions(cut.aspectRatio).height,
      0,
    );
    const spacingSum = (this.cuts.length - 1) * interCutSpacingPx;
    return heightsSum + spacingSum;
  }

  /**
   * Generates standard multi-pass PSD layers manifest for professional finishing in Photoshop / Clip Studio.
   */
  public generatePsdExportManifest(): PsdMultiPassExportManifest {
    const totalHeight = this.evaluateTotalStripHeight();

    const channels: PsdLayerChannel[] = [
      { name: "Speech & Text (말풍선 및 대사)", blendMode: "normal", opacity: 1.0, isVisible: true },
      { name: "Emotion & Action FX (효과선 및 이모트)", blendMode: "normal", opacity: 1.0, isVisible: true },
      { name: "Rim Light & Glow (하이라이트/역광)", blendMode: "screen", opacity: 0.85, isVisible: true },
      { name: "Ink Line Art (3D 외곽선 추출)", blendMode: "multiply", opacity: 1.0, isVisible: true },
      { name: "Deep AO Shadow 2 (2차 깊은 음영)", blendMode: "multiply", opacity: 0.65, isVisible: true },
      { name: "Cel Shadow Tone 1 (1차 툰 음영)", blendMode: "multiply", opacity: 0.75, isVisible: true },
      { name: "Base Flat Color (기본 밑색)", blendMode: "normal", opacity: 1.0, isVisible: true },
      { name: "3D Background Scene (3D 배경)", blendMode: "normal", opacity: 1.0, isVisible: true },
    ];

    return {
      documentWidth: this.documentWidth,
      documentHeight: totalHeight,
      cuts: this.cuts,
      channels,
      colorSpace: "sRGB",
    };
  }
}
