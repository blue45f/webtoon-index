/**
 * Character Shaper — Blender 캐릭터 패키지 entry point.
 *
 * ToonStudio already ships a Blender authoring pipeline (`tools/blender/toonstudio_blender_kit`)
 * that emits a `character-package.json` next to the runtime asset it built. Nothing in the browser
 * runs Blender: this block only *reads* a finished package, verifies it with the repository's own
 * parser, and hands the selected runtime file to the host's normal model-install path.
 *
 * Fail-closed by construction — an invalid manifest, a failed quality gate or a file whose byte
 * length does not match the manifest never reaches the loader, and the message shown is the
 * parser's own reason rather than a rewritten one.
 */

import { FileJson, Loader2 } from "lucide-react";
import { useId, useRef, useState } from "react";

import { STUDIO_FOCUS_RING } from "../studio-panel-ui";
import {
  parseStudioVrmBlenderCharacterPackage,
  selectStudioVrmBlenderRuntimeAsset,
} from "../vrm/studio-vrm-blender-character-package";

import type { StudioVrmBlenderRuntimeAsset } from "../vrm/studio-vrm-blender-character-package";
import type { StudioVrmPoserHost } from "../vrm/StudioVrmPoserHost";
import type { ChangeEvent } from "react";

import { cn } from "@/shared/lib/utils";

export const CHARACTER_SHAPER_BLENDER_DOC_PATH = "docs/studio/blender-character-pipeline.md";

export interface CharacterShaperBlenderPackageProps {
  readonly h: StudioVrmPoserHost;
  readonly disabled?: boolean;
}

type PackageState =
  | { readonly kind: "idle" }
  | { readonly kind: "reading" }
  | { readonly kind: "error"; readonly reason: string }
  | { readonly kind: "ready"; readonly name: string; readonly note: string };

const BUTTON = cn(
  "inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-card px-3 text-[0.75rem] font-semibold text-fg-2",
  "transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
  STUDIO_FOCUS_RING,
);

function baseName(path: string): string {
  const parts = path.split(/[\\/]/u);
  return parts[parts.length - 1] ?? path;
}

function reasonOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "패키지를 읽지 못했습니다.";
}

async function readText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

/** Hex SHA-256, or `null` when the browser exposes no WebCrypto digest (insecure context). */
async function digestOf(file: File): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof file.arrayBuffer !== "function") return null;
  try {
    const hash = await subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

export function CharacterShaperBlenderPackage({ h, disabled = false }: CharacterShaperBlenderPackageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const statusId = useId();
  const [state, setState] = useState<PackageState>({ kind: "idle" });

  const installPackage = async (files: readonly File[]) => {
    const manifestFile = files.find((file) => file.name.toLowerCase().endsWith(".json"));
    if (!manifestFile) {
      setState({ kind: "error", reason: "character-package.json 을 함께 선택해 주세요." });
      return;
    }

    let asset: StudioVrmBlenderRuntimeAsset;
    let displayName: string;
    try {
      const parsed = parseStudioVrmBlenderCharacterPackage(JSON.parse(await readText(manifestFile)));
      asset = selectStudioVrmBlenderRuntimeAsset(parsed);
      displayName = parsed.displayName;
    } catch (error: unknown) {
      // The parser's own reason, verbatim: it names the field that failed.
      setState({ kind: "error", reason: reasonOf(error) });
      return;
    }

    const wanted = baseName(asset.file.path).toLowerCase();
    const runtimeFile = files.find((file) => file.name.toLowerCase() === wanted);
    if (!runtimeFile) {
      setState({ kind: "error", reason: `패키지가 가리키는 ${baseName(asset.file.path)} 파일을 함께 선택해 주세요.` });
      return;
    }
    if (runtimeFile.size !== asset.file.bytes) {
      setState({
        kind: "error",
        reason: `${runtimeFile.name} 크기가 패키지 기록과 다릅니다 (${runtimeFile.size} ≠ ${asset.file.bytes}바이트).`,
      });
      return;
    }

    const digest = await digestOf(runtimeFile);
    if (digest !== null && digest !== asset.file.sha256) {
      setState({ kind: "error", reason: `${runtimeFile.name} 의 SHA-256 이 패키지 기록과 다릅니다.` });
      return;
    }

    const installModel = h.handleGeneratedVrmFile;
    if (typeof installModel !== "function") {
      setState({ kind: "error", reason: "이 화면에서는 모델을 설치할 수 없습니다." });
      return;
    }
    await installModel(runtimeFile);

    const notes: string[] = [];
    if (asset.role === "glb") notes.push("VRM 대신 GLB를 불러왔습니다. VRM 확장이 없으면 포즈·표정은 제한됩니다.");
    if (digest === null) notes.push("이 브라우저에서는 SHA-256을 확인하지 못해 파일 크기만 대조했습니다.");
    setState({ kind: "ready", name: displayName, note: notes.join(" ") });
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    if (files.length === 0) return;
    setState({ kind: "reading" });
    void installPackage(files).catch((error: unknown) => setState({ kind: "error", reason: reasonOf(error) }));
  };

  const busy = state.kind === "reading";

  return (
    <section aria-label="Blender 캐릭터 패키지" className="space-y-2">
      <p className="text-[0.7rem] leading-relaxed text-fg-3">
        Blender 파이프라인이 만든 <code className="rounded bg-raised px-1 text-fg-2">character-package.json</code> 과 같은
        폴더의 <code className="rounded bg-raised px-1 text-fg-2">.vrm</code> 파일을 함께 고르면 이 셰이퍼에 바로 불러옵니다.
        만드는 방법은 저장소 문서 <code className="rounded bg-raised px-1 text-fg-2">{CHARACTER_SHAPER_BLENDER_DOC_PATH}</code>
        에 있습니다. 브라우저에서 Blender를 실행하지는 않습니다.
      </p>
      <button
        type="button"
        disabled={disabled || busy}
        aria-describedby={statusId}
        onClick={() => inputRef.current?.click()}
        className={BUTTON}
      >
        {busy ? <Loader2 size={14} aria-hidden className="animate-spin motion-reduce:animate-none" /> : <FileJson size={14} aria-hidden />}
        Blender 캐릭터 패키지 불러오기
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".json,.vrm,.glb,application/json"
        aria-label="Blender 캐릭터 패키지 파일 선택"
        className="sr-only"
        tabIndex={-1}
        onChange={onChange}
      />
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className={cn(
          "text-[0.68rem] leading-relaxed",
          state.kind === "error" ? "text-bad" : state.kind === "ready" ? "text-good" : "text-fg-3",
        )}
      >
        {state.kind === "error"
          ? `불러오지 못했습니다 — ${state.reason}`
          : state.kind === "reading"
            ? "패키지를 확인하는 중입니다."
            : state.kind === "ready"
              ? `${state.name} 을(를) 불러왔습니다.${state.note ? ` ${state.note}` : ""}`
              : "아직 불러온 패키지가 없습니다."}
      </p>
    </section>
  );
}
