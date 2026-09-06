/**
 * Character Shaper — the precision inspector for the active slot.
 *
 * Header: the hovered-or-selected card enlarged, its intent, the availability badge and the
 * plan's own reason (`binding.plan(entry).availability.reason`) so a partial or unavailable
 * entry explains itself before anything is committed. Body: only the controls this slot actually
 * has on this model — a morph the VRM does not carry says so instead of drawing a dead slider.
 * Footer: a plain-language capability note for the whole model.
 *
 * Face, morph and hair edits go through the binding (one history step each); body proportions,
 * wardrobe, costume, props, expression, pose and hands write to the poser host directly, which
 * already owns their undo.
 */
import { Check, ChevronRight, Eye, EyeOff, Info, RotateCcw, Trash2, TriangleAlert, X } from "lucide-react";
import { useId } from "react";

import { STUDIO_FOCUS_RING } from "../studio-panel-ui";
import {
  AVATAR_FORGE_BANG_STYLE_OPTIONS,
  AVATAR_FORGE_BODY_PRESETS,
  AVATAR_FORGE_FACE_LIMITS,
  AVATAR_FORGE_HAIR_LIMITS,
  DEFAULT_AVATAR_FORGE_STATE,
  applyAvatarForgeBodyPreset,
} from "../vrm/studio-vrm-avatar-forge";
import { COSTUME_PALETTES, COSTUME_SLOT_LABELS } from "../vrm/studio-vrm-costume";
import {
  STUDIO_VRM_FINGER_LABELS,
  STUDIO_VRM_FINGER_NAMES,
  readStudioVrmFingerCurlDegrees,
} from "../vrm/studio-vrm-finger-curl";
import {
  STUDIO_VRM_PROPORTION_KEYS,
  STUDIO_VRM_PROPORTION_LIMITS,
  createStudioVrmProportions,
} from "../vrm/studio-vrm-proportion-core";
import { propDefById } from "../vrm/studio-vrm-props";
import { WARDROBE_FIT_MAX, WARDROBE_FIT_MIN, WARDROBE_SLOT_LABELS } from "../vrm/studio-vrm-wardrobe";

import { CHARACTER_SEMANTIC_MORPH_LABELS } from "./character-shaper-capability";
import { CHARACTER_HAIR_PALETTES, characterSlotMeta } from "./character-shaper-catalog";
import { CharacterSlotPreview } from "./character-shaper-preview";
import {
  CHARACTER_HAND_SIDE_OPTIONS,
  characterSlotSelection,
  describeAvailabilityBadge,
} from "./character-shaper-ui-model";
import { CharacterShaperBlenderPackage } from "./CharacterShaperBlenderPackage";
import { CharacterChipGroup, CharacterColorControl, CharacterRangeControl } from "./CharacterShaperControls";

import type { CharacterSlotEntry, CharacterSlotKind } from "./character-shaper-contract";
import type { CharacterShaperInspectorProps } from "./character-shaper-ui-contract";
import type {
  AvatarForgeFaceParams,
  AvatarForgeHairLimitKey,
  AvatarForgeSemanticFaceMorphId,
  AvatarForgeState,
} from "../vrm/studio-vrm-avatar-forge";
import type { CostumeSlot } from "../vrm/studio-vrm-costume";
import type { StudioVrmCostumeMeshEntry } from "../vrm/studio-vrm-costume-runtime";
import type { ExpressionAction } from "../vrm/studio-vrm-poser-catalogs";
import type { StudioVrmProportionKey, StudioVrmProportions } from "../vrm/studio-vrm-proportion-core";
import type { PropInstance } from "../vrm/studio-vrm-props";
import type { WardrobeEquip, WardrobeSlot } from "../vrm/studio-vrm-wardrobe";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

/* -------------------------------------------------------------------------- */
/* Slot tables                                                                 */
/* -------------------------------------------------------------------------- */

const FACE_KEYS: readonly (keyof AvatarForgeFaceParams)[] = [
  "headWidth",
  "headHeight",
  "headDepth",
  "cheekVolume",
  "chinLength",
];

const MORPH_IDS_BY_SLOT: Partial<Record<CharacterSlotKind, readonly AvatarForgeSemanticFaceMorphId[]>> = {
  eyes: ["eyeSize", "eyeSpacing", "eyeTilt"],
  nose: ["noseHeight", "noseWidth"],
  mouth: ["mouthWidth", "lipFullness"],
  ears: ["earSize"],
  irises: ["irisSize"],
};

const HAIR_KEYS: readonly AvatarForgeHairLimitKey[] = ["length", "volume", "curl", "shine", "wave"];

const WARDROBE_SLOTS_BY_SLOT: Partial<Record<CharacterSlotKind, readonly WardrobeSlot[]>> = {
  top: ["top", "outer"],
  bottom: ["bottom"],
  shoes: ["shoes"],
};

const COSTUME_SLOTS_BY_SLOT: Partial<Record<CharacterSlotKind, readonly CostumeSlot[]>> = {
  top: ["tops", "outer", "onepiece"],
  bottom: ["bottoms"],
  shoes: ["shoes"],
};

