import {
  inspectGeneratedVrmHumanoid,
  reloadGeneratedVrmAsHumanoid,
} from "./studio-vrm-generate-inspect";
import {
  createStudioVrmGenerateRecipe,
  exportStudioVrmFromGenerateRecipe,
  type StudioVrmGenerateRecipe,
} from "./studio-vrm-generate-recipe";

export const STUDIO_VRM_GENERATE_UNAVAILABLE_CODE = "vrm_generate_mcp_unavailable" as const;

export type StudioVrmGenerateMcpHost = {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  generate(recipe: StudioVrmGenerateRecipe): Promise<Uint8Array<ArrayBuffer>>;
};

export type StudioVrmGenerateSuccess = {
  readonly status: "ok";
  readonly recipe: StudioVrmGenerateRecipe;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly hostId: string;
  readonly vrmVersion: 0 | 1;
  readonly isCompleteHumanoid: boolean;
};

export type StudioVrmGenerateUnavailable = {
  readonly status: "unavailable";
  readonly code: typeof STUDIO_VRM_GENERATE_UNAVAILABLE_CODE;
  readonly message: string;
  readonly hostId: string | null;
};

export type StudioVrmGenerateResult = StudioVrmGenerateSuccess | StudioVrmGenerateUnavailable;

export const STUDIO_VRM_GENERATE_UNAVAILABLE_MESSAGE =
  "VRM 생성 MCP 호스트를 사용할 수 없습니다. Blender MCP 또는 스튜디오 생성 호스트를 연결해 주세요.";

/** In-process generate MCP. Emits real VRM bytes through the shipped exporter. */
export function createLocalStudioVrmGenerateMcpHost(): StudioVrmGenerateMcpHost {
  return {
    id: "toonspectrum-vrm-generate",
    async isAvailable() {
      return true;
    },
    async generate(recipe) {
      return exportStudioVrmFromGenerateRecipe(recipe);
    },
  };
}

export function createUnavailableStudioVrmGenerateMcpHost(
  id = "missing-vrm-generate-mcp",
): StudioVrmGenerateMcpHost {
  return {
    id,
    async isAvailable() {
      return false;
    },
    async generate() {
      throw new Error(STUDIO_VRM_GENERATE_UNAVAILABLE_MESSAGE);
    },
  };
}

export function resolveStudioVrmGenerateMcpHost(
  source: Partial<Record<string, string | undefined>> = typeof process === "undefined" ? {} : process.env,
): StudioVrmGenerateMcpHost {
  const requested = source.STUDIO_VRM_GENERATE_MCP?.trim().toLowerCase();
  if (requested === "none" || requested === "off" || requested === "blender") {
    // Blender MCP cannot emit a preset VRM; requesting it without a live host fails closed.
    return createUnavailableStudioVrmGenerateMcpHost(
      requested === "blender" ? "blender-mcp" : "disabled-vrm-generate-mcp",
    );
  }
  return createLocalStudioVrmGenerateMcpHost();
}

export async function generateStudioVrmCharacter(
  input: {
    readonly presetId?: string | null;
    readonly state?: unknown;
    readonly allowDefaultPreset?: boolean;
  } = {},
  dependencies: {
    readonly host?: StudioVrmGenerateMcpHost;
  } = {},
): Promise<StudioVrmGenerateResult> {
  const recipe = createStudioVrmGenerateRecipe(input);
  const host = dependencies.host ?? resolveStudioVrmGenerateMcpHost();
  try {
    if (!(await host.isAvailable())) {
      return {
        status: "unavailable",
        code: STUDIO_VRM_GENERATE_UNAVAILABLE_CODE,
        message: STUDIO_VRM_GENERATE_UNAVAILABLE_MESSAGE,
        hostId: host.id,
      };
    }
    const bytes = await host.generate(recipe);
    const inspection = inspectGeneratedVrmHumanoid(bytes);
    if (!inspection.isCompleteHumanoid) {
      return {
        status: "unavailable",
        code: STUDIO_VRM_GENERATE_UNAVAILABLE_CODE,
        message: "생성 MCP가 휴머노이드 VRM을 반환하지 않았습니다.",
        hostId: host.id,
      };
    }
    return {
      status: "ok",
      recipe,
      bytes,
      hostId: host.id,
      vrmVersion: inspection.vrmVersion,
      isCompleteHumanoid: inspection.isCompleteHumanoid,
    };
  } catch {
    return {
      status: "unavailable",
      code: STUDIO_VRM_GENERATE_UNAVAILABLE_CODE,
      message: STUDIO_VRM_GENERATE_UNAVAILABLE_MESSAGE,
      hostId: host.id,
    };
  }
}

export { reloadGeneratedVrmAsHumanoid };
