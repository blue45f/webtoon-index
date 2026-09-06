export type ToonPassType =
  | "beauty"
  | "line-art"
  | "screentone"
  | "shadow-ao"
  | "depth"
  | "object-id"
  | "normal"
  | "material-id"
  | "rim-light";

export type LayerBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "soft-light"
  | "color-dodge";

export interface ToonPassConfig {
  passType: ToonPassType;
  enabled: boolean;
  resolutionMultiplier: number; // 1 = 1x, 2 = 2x supersampling
  bitDepth: 8 | 16 | 32;
  channelName: string;
  blendMode: LayerBlendMode;
  opacity: number; // 0.0 ~ 1.0
}

export type ToonRenderQualityPreset = "draft" | "interactive" | "final";

export interface Studio3DToonPipelineProfile {
  id: string;
  name: string;
  quality: ToonRenderQualityPreset;
  passes: Record<ToonPassType, ToonPassConfig>;
  outlineThickness: number;
  creaseAngleThreshold: number;
  shadowBands: number; // 카툰 섀도우 단수 (예: 2 = 2단 툰 섀딩)
  depthFogEnabled: boolean;
  rimLightIntensity: number;
  screentoneFrequency: number;
}

export function createDefaultToonPipelineProfile(
  id = "toon-standard",
  name = "웹툰 표준 카툰 렌더 프로필",
  quality: ToonRenderQualityPreset = "interactive",
): Studio3DToonPipelineProfile {
  return {
    id,
    name,
    quality,
    outlineThickness: 1.5,
    creaseAngleThreshold: 35,
    shadowBands: 2,
    depthFogEnabled: true,
    rimLightIntensity: 0.7,
    screentoneFrequency: 60,
    passes: {
      beauty: {
        passType: "beauty",
        enabled: true,
        resolutionMultiplier: quality === "final" ? 2 : 1,
        bitDepth: 8,
        channelName: "RGB Color",
        blendMode: "normal",
        opacity: 1.0,
      },
      "line-art": {
        passType: "line-art",
        enabled: true,
        resolutionMultiplier: quality === "final" ? 2 : 1,
        bitDepth: 8,
        channelName: "Line Ink Layer",
        blendMode: "multiply",
        opacity: 1.0,
      },
      screentone: {
        passType: "screentone",
        enabled: false,
        resolutionMultiplier: quality === "final" ? 2 : 1,
        bitDepth: 8,
        channelName: "Manga Screentone",
        blendMode: "multiply",
        opacity: 0.8,
      },
      "shadow-ao": {
        passType: "shadow-ao",
        enabled: true,
        resolutionMultiplier: 1,
        bitDepth: 8,
        channelName: "Toon Shadow & AO",
        blendMode: "multiply",
        opacity: 0.85,
      },
      depth: {
        passType: "depth",
        enabled: true,
        resolutionMultiplier: 1,
        bitDepth: 16,
        channelName: "Linear Depth Map",
        blendMode: "normal",
        opacity: 1.0,
      },
      "object-id": {
        passType: "object-id",
        enabled: true,
        resolutionMultiplier: 1,
        bitDepth: 8,
        channelName: "Object Mask ID",
        blendMode: "normal",
        opacity: 1.0,
      },
      normal: {
        passType: "normal",
        enabled: false,
        resolutionMultiplier: 1,
        bitDepth: 16,
        channelName: "World Normal",
        blendMode: "normal",
        opacity: 1.0,
      },
      "material-id": {
        passType: "material-id",
        enabled: false,
        resolutionMultiplier: 1,
        bitDepth: 8,
        channelName: "Material Mask ID",
        blendMode: "normal",
        opacity: 1.0,
      },
      "rim-light": {
        passType: "rim-light",
        enabled: true,
        resolutionMultiplier: 1,
        bitDepth: 8,
        channelName: "Anime Rim Light",
        blendMode: "screen",
        opacity: 0.75,
      },
    },
  };
}

export function createMangaMonochromeProfile(): Studio3DToonPipelineProfile {
  const profile = createDefaultToonPipelineProfile("toon-manga-mono", "흑백 출판 만화 잉크 & 톤", "final");
  profile.outlineThickness = 2.0;
  profile.shadowBands = 1;
  profile.passes.screentone.enabled = true;
  profile.passes.beauty.enabled = false;
  profile.passes["rim-light"].enabled = false;
  return profile;
}

export function createCinematicActionProfile(): Studio3DToonPipelineProfile {
  const profile = createDefaultToonPipelineProfile("toon-action-noir", "시네마틱 액션 노아르", "final");
  profile.outlineThickness = 2.5;
  profile.shadowBands = 3;
  profile.rimLightIntensity = 1.2;
  profile.passes["rim-light"].enabled = true;
  profile.passes.normal.enabled = true;
  return profile;
}

export class Studio3DToonPassPipeline {
  private profile: Studio3DToonPipelineProfile;

  constructor(profile = createDefaultToonPipelineProfile()) {
    this.profile = profile;
  }

  public getProfile(): Studio3DToonPipelineProfile {
    return this.profile;
  }

  public setQuality(quality: ToonRenderQualityPreset): void {
    this.profile.quality = quality;
    const mult = quality === "final" ? 2 : 1;
    this.profile.passes.beauty.resolutionMultiplier = mult;
    this.profile.passes["line-art"].resolutionMultiplier = mult;
    this.profile.passes.screentone.resolutionMultiplier = mult;
  }

  public setOutlineThickness(thickness: number): void {
    this.profile.outlineThickness = Math.max(0.1, Math.min(10, thickness));
  }

  public setShadowBands(bands: number): void {
    this.profile.shadowBands = Math.max(1, Math.min(5, Math.round(bands)));
  }

  public setRimLightIntensity(intensity: number): void {
    this.profile.rimLightIntensity = Math.max(0, Math.min(3, intensity));
  }

  public togglePass(passType: ToonPassType, enabled?: boolean): void {
    if (this.profile.passes[passType]) {
      this.profile.passes[passType].enabled = enabled ?? !this.profile.passes[passType].enabled;
    }
  }

  public setPassOpacity(passType: ToonPassType, opacity: number): void {
    if (this.profile.passes[passType]) {
      this.profile.passes[passType].opacity = Math.max(0, Math.min(1, opacity));
    }
  }

  public getActivePassTypes(): ToonPassType[] {
    return (Object.keys(this.profile.passes) as ToonPassType[]).filter(
      (key) => this.profile.passes[key].enabled,
    );
  }

  public generatePsdLayerManifest(): Array<{
    name: string;
    type: ToonPassType;
    bitDepth: number;
    blendMode: LayerBlendMode;
    opacity: number;
  }> {
    return this.getActivePassTypes().map((passType) => {
      const cfg = this.profile.passes[passType];
      return {
        name: cfg.channelName,
        type: passType,
        bitDepth: cfg.bitDepth,
        blendMode: cfg.blendMode,
        opacity: cfg.opacity,
      };
    });
  }
}