const MORPH_HINTS: Readonly<Record<AvatarForgeSemanticFaceMorphId, string>> = {
  eyeSize: "왼쪽은 작게, 오른쪽은 크게",
  eyeSpacing: "왼쪽은 모으고, 오른쪽은 벌립니다",
  eyeTilt: "왼쪽은 처진 눈, 오른쪽은 올라간 눈",
  irisSize: "홍채가 차지하는 비율",
  noseHeight: "콧대 높이",
  noseWidth: "콧볼 너비",
  mouthWidth: "입 좌우 폭",
  lipFullness: "입술 두께",
  earSize: "귀 크기",
};

const UNSUPPORTED_MORPH_TEXT = "이 모델은 지원하지 않습니다";

const SWATCH_TONE = "grid size-11 place-items-center rounded-lg border border-line hover:border-line-strong";

/* -------------------------------------------------------------------------- */
/* Small presentational helpers                                                */
/* -------------------------------------------------------------------------- */

function Section({
  title,
  hint,
  collapsible = false,
  defaultOpen = true,
  children,
}: {
  readonly title: string;
  readonly hint?: string;
  /** 자주 쓰지 않는 정밀 조절은 접어 둔다 — 인스펙터는 프리셋이 먼저 보여야 한다. */
  readonly collapsible?: boolean;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}) {
  const body = (
    <>
      {hint ? <p className="mt-0.5 text-[0.66rem] leading-relaxed text-fg-3">{hint}</p> : null}
      <div className="mt-2 space-y-2">{children}</div>
    </>
  );
  if (collapsible) {
    return (
      <details
        className="group border-t border-line/60 px-3 py-3 first:border-t-0"
        data-character-inspector-section={title}
        open={defaultOpen}
      >
        <summary
          className={cn(
            "flex cursor-pointer list-none items-center gap-1.5 text-[0.78rem] font-bold text-fg",
            STUDIO_FOCUS_RING,
          )}
        >
          <ChevronRight
            size={13}
            aria-hidden
            className="shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          />
          {title}
        </summary>
        {body}
      </details>
    );
  }
  return (
    <section className="border-t border-line/60 px-3 py-3 first:border-t-0" data-character-inspector-section={title}>
      <h3 className="text-[0.78rem] font-bold text-fg">{title}</h3>
      {body}
    </section>
  );
}

function Note({ tone = "muted", children }: { readonly tone?: "muted" | "warn"; readonly children: ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-[0.66rem] leading-relaxed",
        tone === "warn" ? "border-warn/45 bg-warn/10 text-warn" : "border-dashed border-line bg-card/50 text-fg-3",
      )}
    >
      {tone === "warn" ? (
        <TriangleAlert size={13} aria-hidden className="mt-0.5 shrink-0" />
      ) : (
        <Info size={13} aria-hidden className="mt-0.5 shrink-0" />
      )}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

const ROW_BUTTON = cn(
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-line bg-card px-3 text-[0.7rem] font-semibold text-fg-2",
  "transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
  STUDIO_FOCUS_RING,
);

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onToggle,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left",
        "transition-colors disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
        STUDIO_FOCUS_RING,
        checked ? "border-accent/55 bg-accent-soft" : "border-line bg-card hover:bg-raised",
      )}
    >
      <span className="min-w-0">
        <span className={cn("block text-[0.72rem] font-bold", checked ? "text-accent" : "text-fg-2")}>{label}</span>
        {hint ? <span className="mt-0.5 block text-[0.62rem] leading-relaxed text-fg-3">{hint}</span> : null}
      </span>
      <span
        aria-hidden
        className={cn(
          "grid h-6 w-10 shrink-0 grid-cols-2 items-center rounded-full border px-0.5",
          checked ? "border-accent bg-accent" : "border-line bg-raised",
        )}
      >
        <span
          className={cn(
            "size-5 rounded-full transition-transform motion-reduce:transition-none",
            checked ? "translate-x-4 bg-on-accent" : "bg-fg-3",
          )}
        />
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Inspector                                                                   */
/* -------------------------------------------------------------------------- */

