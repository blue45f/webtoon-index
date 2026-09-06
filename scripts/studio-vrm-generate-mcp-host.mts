#!/usr/bin/env tsx
/**
 * toonspectrum-vrm-generate MCP/CLI host.
 * Emits a real VRM from a Studio generation recipe. Does not talk to Blender.
 *
 *   pnpm exec tsx scripts/studio-vrm-generate-mcp-host.mts generate --preset natural-short --out ./out.vrm
 *   pnpm exec tsx scripts/studio-vrm-generate-mcp-host.mts probe-blender
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { probeBlenderVrmGenerateMcp } from "../apps/web/src/domains/creator/vrm/studio-vrm-generate-blender-mcp";
import {
  generateStudioVrmCharacter,
  resolveStudioVrmGenerateMcpHost,
} from "../apps/web/src/domains/creator/vrm/studio-vrm-generate-mcp";

function readFlag(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";
  if (command === "probe-blender") {
    const probe = probeBlenderVrmGenerateMcp();
    process.stdout.write(`${JSON.stringify(probe, null, 2)}\n`);
    process.exitCode = probe.available ? 0 : 2;
    return;
  }
  if (command === "generate") {
    const presetId = readFlag(args, "--preset") ?? "natural-short";
    const out = readFlag(args, "--out");
    const result = await generateStudioVrmCharacter(
      { presetId },
      { host: resolveStudioVrmGenerateMcpHost() },
    );
    if (result.status !== "ok") {
      process.stderr.write(`${result.message}\n`);
      process.exitCode = 3;
      return;
    }
    if (out) {
      writeFileSync(resolve(out), result.bytes);
    } else {
      process.stdout.write(Buffer.from(result.bytes));
    }
    return;
  }
  process.stderr.write(
    "Usage:\n  studio-vrm-generate-mcp-host.mts generate --preset <id> [--out file.vrm]\n  studio-vrm-generate-mcp-host.mts probe-blender\n",
  );
  process.exitCode = 1;
}

await main();
