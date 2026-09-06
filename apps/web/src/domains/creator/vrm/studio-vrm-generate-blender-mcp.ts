import { spawnSync } from "node:child_process";

import { createUnavailableStudioVrmGenerateMcpHost, type StudioVrmGenerateMcpHost } from "./studio-vrm-generate-mcp";

export type StudioVrmGenerateBlenderProbe = {
  readonly blenderCommand: string | null;
  readonly mcpCommand: string | null;
  readonly available: boolean;
  readonly reason: string;
};

function firstExistingCommand(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const probe = spawnSync(trimmed, ["--version"], { encoding: "utf8", timeout: 4_000 });
    if (probe.error) continue;
    if (probe.status === 0 || typeof probe.stdout === "string") return trimmed;
  }
  return null;
}

/** Honest Blender / blender-mcp probe. Never fabricates VRM bytes. */
export function probeBlenderVrmGenerateMcp(
  env: NodeJS.ProcessEnv = process.env,
): StudioVrmGenerateBlenderProbe {
  const blenderCommand = firstExistingCommand([
    env.BLENDER_PATH ?? "",
    env.BLENDER_BIN ?? "",
    "blender",
  ]);
  const mcpCommand = firstExistingCommand([
    env.STUDIO_MCP_BRIDGE_COMMAND ?? "",
    env.STUDIO_MCP_BRIDGE_PATH ?? "",
    "blender-mcp",
  ]);
  if (!blenderCommand) {
    return {
      blenderCommand: null,
      mcpCommand,
      available: false,
      reason: "Blender 실행 파일을 찾지 못했습니다.",
    };
  }
  if (!mcpCommand) {
    return {
      blenderCommand,
      mcpCommand: null,
      available: false,
      reason: "blender-mcp 브릿지를 찾지 못했습니다.",
    };
  }
  return {
    blenderCommand,
    mcpCommand,
    available: false,
    reason:
      "blender-mcp는 Blender 씬 제어만 하고 프리셋에서 VRM 바이트를 만들지 않습니다. toonspectrum-vrm-generate 호스트를 사용하세요.",
  };
}

export function createBlenderStudioVrmGenerateMcpHost(
  env: NodeJS.ProcessEnv = process.env,
): StudioVrmGenerateMcpHost {
  const probe = probeBlenderVrmGenerateMcp(env);
  const host = createUnavailableStudioVrmGenerateMcpHost("blender-mcp");
  return {
    ...host,
    async isAvailable() {
      return probe.available;
    },
    async generate() {
      throw new Error(probe.reason);
    },
  };
}