export function CharacterShaperInspector({ h, binding, slot, hoveredEntryId, onClose }: CharacterShaperInspectorProps) {
  const headingId = useId();
  const meta = binding.catalog.slots.find((item) => item.id === slot) ?? characterSlotMeta(slot);
  const slotEntries = binding.catalog.entries.filter((entry) => entry.slot === slot);
  const selection = characterSlotSelection(binding.recipe, slot);
  const selectedEntry = slotEntries.find((entry) => entry.id === selection[selection.length - 1]) ?? null;
  const hovered = hoveredEntryId ? slotEntries.find((entry) => entry.id === hoveredEntryId) ?? null : null;
  const focus: CharacterSlotEntry | null = hovered ?? selectedEntry;
  const plan = focus ? binding.plan(focus) : null;
  const availability = plan?.availability ?? (focus ? binding.evaluate(focus) : null);
  const badge = availability ? describeAvailabilityBadge(availability) : null;
  const reason = availability?.reason ?? null;

  const busyReason = binding.busyReason;
  const modelReady = h.status === "ready";
  const locked = busyReason !== null || !modelReady;
  const forgeState = (h.avatarForgeState ?? null) as AvatarForgeState | null;
  const proportionStatus: string = typeof h.proportionRigStatus === "string" ? h.proportionRigStatus : "idle";
  const proportionBusy = proportionStatus === "applying" || proportionStatus === "reload-required";
  const proportionMessage: string = typeof h.proportionRigMessage === "string" ? h.proportionRigMessage : "";

  const face = binding.snapshot.forgeFace ?? DEFAULT_AVATAR_FORGE_STATE.face;
  const morphs = binding.snapshot.semanticMorphs ?? {};

  const commitForge = (next: AvatarForgeState) => {
    h.handleAvatarForgeChange(next);
  };

  /* ---------------------------------------------------------------------- */
  /* Per-slot sections                                                       */
  /* ---------------------------------------------------------------------- */

  const renderFaceShape = () => (
    <Section title="얼굴 비율" hint="두상·볼·턱을 직접 조절합니다. 카드 프리셋 위에 그대로 얹힙니다.">
      {FACE_KEYS.map((key) => {
        const limit = AVATAR_FORGE_FACE_LIMITS[key];
        return (
          <CharacterRangeControl
            key={key}
            label={limit.label}
            value={face[key]}
            min={limit.min}
            max={limit.max}
            step={limit.step}
            unit={limit.unit}
            defaultValue={DEFAULT_AVATAR_FORGE_STATE.face[key]}
            disabled={locked}
            onCommit={(value) => binding.commitFaceParams({ [key]: value }, `얼굴형: ${limit.label}`)}
          />
        );
      })}
    </Section>
  );

  const renderMorphs = (ids: readonly AvatarForgeSemanticFaceMorphId[]) => (
    <Section
      title={`${meta.label} 세부 조절`}
      hint="모델이 가진 셰이프키(또는 적응형 얼굴 메시)를 직접 씁니다. −1은 줄이기, +1은 키우기입니다."
    >
      {ids.map((id) => {
        const supported = binding.profile.semanticMorphs?.[id] != null;
        if (!supported) {
          return (
            <div key={id} className="rounded-xl border border-dashed border-line bg-card/50 px-2.5 py-2">
              <p className="text-[0.72rem] font-bold text-fg-3">{CHARACTER_SEMANTIC_MORPH_LABELS[id]}</p>
              <p className="mt-0.5 text-[0.64rem] leading-relaxed text-fg-3">{UNSUPPORTED_MORPH_TEXT}</p>
            </div>
          );
        }
        return (
          <CharacterRangeControl
            key={id}
            label={CHARACTER_SEMANTIC_MORPH_LABELS[id]}
            hint={MORPH_HINTS[id]}
            value={morphs[id] ?? 0}
            min={-1}
            max={1}
            step={0.01}
            defaultValue={0}
            disabled={locked}
            onCommit={(value) =>
              binding.commitSemanticMorphs({ [id]: value }, `${meta.label}: ${CHARACTER_SEMANTIC_MORPH_LABELS[id]}`)}
          />
        );
      })}
    </Section>
  );

  const renderIrisColor = () => {
    const swatches = slotEntries
      .filter((entry) => entry.apply.kind === "iris" && typeof entry.apply.color === "string")
      .map((entry) => ({ color: entry.apply.kind === "iris" ? entry.apply.color ?? "" : "", label: entry.label }))
      .filter((swatch, index, list) => swatch.color !== "" && list.findIndex((item) => item.color === swatch.color) === index)
      .slice(0, 8);
    return (
      <Section title="눈동자 색" hint="텍스처를 유지한 채 홍채 메시만 물들입니다. 비우면 모델 원본 색으로 돌아갑니다.">
        {binding.profile.irisTintable ? null : <Note tone="warn">이 모델에서는 홍채 메시를 찾지 못해 색을 바꿀 수 없습니다.</Note>}
        <CharacterColorControl
          label="눈동자 색"
          value={binding.recipe.colors.iris}
          swatches={swatches}
          allowClear
          disabled={locked || !binding.profile.irisTintable}
          onCommit={(color) => binding.commitColor("iris", color)}
        />
      </Section>
    );
  };

  const renderHair = () => {
    const hair = forgeState?.hair ?? DEFAULT_AVATAR_FORGE_STATE.hair;
    const baseColor = binding.snapshot.hairBaseColor ?? hair.baseColor;
    const tipColor = binding.snapshot.hairTipColor ?? hair.tipColor;
    const activePalette = CHARACTER_HAIR_PALETTES.find(
      (palette) =>
        palette.baseColor.toLowerCase() === String(baseColor).toLowerCase() &&
        palette.tipColor.toLowerCase() === String(tipColor).toLowerCase(),
    );
    const replaceOriginal = binding.snapshot.hairReplaceOriginal ?? hair.replaceOriginal;
    const originalHairCount = binding.profile.originalHairMeshCount ?? 0;
    return (
      <>
        <Section title="앞머리" hint="스타일과 따로 조합합니다.">
          <CharacterChipGroup
            label="앞머리 형태"
            value={binding.snapshot.hairBangStyle ?? hair.bangStyle}
            disabled={locked}
            columns={3}
            options={AVATAR_FORGE_BANG_STYLE_OPTIONS.map((option) => ({
              id: option.id,
              label: option.label,
              hint: option.hint,
            }))}
            onSelect={(id) => binding.commitHairParams({ bangStyle: id }, `헤어: 앞머리 ${id}`)}
          />
        </Section>
        <Section title="헤어 팔레트">
          <CharacterChipGroup
            label="헤어 팔레트"
            value={activePalette?.id ?? null}
            disabled={locked}
            columns={2}
            options={CHARACTER_HAIR_PALETTES.map((palette) => ({
              id: palette.id,
              label: palette.label,
              swatch: palette.baseColor,
            }))}
            onSelect={(id) => {
              const palette = CHARACTER_HAIR_PALETTES.find((item) => item.id === id);
              if (!palette) return;
              binding.commitHairParams(
                { baseColor: palette.baseColor, tipColor: palette.tipColor },
                `헤어: ${palette.label}`,
              );
            }}
          />
          <CharacterColorControl
            label="헤어 기본색"
            value={baseColor}
            disabled={locked}
            onCommit={(color) => {
              if (color === null) return;
              binding.commitHairParams({ baseColor: color }, "헤어: 기본색");
            }}
          />
          <CharacterColorControl
            label="모발 끝 색"
            value={tipColor}
            disabled={locked}
            onCommit={(color) => {
              if (color === null) return;
              binding.commitHairParams({ tipColor: color }, "헤어: 끝 색");
            }}
          />
        </Section>
        <Section title="헤어 형태">
          {HAIR_KEYS.map((key) => {
            const limit = AVATAR_FORGE_HAIR_LIMITS[key];
            const value = typeof hair[key] === "number" ? hair[key] : DEFAULT_AVATAR_FORGE_STATE.hair[key];
            return (
              <CharacterRangeControl
                key={key}
                label={limit.label}
                value={value}
                min={limit.min}
                max={limit.max}
                step={limit.step}
                unit={limit.unit}
                defaultValue={DEFAULT_AVATAR_FORGE_STATE.hair[key]}
                disabled={locked}
                onCommit={(next) => binding.commitHairParams({ [key]: next }, `헤어: ${limit.label}`)}
              />
            );
          })}
          <ToggleRow
            label="원본 헤어 감추기"
            hint={
              originalHairCount > 0
                ? `모델이 가진 헤어 메시 ${originalHairCount}개를 숨기고 절차형 헤어만 남깁니다.`
                : "이 모델에는 감출 원본 헤어 메시가 없습니다."
            }
            checked={Boolean(replaceOriginal)}
            disabled={locked || originalHairCount === 0}
            onToggle={() =>
              binding.commitHairParams(
                { replaceOriginal: !replaceOriginal },
                replaceOriginal ? "헤어: 원본 헤어 표시" : "헤어: 원본 헤어 감추기",
              )}
          />
        </Section>
      </>
    );
  };

  const renderBody = () => {
    const proportions: StudioVrmProportions =
      forgeState?.proportions ?? createStudioVrmProportions(binding.snapshot.proportionPresetId ?? undefined);
    const disabled = locked || proportionBusy;
    return (
      <>
        <Section title="실루엣 프리셋" hint="두신 비율은 그대로 두고 어깨·몸통·팔·다리만 바꿉니다.">
          <CharacterChipGroup
            label="실루엣 프리셋"
            value={binding.snapshot.bodyPresetId ?? forgeState?.bodyPresetId ?? null}
            disabled={disabled}
            columns={2}
            options={AVATAR_FORGE_BODY_PRESETS.map((preset) => ({
              id: preset.id,
              label: preset.label,
              hint: preset.hint,
            }))}
            onSelect={(id) => {
              const base = forgeState ?? null;
              if (!base) return;
              commitForge(applyAvatarForgeBodyPreset(base, id as (typeof AVATAR_FORGE_BODY_PRESETS)[number]["id"]));
            }}
          />
        </Section>
        <Section title="비율 정밀 조절" hint="관절 간격을 직접 옮깁니다. 두신 수는 머리 크기 배수로 정해집니다.">
          {proportionBusy ? <Note tone="warn">{proportionMessage || "체형 리그를 적용하는 중입니다."}</Note> : null}
          {STUDIO_VRM_PROPORTION_KEYS.map((key: StudioVrmProportionKey) => {
            const limit = STUDIO_VRM_PROPORTION_LIMITS[key];
            return (
              <CharacterRangeControl
                key={key}
                label={limit.label}
                hint={limit.hint}
                value={proportions[key]}
                min={limit.min}
                max={limit.max}
                step={limit.step}
                unit={limit.unit}
                defaultValue={1}
                disabled={disabled || !forgeState}
                onCommit={(value) => {
                  if (!forgeState) return;
                  commitForge({
                    ...forgeState,
                    presetId: undefined,
                    proportions: { ...proportions, presetId: undefined, [key]: value },
                  });
                }}
              />
            );
          })}
        </Section>
        <Section title="정밀 제작" hint="Blender 파이프라인으로 만든 캐릭터 패키지를 이 셰이퍼로 가져옵니다.">
          <CharacterShaperBlenderPackage h={h} disabled={locked} />
        </Section>
      </>
    );
  };

  const renderGarment = () => {
    const wardrobeSlots = WARDROBE_SLOTS_BY_SLOT[slot] ?? [];
    const costumeSlots = COSTUME_SLOTS_BY_SLOT[slot] ?? [];
    const wardrobeState = (h.wardrobeState ?? {}) as Partial<Record<WardrobeSlot, WardrobeEquip>>;
    const costumeMeshes: readonly StudioVrmCostumeMeshEntry[] = Array.isArray(h.costumeMeshes) ? h.costumeMeshes : [];
    const hiddenKeys: readonly string[] = Array.isArray(h.costumeState?.hidden) ? h.costumeState.hidden : [];
    const equipped = wardrobeSlots
      .map((wardrobeSlot) => ({ wardrobeSlot, equip: wardrobeState[wardrobeSlot] ?? null }))
      .filter((row): row is { wardrobeSlot: WardrobeSlot; equip: WardrobeEquip } => row.equip !== null);
    const meshes = costumeMeshes.filter((entry) => costumeSlots.includes(entry.slot));
    const presentCostumeSlots = costumeSlots.filter((costumeSlot) =>
      meshes.some((entry) => entry.slot === costumeSlot),
    );
    return (
      <>
        <Section title="입힌 옷" hint="셰이퍼가 입힌 옷의 색과 품을 조절합니다.">
          {equipped.length === 0 ? (
            <Note>아직 이 슬롯에 입힌 옷이 없습니다. 왼쪽 카드에서 하나 골라 보세요.</Note>
          ) : (
            equipped.map(({ wardrobeSlot, equip }) => (
              <div key={wardrobeSlot} className="space-y-2">
                <p className="text-[0.66rem] font-bold text-fg-3">{WARDROBE_SLOT_LABELS[wardrobeSlot]}</p>
                <CharacterColorControl
                  label={`${WARDROBE_SLOT_LABELS[wardrobeSlot]} 색`}
                  value={equip.color ?? null}
                  disabled={locked}
                  onCommit={(color) => {
                    if (color === null) return;
                    h.updateWardrobeEquip(wardrobeSlot, { color });
                  }}
                />
                {typeof equip.fit === "number" ? (
                  <CharacterRangeControl
                    label={`${WARDROBE_SLOT_LABELS[wardrobeSlot]} 품`}
                    hint="몸에 붙게(작게) 또는 헐렁하게(크게)"
                    value={equip.fit}
                    min={WARDROBE_FIT_MIN}
                    max={WARDROBE_FIT_MAX}
                    step={0.01}
                    unit="×"
                    defaultValue={1}
                    disabled={locked}
                    onCommit={(fit) => h.updateWardrobeEquip(wardrobeSlot, { fit })}
                  />
                ) : null}
              </div>
            ))
          )}
        </Section>
        <Section title="모델 원본 의상" hint="모델이 원래 입고 있던 메시를 켜고 끄거나 색을 덮습니다.">
          {meshes.length === 0 ? (
            <Note>이 모델에는 이 부위로 분류된 원본 의상 메시가 없습니다.</Note>
          ) : (
            <>
              {presentCostumeSlots.map((costumeSlot) => (
                <div key={costumeSlot} role="group" aria-label={`${COSTUME_SLOT_LABELS[costumeSlot]} 색 덮기`} className="flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-[0.66rem] font-bold text-fg-3">{COSTUME_SLOT_LABELS[costumeSlot]}</span>
                  {COSTUME_PALETTES.slice(0, 6).map((palette) => (
                    <button
                      key={palette.id}
                      type="button"
                      disabled={locked}
                      aria-label={`${COSTUME_SLOT_LABELS[costumeSlot]} ${palette.label}으로 덮기`}
                      title={`${palette.label} ${palette.color.toUpperCase()}`}
                      onClick={() => h.recolorCostumeSlot(costumeSlot, palette.color)}
                      className={cn(SWATCH_TONE, STUDIO_FOCUS_RING, "disabled:cursor-not-allowed disabled:opacity-45")}
                    >
                      <span
                        aria-hidden
                        className="size-7 rounded-md border border-line/60"
                        style={{ backgroundColor: palette.color }}
                      />
                    </button>
                  ))}
                </div>
              ))}
              <ul className="space-y-1">
                {meshes.map((entry) => {
                  const hidden = hiddenKeys.includes(entry.key);
                  return (
                    <li key={entry.key}>
                      <button
                        type="button"
                        aria-pressed={!hidden}
                        disabled={locked}
                        title={hidden ? `${entry.label} 다시 표시` : `${entry.label} 숨기기`}
                        onClick={() => h.toggleCostumeMesh(entry.key)}
                        className={cn(
                          "flex w-full min-h-11 items-center gap-2 rounded-xl border px-2.5 text-left text-[0.7rem] font-semibold",
                          "transition-colors disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
                          STUDIO_FOCUS_RING,
                          hidden
                            ? "border-line bg-card text-fg-3"
                            : "border-accent/45 bg-accent-soft/60 text-accent",
                        )}
                      >
                        {hidden ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                        <span className="shrink-0 text-[0.62rem] font-bold">{hidden ? "숨김" : "표시"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Section>
      </>
    );
  };

  const renderAccessory = () => {
    const items: readonly PropInstance[] = Array.isArray(h.vrmPropItems) ? h.vrmPropItems : [];
    return (
      <Section title="장착한 액세서리" hint="여러 개를 함께 달 수 있습니다. 카드로 추가하고 여기서 다듬습니다.">
        {items.length === 0 ? (
          <Note>아직 장착한 액세서리가 없습니다.</Note>
        ) : (
          items.map((item) => {
            const label = propDefById(item.propId)?.label ?? item.propId;
            const scale = item.rig ? item.rig.deltaScale : item.scale;
            return (
              <div key={item.uid} className="space-y-2 rounded-xl border border-line/80 bg-card/70 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-[0.74rem] font-bold text-fg">{label}</p>
                  <button
                    type="button"
                    disabled={locked}
                    aria-label={`${label} 빼기`}
                    title={`${label} 빼기`}
                    onClick={() => h.removeVrmProp(item.uid)}
                    className={cn(
                      "grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-panel text-fg-3",
                      "transition-colors hover:border-bad/50 hover:text-bad disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
                      STUDIO_FOCUS_RING,
                    )}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
                {typeof scale === "number" ? (
                  <CharacterRangeControl
                    label={`${label} 크기`}
                    value={scale}
                    min={0.2}
                    max={4}
                    step={0.05}
                    unit="×"
                    defaultValue={propDefById(item.propId)?.defaultScale ?? 1}
                    disabled={locked}
                    onCommit={(value) =>
                      h.updateVrmProp(
                        item.uid,
                        item.rig ? { rig: { ...item.rig, deltaScale: value } } : { scale: value },
                      )}
                  />
                ) : null}
                {item.color !== null ? (
                  <CharacterColorControl
                    label={`${label} 색`}
                    value={item.color}
                    disabled={locked}
                    onCommit={(color) => {
                      if (color === null) return;
                      h.updateVrmProp(item.uid, { color });
                    }}
                  />
                ) : null}
              </div>
            );
          })
        )}
      </Section>
    );
  };

  const renderExpression = () => {
    const actions: readonly ExpressionAction[] = Array.isArray(h.availableExpressionActions)
      ? h.availableExpressionActions
      : [];
    const weights = (h.expressionWeights ?? {}) as Readonly<Record<string, number>>;
    const named = actions.filter((action) => typeof action.name === "string" && action.name.length > 0);
    const active = named.filter((action) => (weights[action.name as string] ?? 0) > 0);
    const shown = active.length > 0 ? active : named.slice(0, 6);
    return (
      <Section title="표정 세기" hint="지금 켜진 표정의 강도를 하나씩 조절합니다.">
        {shown.length === 0 ? (
          <Note>이 모델에는 조절할 수 있는 표정이 없습니다.</Note>
        ) : (
          shown.map((action) => {
            const name = action.name as string;
            return (
              <CharacterRangeControl
                key={action.id}
                label={action.label}
                hint={action.tone}
                value={weights[name] ?? 0}
                min={0}
                max={1}
                step={0.05}
                unit="%"
                defaultValue={0}
                disabled={locked}
                onPreview={(value) => h.updateExpressionWeight(name, value)}
                onCommit={(value) => h.updateExpressionWeight(name, value)}
              />
            );
          })
        )}
      </Section>
    );
  };

  const renderPose = () => {
    const bodyRotation = typeof h.bodyRotation === "number" ? h.bodyRotation : 0;
    const degrees = Math.round((bodyRotation * 180) / Math.PI);
    return (
      <Section title="포즈 다듬기" hint="좌우 반전, 초기화, 몸 방향, 그리고 현재 포즈 저장.">
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className={ROW_BUTTON} disabled={locked} onClick={() => h.handleMirrorPose("all")}>
            좌우 반전
          </button>
          <button type="button" className={ROW_BUTTON} disabled={locked} onClick={() => h.handleResetActivePose()}>
            <RotateCcw size={13} aria-hidden />
            포즈 초기화
          </button>
          <button type="button" className={ROW_BUTTON} disabled={locked} onClick={() => h.handleMirrorPose("arms")}>
            팔만 반전
          </button>
          <button type="button" className={ROW_BUTTON} disabled={locked} onClick={() => h.handleMirrorPose("legs")}>
            다리만 반전
          </button>
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-line/80 bg-card/70 p-2.5 text-[0.72rem] font-bold text-fg-2">
          <span className="w-16 shrink-0">몸 방향</span>
          <input
            type="range"
            min="-180"
            max="180"
            step="1"
            value={degrees}
            disabled={locked}
            aria-label="몸 방향"
            aria-valuetext={`${degrees}도`}
            className="h-11 min-w-0 flex-1 accent-accent disabled:cursor-not-allowed disabled:opacity-45"
            onChange={h.handleBodyRotationChange}
          />
          <span className="w-10 shrink-0 text-right tabular-nums text-fg-3">{degrees}°</span>
        </label>
        <button type="button" className={cn(ROW_BUTTON, "w-full")} disabled={locked} onClick={() => h.handleSavePose()}>
          <Check size={13} aria-hidden />
          현재 포즈 저장
        </button>
      </Section>
    );
  };

  const renderHandPose = () => {
    const fingerEdits = (h.fingerEdits ?? {}) as Record<string, readonly number[] | undefined>;
    const sides: readonly ("left" | "right")[] =
      binding.handSide === "both" ? ["left", "right"] : [binding.handSide];
    const sideLabel = (side: "left" | "right") => (side === "left" ? "왼손" : "오른손");
    return (
      <>
        <Section title="어느 손에 적용할지" hint="카드로 고른 손 모양이 이 선택을 따릅니다.">
          <CharacterChipGroup
            label="적용할 손"
            value={binding.handSide}
            disabled={locked}
            columns={3}
            options={CHARACTER_HAND_SIDE_OPTIONS.map((option) => ({ id: option.value, label: option.label }))}
            onSelect={(id) => binding.setHandSide(id as typeof binding.handSide)}
          />
        </Section>
        <Section
          title="손가락 말아쥐기"
          hint="다섯 손가락을 함께 굽히거나, 아래에서 손가락 하나씩 따로 굽힙니다."
        >
          {sides.map((side) => (
            <CharacterRangeControl
              key={side}
              label={`${sideLabel(side)} 전체 굽힘`}
              value={readStudioVrmFingerCurlDegrees(fingerEdits, side, "index")}
              min={0}
              max={60}
              step={1}
              unit="°"
              defaultValue={0}
              disabled={locked}
              onCommit={(value) => h.updateFingerCurl(side, value)}
            />
          ))}
        </Section>
        {sides.map((side) => (
          <Section
            key={`fingers-${side}`}
            title={`${sideLabel(side)} 손가락 하나씩`}
            hint="검지만 펴는 손짓처럼 손가락마다 각도가 달라야 하는 포즈를 만듭니다."
            collapsible
            defaultOpen={false}
          >
            {STUDIO_VRM_FINGER_NAMES.map((finger) => (
              <CharacterRangeControl
                key={finger}
                // 양손을 함께 보여 줄 때 두 슬라이더가 똑같이 "검지"라 불리면 스크린 리더에서
                // 어느 손인지 알 수 없다. 이름에 손을 넣어 각 컨트롤을 유일하게 만든다.
                label={`${sideLabel(side)} ${STUDIO_VRM_FINGER_LABELS[finger]}`}
                value={readStudioVrmFingerCurlDegrees(fingerEdits, side, finger)}
                min={0}
                max={60}
                step={1}
                unit="°"
                defaultValue={0}
                disabled={locked}
                onCommit={(value) => h.updateFingerCurl(side, value, finger)}
              />
            ))}
          </Section>
        ))}
      </>
    );
  };

  const renderSection = (): ReactNode => {
    const morphIds = MORPH_IDS_BY_SLOT[slot];
    switch (slot) {
      case "face-shape":
        return renderFaceShape();
      case "irises":
        return (
          <>
            {morphIds ? renderMorphs(morphIds) : null}
            {renderIrisColor()}
          </>
        );
      case "eyes":
      case "nose":
      case "mouth":
      case "ears":
        return morphIds ? renderMorphs(morphIds) : null;
      case "hair":
        return renderHair();
      case "body":
        return renderBody();
      case "top":
      case "bottom":
      case "shoes":
        return renderGarment();
      case "accessory":
        return renderAccessory();
      case "expression":
        return renderExpression();
      case "pose":
        return renderPose();
      case "hand-pose":
        return renderHandPose();
      default:
        return null;
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Capability note                                                         */
  /* ---------------------------------------------------------------------- */

  const profile = binding.profile;
  const morphIdList = Object.keys(CHARACTER_SEMANTIC_MORPH_LABELS) as AvatarForgeSemanticFaceMorphId[];
  const missingMorphs = morphIdList.filter((id) => profile.semanticMorphs?.[id] == null);
  const capabilityLines: readonly { readonly label: string; readonly value: string; readonly ok: boolean }[] = [
    {
      label: "얼굴 셰이프키",
      value:
        missingMorphs.length === 0
          ? `${morphIdList.length}개 모두 사용 가능`
          : `${morphIdList.length - missingMorphs.length}/${morphIdList.length}개 · 없음: ${missingMorphs
              .map((id) => CHARACTER_SEMANTIC_MORPH_LABELS[id])
              .join(", ")}`,
      ok: missingMorphs.length === 0,
    },
    {
      label: "표정",
      value: profile.expressions.length > 0 ? `${profile.expressions.length}개` : "없음",
      ok: profile.expressions.length > 0,
    },
    {
      label: "눈동자 틴트",
      value: profile.irisTintable ? "가능" : "홍채 메시를 찾지 못했습니다",
      ok: profile.irisTintable,
    },
    {
      label: "원본 헤어",
      value: profile.originalHairMeshCount > 0 ? `메시 ${profile.originalHairMeshCount}개` : "없음",
      ok: profile.originalHairMeshCount > 0,
    },
    {
      label: "옷 치수",
      value: profile.wardrobeMetricsReady ? "측정 완료" : "측정 중이거나 실패했습니다",
      ok: profile.wardrobeMetricsReady,
    },
    { label: "소품", value: profile.propsReady ? "부착 가능" : "본을 찾지 못했습니다", ok: profile.propsReady },
    {
      label: "표면 드로잉",
      value: profile.surfacePaintReady ? "사용 가능" : "이 모델에서는 아직 사용할 수 없습니다",
      ok: profile.surfacePaintReady,
    },
  ];

  return (
    <div
      data-character-shaper-inspector-body={slot}
      className="flex min-h-0 flex-col bg-panel"
      aria-labelledby={headingId}
    >
      <header className="sticky top-0 z-10 shrink-0 border-b border-line bg-panel/95 px-3 py-3 backdrop-blur">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id={headingId} className="text-sm font-bold text-fg">
              {meta.label}
            </h2>
            <p className="mt-0.5 text-[0.66rem] leading-relaxed text-fg-3">{meta.hint}</p>
          </div>
          {onClose ? (
            <button
              type="button"
              aria-label="정밀 조절 닫기"
              onClick={onClose}
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-card text-fg-2",
                "transition-colors hover:bg-raised hover:text-fg motion-reduce:transition-none",
                STUDIO_FOCUS_RING,
              )}
            >
              <X size={16} aria-hidden />
            </button>
          ) : null}
        </div>
        {focus ? (
          <div className="mt-2.5 flex gap-2.5">
            <span className="shrink-0 overflow-hidden rounded-xl border border-line bg-canvas/70">
              <CharacterSlotPreview spec={focus.preview} size={96} selected={focus.id === selectedEntry?.id} title={focus.label} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.8rem] font-bold text-fg">{focus.label}</p>
              <p className="mt-0.5 line-clamp-2 text-[0.66rem] leading-relaxed text-fg-3">{focus.hint}</p>
              {badge ? (
                <p
                  className={cn(
                    "mt-1.5 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.62rem] font-semibold",
                    badge.tone === "good" && "border-good/40 bg-good/10 text-good",
                    badge.tone === "warn" && "border-warn/45 bg-warn/15 text-warn",
                    badge.tone === "bad" && "border-bad/45 bg-bad/15 text-bad",
                  )}
                >
                  {badge.label}
                </p>
              ) : null}
              {reason ? <p className="mt-1 text-[0.64rem] leading-relaxed text-warn">{reason}</p> : null}
            </div>
          </div>
        ) : (
          <p className="mt-2.5 rounded-xl border border-dashed border-line bg-card/50 px-2.5 py-3 text-[0.66rem] leading-relaxed text-fg-3">
            카드에 마우스를 올리거나 하나 선택하면 여기에서 크게 볼 수 있습니다.
          </p>
        )}
        {busyReason ? (
          <p role="status" className="mt-2 text-[0.64rem] font-semibold leading-relaxed text-warn">
            {busyReason}
          </p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 pb-3">
        {modelReady ? (
          renderSection()
        ) : (
          <div className="px-3 py-3">
            <Note>모델을 불러오면 이 슬롯의 정밀 조절이 열립니다.</Note>
          </div>
        )}

        <section className="border-t border-line/60 px-3 py-3" aria-label="이 모델에서 되는 것">
          <h3 className="text-[0.78rem] font-bold text-fg">이 모델에서 되는 것</h3>
          <dl className="mt-2 space-y-1">
            {capabilityLines.map((line) => (
              <div key={line.label} className="flex items-start justify-between gap-2 text-[0.66rem] leading-relaxed">
                <dt className="shrink-0 font-semibold text-fg-2">{line.label}</dt>
                <dd className={cn("min-w-0 text-right", line.ok ? "text-fg-3" : "text-warn")}>
                  {line.ok ? "" : "제한: "}
                  {line.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
