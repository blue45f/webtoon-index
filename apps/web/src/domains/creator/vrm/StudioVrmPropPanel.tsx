import {
  ChevronDown,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { StudioThreeDToggleControl } from "../StudioThreeDToggle";

import { isStudioVrmPropSelectable, studioVrmPropQualityNotice } from "./studio-vrm-prop-quality-policy";
import {
  inspectAutoGripReadiness,
  type AutoGripReadiness,
  type VrmPropRigMetrics,
} from "./studio-vrm-prop-rig";
import {
  PROP_ATTACH_BONES,
  PROP_BONE_LABELS,
  PROP_CATEGORY_LABELS,
  VRM_PROPS,
  VRM_PROP_GRIP_FIT_MAX,
  VRM_PROP_GRIP_FIT_MIN,
  VRM_PROPS_VERSION,
  propDefById,
  type PropAttachBone,
  type PropCategory,
  type PropDef,
  type PropGripKind,
  type PropHandBone,
  type PropInstance,
  type PropRigSecondary,
  type PropRigV2,
  type Vec3,
} from "./studio-vrm-props";


import { cn } from "@/shared/lib/utils";

const SELECTABLE_PROP_COUNT = VRM_PROPS.filter(({ id }) => isStudioVrmPropSelectable(id)).length;

export interface StudioVrmPropPanelProps {
  readonly vrmReady: boolean;
  readonly rigMetrics: VrmPropRigMetrics;
  readonly items: PropInstance[];
  readonly selectedUid: string | null;
  readonly onSelect: (uid: string | null) => void;
  readonly onAdd: (propId: string) => void;
  readonly onUpdate: (uid: string, patch: Partial<PropInstance>) => void;
  readonly onRemove: (uid: string) => void;
  readonly onClear: () => void;
}

type CatalogCategory = PropCategory | "all";
type TransformSection = "position" | "rotation" | "appearance";

const RECOMMENDED_PROP_IDS = [
  "smartphone",
  "mug",
  "book",
  "mic",
  "glasses",
  "cap",
  "backpack",
  "stethoscope",
] as const;

const CATALOG_CATEGORIES: readonly {
  readonly id: CatalogCategory;
  readonly label: string;
}[] = [
  { id: "all", label: "전체" },
  { id: "hand", label: "손" },
  { id: "head", label: "머리" },
  { id: "body", label: "몸" },
];

const TRANSFORM_SECTIONS: readonly {
  readonly id: TransformSection;
  readonly label: string;
}[] = [
  { id: "position", label: "위치" },
  { id: "rotation", label: "회전" },
  { id: "appearance", label: "모양" },
];

const AXIS_LABELS = ["X", "Y", "Z"] as const;

const GRIP_KIND_LABELS: Record<PropGripKind, string> = {
  cylinder: "원통형",
  handle: "손잡이형",
  flat: "평면형",
  pinch: "집게형",
  support: "받침형",
  wear: "착용형",
};

const DECIMAL_DRAFT_PATTERN = /^-?(?:\d+(?:[.,]\d*)?|[.,]\d*)?$/;
const CLEAR_CONFIRMATION_TIMEOUT_MS = 5_000;

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function isHandBone(value: PropAttachBone): value is PropHandBone {
  return value === "leftHand" || value === "rightHand";
}

function oppositeHand(bone: PropAttachBone): PropHandBone {
  return bone === "rightHand" ? "leftHand" : "rightHand";
}

function replaceAxis(value: Vec3, axis: 0 | 1 | 2, next: number): Vec3 {
  return [
    axis === 0 ? next : value[0],
    axis === 1 ? next : value[1],
    axis === 2 ? next : value[2],
  ];
}

function primaryAnchorId(definition: PropDef): string | null {
  return (
    definition.anchors.find(
      (anchor) => anchor.role === "primary" || anchor.role === "surface"
    )?.id ??
    definition.anchors[0]?.id ??
    null
  );
}

function secondaryAnchorOf(definition: PropDef) {
  return definition.anchors.find((anchor) => anchor.role === "secondary") ?? null;
}

function createSmartRig(definition: PropDef): PropRigV2 | null {
  const anchorId = primaryAnchorId(definition);
  if (!anchorId) return null;
  return {
    version: VRM_PROPS_VERSION,
    mode: "auto",
    anchorId,
    autoScale: true,
    autoFingerPose: Boolean(definition.grip),
    gripFit: 1,
    deltaPosition: [0, 0, 0],
    deltaRotationDeg: [0, 0, 0],
    deltaScale: 1,
  };
}

function defaultSecondary(
  definition: PropDef,
  primaryBone: PropAttachBone
): PropRigSecondary | null {
  const anchor = secondaryAnchorOf(definition);
  if (!anchor) return null;
  return {
    enabled: false,
    anchorId: anchor.id,
    bone: oppositeHand(primaryBone),
    influence: Math.min(1, Math.max(0, definition.secondaryGripInfluence ?? 0.75)),
  };
}

function fitReferenceLabel(definition: PropDef): string {
  switch (definition.fit.reference) {
    case "hand":
      return "손 크기";
    case "avatarHeight":
      return "키";
    case "head":
      return "머리 크기";
    case "eyeDistance":
      return "눈 간격";
    case "shoulder":
      return "어깨 너비";
    case "hip":
      return "골반 너비";
    case "none":
      return "제작 기준";
  }
}

function autoGripDescription(
  definition: PropDef | null,
  item: PropInstance,
  readiness: AutoGripReadiness,
): string {
  if (!definition?.grip || !isHandBone(item.bone)) {
    return "손 부착과 그립 프로필이 모두 있는 소품에서 사용할 수 있습니다.";
  }
  if (readiness.kind === "ready") {
    return `${GRIP_KIND_LABELS[definition.grip.kind]} 접촉점과 이 캐릭터의 손가락 길이를 실측합니다. 켜면 이 손에서는 소품 그립이 현재 포즈보다 우선합니다.`;
  }
  switch (readiness.reason) {
    case "incomplete-rig":
      return "이 캐릭터에서 필요한 손가락 관절을 모두 찾지 못해 자동 그립을 적용할 수 없습니다. 현재 손 포즈는 그대로 유지됩니다.";
    case "contact-conflict":
      return "같은 손에 자동 그립 소품이 둘 이상 연결되어 있습니다. 한 소품만 켜면 손가락이 다시 맞춰집니다.";
    case "invalid-contact":
      return "소품 접촉점이나 자동 크기 값을 안전하게 계산하지 못했습니다. 스마트 소켓 맞춤을 초기화해 보세요.";
    case "not-hand":
      return "부착 부위를 왼손 또는 오른손으로 선택하면 사용할 수 있습니다.";
    case "unsupported":
      return "이 소품은 손가락 자동 그립을 지원하지 않습니다.";
  }
}

function formattedNumber(value: number, precision: number, suffix: string): string {
  return `${value.toFixed(precision)}${suffix}`;
}

function editableNumber(value: number, precision: number): string {
  return String(Number(value.toFixed(precision)));
}

interface NumericDraftInputProps {
  readonly disabled: boolean;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onCommit: (value: number) => void;
  readonly precision: number;
  readonly step: number;
  readonly value: number;
}

function NumericDraftInput({
  disabled,
  label,
  max,
  min,
  onCommit,
  precision,
  step,
  value,
}: NumericDraftInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const displayedValue = draft ?? editableNumber(value, precision);

  function restore(): void {
    setDraft(null);
  }

  function commit(): void {
    if (draft === null) return;
    const normalizedDraft = draft.trim().replace(",", ".");
    if (!/\d/.test(normalizedDraft)) {
      restore();
      return;
    }
    const next = Number(normalizedDraft);
    if (!Number.isFinite(next)) {
      restore();
      return;
    }
    onCommit(Math.min(max, Math.max(min, next)));
    restore();
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={displayedValue}
      disabled={disabled}
      aria-label={label}
      data-min={min}
      data-max={max}
      data-step={step}
      className={cn(
        "min-h-11 w-full rounded-lg border border-line bg-panel px-1.5 text-right text-[0.68rem] tabular-nums text-fg disabled:cursor-not-allowed disabled:opacity-45",
        FOCUS_RING
      )}
      onFocus={() => setDraft(editableNumber(value, precision))}
      onChange={(event) => {
        const nextDraft = event.target.value;
        if (DECIMAL_DRAFT_PATTERN.test(nextDraft)) setDraft(nextDraft);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          restore();
        }
      }}
    />
  );
}

interface AxisFieldProps {
  readonly axis: 0 | 1 | 2;
  readonly disabled: boolean;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onChange: (value: number) => void;
  readonly precision: number;
  readonly step: number;
  readonly suffix: string;
  readonly value: number;
}

function AxisField({
  axis,
  disabled,
  label,
  max,
  min,
  onChange,
  precision,
  step,
  suffix,
  value,
}: AxisFieldProps) {
  const rangeId = useId();
  const axisLabel = AXIS_LABELS[axis];
  const accessibleLabel = `${label} ${axisLabel}축`;
  const valueText = formattedNumber(value, precision, suffix);

  return (
    <div className="grid min-h-11 grid-cols-[1.25rem_minmax(0,1fr)_4.5rem] items-center gap-2">
      <label htmlFor={rangeId} className="text-xs font-bold text-fg-3">
        {axisLabel}
      </label>
      <input
        id={rangeId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={accessibleLabel}
        aria-valuetext={valueText}
        className="h-11 min-w-0 cursor-pointer touch-pan-y accent-accent disabled:cursor-not-allowed disabled:opacity-45"
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <NumericDraftInput
        min={min}
        max={max}
        step={step}
        precision={precision}
        value={value}
        disabled={disabled}
        label={`${accessibleLabel} 직접 입력`}
        onCommit={onChange}
      />
    </div>
  );
}

interface ScalarFieldProps {
  readonly disabled: boolean;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onChange: (value: number) => void;
  readonly precision: number;
  readonly step: number;
  readonly suffix: string;
  readonly value: number;
}

function ScalarField({
  disabled,
  label,
  max,
  min,
  onChange,
  precision,
  step,
  suffix,
  value,
}: ScalarFieldProps) {
  const rangeId = useId();
  const valueText = formattedNumber(value, precision, suffix);
  return (
    <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-2">
      <div className="min-w-0">
        <label htmlFor={rangeId} className="block text-xs font-semibold text-fg-2">
          {label}
        </label>
        <input
          id={rangeId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-valuetext={valueText}
          className="h-11 w-full cursor-pointer touch-pan-y accent-accent disabled:cursor-not-allowed disabled:opacity-45"
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
      <NumericDraftInput
        min={min}
        max={max}
        step={step}
        precision={precision}
        value={value}
        disabled={disabled}
        label={`${label} 직접 입력`}
        onCommit={onChange}
      />
    </div>
  );
}

interface ToggleRowProps {
  readonly checked: boolean;
  readonly description: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}

function ToggleRow({
  checked,
  description,
  disabled = false,
  label,
  onChange,
}: ToggleRowProps) {
  return (
    <StudioThreeDToggleControl
      checked={checked}
      disabled={disabled}
      label={label}
      description={description}
      className="border-b border-line/60 py-1.5 last:border-b-0"
      labelClassName="text-xs font-semibold text-fg-2 group-hover:text-fg"
      descriptionClassName="text-[0.64rem] leading-relaxed text-fg-3"
      onChange={onChange}
    />
  );
}

interface CatalogButtonProps {
  readonly definition: PropDef;
  readonly disabled: boolean;
  readonly onAdd: (definition: PropDef) => void;
}

function CatalogButton({ definition, disabled, onAdd }: CatalogButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${definition.label} 추가. ${definition.hint}`}
      className={cn(
        "flex min-h-12 min-w-0 items-center justify-between gap-1.5 rounded-lg border border-line bg-card px-2 py-1.5 text-left text-fg-2 transition-colors hover:border-accent/40 hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-40",
        FOCUS_RING
      )}
      onClick={() => onAdd(definition)}
    >
      <span className="min-w-0 text-[0.68rem] font-semibold leading-tight">
        {definition.label}
      </span>
      <Plus size={14} className="shrink-0 text-accent" aria-hidden />
    </button>
  );
}

interface SelectedEditorProps {
  readonly allItems: readonly PropInstance[];
  readonly definition: PropDef | null;
  readonly disabled: boolean;
  readonly editorHeadingRef: RefObject<HTMLHeadingElement | null>;
  readonly editorId: string;
  readonly item: PropInstance;
  readonly rigMetrics: VrmPropRigMetrics;
  readonly onUpdate: (uid: string, patch: Partial<PropInstance>) => void;
  readonly onStatus: (message: string) => void;
}

function SelectedEditor({
  allItems,
  definition,
  disabled,
  editorHeadingRef,
  editorId,
  item,
  rigMetrics,
  onUpdate,
  onStatus,
}: SelectedEditorProps) {
  const qualityNotice = studioVrmPropQualityNotice(item.propId);
  const editorTitleId = useId();
  const sectionBaseId = useId();
  const boneSelectId = useId();
  const secondaryBoneSelectId = useId();
  const [transformSection, setTransformSection] = useState<TransformSection>("position");
  const rig = item.rig;
  const secondaryAnchor = definition ? secondaryAnchorOf(definition) : null;
  const secondary = rig?.secondary ??
    (definition ? defaultSecondary(definition, item.bone) : null);
  const position = rig?.deltaPosition ?? item.position;
  const rotation = rig?.deltaRotationDeg ?? item.rotationDeg;
  const scale = rig?.deltaScale ?? item.scale;
  const smartAvailable = Boolean(definition && primaryAnchorId(definition));
  const gripReadiness = inspectAutoGripReadiness(
    item,
    allItems,
    propDefById,
    rigMetrics,
  );
  const gripAvailable = gripReadiness.kind === "ready";

  function updateRig(patch: Partial<PropRigV2>): void {
    const base = item.rig ?? (definition ? createSmartRig(definition) : null);
    if (!base) return;
    onUpdate(item.uid, { rig: { ...base, ...patch } });
  }

  function enableSmartSocket(): void {
    if (item.rig || !definition) return;
    const nextRig = createSmartRig(definition);
    if (!nextRig) return;
    onUpdate(item.uid, { rig: nextRig });
    onStatus(`${definition.label}을 스마트 소켓에 연결했습니다.`);
  }

  function updateBone(bone: PropAttachBone): void {
    if (!rig) {
      onUpdate(item.uid, { bone });
      return;
    }
    let nextSecondary = rig.secondary;
    if (nextSecondary) {
      nextSecondary = {
        ...nextSecondary,
        enabled: isHandBone(bone) ? nextSecondary.enabled : false,
        bone:
          isHandBone(bone) && nextSecondary.bone === bone
            ? oppositeHand(bone)
            : nextSecondary.bone,
      };
    }
    onUpdate(item.uid, {
      bone,
      rig: {
        ...rig,
        autoFingerPose: isHandBone(bone) ? rig.autoFingerPose : false,
        ...(nextSecondary ? { secondary: nextSecondary } : {}),
      },
    });
  }

  function updatePosition(axis: 0 | 1 | 2, value: number): void {
    if (rig) updateRig({ deltaPosition: replaceAxis(rig.deltaPosition, axis, value) });
    else onUpdate(item.uid, { position: replaceAxis(item.position, axis, value) });
  }

  function updateRotation(axis: 0 | 1 | 2, value: number): void {
    if (rig) updateRig({ deltaRotationDeg: replaceAxis(rig.deltaRotationDeg, axis, value) });
    else onUpdate(item.uid, { rotationDeg: replaceAxis(item.rotationDeg, axis, value) });
  }

  function updateScale(value: number): void {
    if (rig) updateRig({ deltaScale: value });
    else onUpdate(item.uid, { scale: value });
  }

  function resetSmartFit(): void {
    if (!definition) return;
    const nextRig = createSmartRig(definition);
    if (!nextRig) return;
    onUpdate(item.uid, {
      bone: definition.defaultBone,
      position: definition.defaultPosition,
      rotationDeg: definition.defaultRotationDeg,
      scale: definition.defaultScale,
      rig: nextRig,
    });
    onStatus(`${definition.label}의 스마트 소켓 맞춤을 기본값으로 되돌렸습니다.`);
  }

  function handleTransformTabKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const currentIndex = TRANSFORM_SECTIONS.findIndex(
      (section) => section.id === transformSection
    );
    let nextIndex: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % TRANSFORM_SECTIONS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (currentIndex - 1 + TRANSFORM_SECTIONS.length) % TRANSFORM_SECTIONS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = TRANSFORM_SECTIONS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextSection = TRANSFORM_SECTIONS[nextIndex];
    if (!nextSection) return;
    setTransformSection(nextSection.id);
    document.getElementById(`${sectionBaseId}-${nextSection.id}-tab`)?.focus();
  }

  return (
    <div
      id={editorId}
      className="border-t border-line/70 bg-panel/45 px-2.5 py-3"
      aria-labelledby={editorTitleId}
    >
      {qualityNotice ? (
        <p role="note" aria-label="소품 품질 안내" className="mb-3 rounded-lg border border-line bg-panel p-3 text-xs leading-relaxed text-fg-2">
          품질 개선 대기 소품입니다. 기존 장면의 부착과 편집은 유지되지만 새로 추가할 수 없습니다. {qualityNotice}
        </p>
      ) : null}
      {item.bone === "head" && rigMetrics.faceSocket.hairClearanceRequired ? (
        <p role="note" aria-label="헤어 간섭 안내" className="mb-3 rounded-lg border border-line bg-panel p-3 text-xs leading-relaxed text-fg-2">
          볼륨 헤어나 기본 머리장식이 소품과 겹칠 수 있습니다. 측면에서 확인하고 소품 위치와 크기를 조정해 주세요.
        </p>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4
            ref={editorHeadingRef}
            id={editorTitleId}
            tabIndex={-1}
            className="text-xs font-bold text-fg outline-none"
          >
            {definition?.label ?? item.propId} 편집
          </h4>
          <p className="mt-0.5 text-[0.64rem] leading-relaxed text-fg-3">
            {definition?.hint ?? "기존 소품의 부착 위치와 모양을 조정합니다."}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-1 text-[0.62rem] font-bold",
            rig
              ? "border-accent/35 bg-accent-soft text-accent"
              : "border-line bg-card text-fg-3"
          )}
        >
          {rig ? "스마트 소켓" : "기존 부착"}
        </span>
      </div>

      <div
        role="note"
        aria-label="소품 부착 안내"
        className="mt-3 rounded-lg border border-line/70 bg-card/55 p-2.5"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-fg-2">
            {rig ? "스마트 소켓으로 부착됨" : "기존 관절 기준으로 부착됨"}
          </p>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-1 text-[0.62rem] font-bold",
              rig ? "bg-accent-soft text-accent" : "bg-raised text-fg-3"
            )}
          >
            {rig ? "정밀 조정 가능" : "변환 가능"}
          </span>
        </div>
        <p className="mt-1 text-[0.64rem] leading-relaxed text-fg-3">
          {rig
            ? "캐릭터의 접촉점을 따라 자동 배치하며, 아래 위치·회전·모양 값은 그 결과에 더하는 정밀 보정입니다."
            : "현재 값은 그대로 유지됩니다. 스마트 소켓을 사용하면 캐릭터 크기와 접촉점을 기준으로 배치한 뒤 정밀하게 보정할 수 있습니다."}
        </p>
        {!rig ? (
          <button
            type="button"
            disabled={disabled || !smartAvailable}
            className={cn(
              "mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-3 text-xs font-bold text-accent transition-colors hover:border-accent/65 disabled:cursor-not-allowed disabled:opacity-45",
              FOCUS_RING
            )}
            onClick={enableSmartSocket}
          >
            <Sparkles size={14} aria-hidden />
            스마트 소켓 사용
          </button>
        ) : null}
      </div>

      <label
        htmlFor={boneSelectId}
        className="mt-3 block text-xs font-semibold text-fg-2"
      >
        부착 부위
        <select
          id={boneSelectId}
          value={item.bone}
          disabled={disabled}
          className={cn(
            "mt-1.5 min-h-11 w-full rounded-lg border border-line bg-card px-2.5 text-xs text-fg disabled:cursor-not-allowed disabled:opacity-45",
            FOCUS_RING
          )}
          onChange={(event) => updateBone(event.target.value as PropAttachBone)}
        >
          {PROP_ATTACH_BONES.map((bone) => (
            <option key={bone} value={bone}>
              {PROP_BONE_LABELS[bone]}
            </option>
          ))}
        </select>
      </label>

      {rig && definition ? (
        <div className="mt-3 rounded-lg border border-line/70 bg-card/45 px-2.5">
          <ToggleRow
            checked={rig.autoScale}
            disabled={disabled}
            label="모델 크기 자동 맞춤"
            description={`${fitReferenceLabel(definition)} 실측값을 기준으로 안전 범위 안에서 배율을 맞춥니다.`}
            onChange={(autoScale) => updateRig({ autoScale })}
          />
          <ToggleRow
            checked={rig.autoFingerPose}
            disabled={disabled || (!rig.autoFingerPose && !gripAvailable)}
            label="손가락 자동 그립"
            description={autoGripDescription(definition, item, gripReadiness)}
            onChange={(autoFingerPose) => updateRig({ autoFingerPose })}
          />
          {rig.autoFingerPose && definition.grip && isHandBone(item.bone) ? (
            <div className="border-t border-line/60 py-2">
              <ScalarField
                disabled={disabled || !gripAvailable}
                label="손가락 맞춤 강도"
                min={VRM_PROP_GRIP_FIT_MIN * 100}
                max={VRM_PROP_GRIP_FIT_MAX * 100}
                step={5}
                precision={0}
                suffix="%"
                value={Math.round(rig.gripFit * 100)}
                onChange={(percent) => updateRig({ gripFit: percent / 100 })}
              />
              <div
                aria-hidden
                className="mt-0.5 flex items-center justify-between text-[0.6rem] font-semibold text-fg-3"
              >
                <span>느슨하게</span>
                <span>기본 100%</span>
                <span>단단하게</span>
              </div>
              <p className="mt-1 text-[0.64rem] leading-relaxed text-fg-3">
                손가락이 소품을 뚫으면 낮추고, 소품에서 떠 보이면 높이세요. 직접 손가락을 편집하려면 자동 그립을 끄면 됩니다.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {rig && definition && secondaryAnchor && secondary ? (
        <div className="mt-3 rounded-lg border border-line/70 bg-card/45 px-2.5 pb-2.5">
          <ToggleRow
            checked={secondary.enabled}
            disabled={disabled || !isHandBone(item.bone)}
            label="보조 손 연결"
            description={
              isHandBone(item.bone)
                ? "긴 소품의 두 번째 접촉점을 반대 손에 연결해 양손 포즈를 안정시킵니다."
                : "주 부착 부위를 왼손 또는 오른손으로 선택하면 사용할 수 있습니다."
            }
            onChange={(enabled) =>
              updateRig({
                secondary: {
                  ...secondary,
                  enabled,
                  anchorId: secondaryAnchor.id,
                  bone:
                    secondary.bone === item.bone
                      ? oppositeHand(item.bone)
                      : secondary.bone,
                },
              })
            }
          />
          {secondary.enabled && isHandBone(item.bone) ? (
            <div className="pt-2">
              <label
                htmlFor={secondaryBoneSelectId}
                className="block text-[0.68rem] font-semibold text-fg-2"
              >
                보조 손
                <select
                  id={secondaryBoneSelectId}
                  value={secondary.bone}
                  disabled={disabled}
                  className={cn(
                    "mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-2.5 text-xs text-fg disabled:cursor-not-allowed disabled:opacity-45",
                    FOCUS_RING
                  )}
                  onChange={(event) =>
                    updateRig({
                      secondary: {
                        ...secondary,
                        bone: event.target.value as PropHandBone,
                      },
                    })
                  }
                >
                  <option value="leftHand" disabled={item.bone === "leftHand"}>
                    왼손
                  </option>
                  <option value="rightHand" disabled={item.bone === "rightHand"}>
                    오른손
                  </option>
                </select>
              </label>
              <ScalarField
                disabled={disabled}
                label="보조 손 영향도"
                min={0}
                max={1}
                step={0.05}
                precision={2}
                suffix=""
                value={secondary.influence}
                onChange={(influence) =>
                  updateRig({
                    secondary: {
                      ...secondary,
                      influence,
                    },
                  })
                }
              />
              <p className="text-right text-[0.62rem] tabular-nums text-fg-3">
                실제 영향 {Math.round(secondary.influence * 100)}%
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label="소품 미세 조정"
        className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-card p-1"
      >
        {TRANSFORM_SECTIONS.map((section) => {
          const active = transformSection === section.id;
          return (
            <button
              key={section.id}
              id={`${sectionBaseId}-${section.id}-tab`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${sectionBaseId}-${section.id}-panel`}
              tabIndex={active ? 0 : -1}
              className={cn(
                "min-h-11 rounded-lg border px-2 text-xs font-bold",
                FOCUS_RING,
                active
                  ? "border-accent/55 bg-accent-soft text-accent"
                  : "border-transparent text-fg-3 hover:bg-raised hover:text-fg"
              )}
              onKeyDown={handleTransformTabKeyDown}
              onClick={() => setTransformSection(section.id)}
            >
              {section.label}
            </button>
          );
        })}
      </div>

      <div
        id={`${sectionBaseId}-position-panel`}
        role="tabpanel"
        aria-labelledby={`${sectionBaseId}-position-tab`}
        hidden={transformSection !== "position"}
        className="mt-2"
      >
        <p className="mb-1 text-[0.64rem] leading-relaxed text-fg-3">
          {rig ? "자동 소켓 위치 위에 더할 미세 이동입니다." : "관절 기준 기존 절대 위치입니다."}
        </p>
        {([0, 1, 2] as const).map((axis) => (
          <AxisField
            key={axis}
            axis={axis}
            disabled={disabled}
            label={rig ? "미세 위치" : "위치"}
            min={-1}
            max={1}
            step={0.01}
            precision={2}
            suffix=" m"
            value={position[axis]}
            onChange={(value) => updatePosition(axis, value)}
          />
        ))}
      </div>

      <div
        id={`${sectionBaseId}-rotation-panel`}
        role="tabpanel"
        aria-labelledby={`${sectionBaseId}-rotation-tab`}
        hidden={transformSection !== "rotation"}
        className="mt-2"
      >
        <p className="mb-1 text-[0.64rem] leading-relaxed text-fg-3">
          {rig ? "자동 소켓 정렬 뒤에 더할 회전 보정입니다." : "기존 관절 기준 절대 회전입니다."}
        </p>
        {([0, 1, 2] as const).map((axis) => (
          <AxisField
            key={axis}
            axis={axis}
            disabled={disabled}
            label={rig ? "미세 회전" : "회전"}
            min={-180}
            max={180}
            step={1}
            precision={0}
            suffix="°"
            value={rotation[axis]}
            onChange={(value) => updateRotation(axis, value)}
          />
        ))}
      </div>

      <div
        id={`${sectionBaseId}-appearance-panel`}
        role="tabpanel"
        aria-labelledby={`${sectionBaseId}-appearance-tab`}
        hidden={transformSection !== "appearance"}
        className="mt-2 space-y-2"
      >
        <ScalarField
          disabled={disabled}
          label={rig ? "자동 맞춤 추가 배율" : "크기 배율"}
          min={0.2}
          max={4}
          step={0.05}
          precision={2}
          suffix="배"
          value={scale}
          onChange={updateScale}
        />
        {item.color !== null ? (
          <label className="flex min-h-11 items-center justify-between gap-3 border-t border-line/60 pt-2 text-xs font-semibold text-fg-2">
            소품 색상
            <span className="flex items-center gap-2">
              <span className="font-mono text-[0.68rem] uppercase text-fg-3">{item.color}</span>
              <input
                type="color"
                value={item.color}
                disabled={disabled}
                aria-label={`${definition?.label ?? item.propId} 색상`}
                className="size-11 cursor-pointer rounded-lg border border-line bg-card p-1 disabled:cursor-not-allowed disabled:opacity-45"
                onChange={(event) => onUpdate(item.uid, { color: event.target.value })}
              />
            </span>
          </label>
        ) : (
          <p className="rounded-lg border border-dashed border-line px-2.5 py-3 text-center text-[0.64rem] text-fg-3">
            이 소품은 고정 재질을 사용합니다.
          </p>
        )}
      </div>

      {rig ? (
        <button
          type="button"
          disabled={disabled || !definition}
          className={cn(
            "mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-45",
            FOCUS_RING
          )}
          onClick={resetSmartFit}
        >
          <RotateCcw size={14} aria-hidden />
          스마트 소켓 맞춤 초기화
        </button>
      ) : null}
    </div>
  );
}

export function StudioVrmPropPanel({
  vrmReady,
  rigMetrics,
  items,
  selectedUid,
  onSelect,
  onAdd,
  onUpdate,
  onRemove,
  onClear,
}: StudioVrmPropPanelProps) {
  const headingId = useId();
  const catalogContentId = useId();
  const selectedEditorId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const currentItemsHeadingRef = useRef<HTMLHeadingElement>(null);
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const selectedEditorHeadingRef = useRef<HTMLHeadingElement>(null);
  const itemButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusFrameRef = useRef<number | null>(null);
  const previousSelectedUidRef = useRef(selectedUid);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CatalogCategory>("all");
  const [recentPropIds, setRecentPropIds] = useState<readonly string[]>(
    RECOMMENDED_PROP_IDS
  );
  const [clearConfirmation, setClearConfirmation] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const quickDefinitions = recentPropIds
    .filter(isStudioVrmPropSelectable)
    .map((id) => propDefById(id))
    .filter((definition): definition is PropDef => Boolean(definition))
    .slice(0, 8);
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const filteredDefinitions = VRM_PROPS.filter((definition) => {
    if (!isStudioVrmPropSelectable(definition.id)) return false;
    if (category !== "all" && definition.category !== category) return false;
    if (!normalizedQuery) return true;
    const searchText = `${definition.label} ${definition.hint} ${
      PROP_CATEGORY_LABELS[definition.category]
    }`.toLocaleLowerCase("ko-KR");
    return searchText.includes(normalizedQuery);
  });

  useEffect(() => {
    const previousUid = previousSelectedUidRef.current;
    previousSelectedUidRef.current = selectedUid;
    if (!selectedUid || selectedUid === previousUid) return;

    const frame = requestAnimationFrame(() => {
      const heading = selectedEditorHeadingRef.current;
      if (!heading) return;
      heading.scrollIntoView({ block: "nearest" });
      heading.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedUid]);

  useEffect(() => {
    if (!clearConfirmation) return;
    const timeout = window.setTimeout(() => {
      setClearConfirmation(false);
      setStatusMessage("전체 제거 확인 시간이 지나 취소되었습니다.");
      if (pendingFocusFrameRef.current !== null) {
        cancelAnimationFrame(pendingFocusFrameRef.current);
      }
      pendingFocusFrameRef.current = requestAnimationFrame(() => {
        pendingFocusFrameRef.current = null;
        clearButtonRef.current?.focus();
      });
    }, CLEAR_CONFIRMATION_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [clearConfirmation]);

  useEffect(
    () => () => {
      if (pendingFocusFrameRef.current !== null) {
        cancelAnimationFrame(pendingFocusFrameRef.current);
      }
    },
    []
  );

  function scheduleListFocus(uid: string | null): void {
    if (pendingFocusFrameRef.current !== null) {
      cancelAnimationFrame(pendingFocusFrameRef.current);
    }
    pendingFocusFrameRef.current = requestAnimationFrame(() => {
      pendingFocusFrameRef.current = null;
      const itemButton = uid ? itemButtonRefs.current.get(uid) : null;
      (itemButton ?? currentItemsHeadingRef.current ?? headingRef.current)?.focus();
    });
  }

  function handleAdd(definition: PropDef): void {
    if (!vrmReady || !isStudioVrmPropSelectable(definition.id)) return;
    setRecentPropIds((current) => [
      definition.id,
      ...current.filter((id) => id !== definition.id),
    ].slice(0, 8));
    setClearConfirmation(false);
    setStatusMessage(`${definition.label} 추가를 요청했습니다.`);
    onAdd(definition.id);
  }

  function handleSelect(item: PropInstance): void {
    const nextUid = selectedUid === item.uid ? null : item.uid;
    setClearConfirmation(false);
    setStatusMessage(
      nextUid
        ? `${propDefById(item.propId)?.label ?? item.propId} 편집기를 열었습니다.`
        : "소품 편집기를 닫았습니다."
    );
    onSelect(nextUid);
  }

  function handleRemove(item: PropInstance): void {
    const label = propDefById(item.propId)?.label ?? item.propId;
    const removedIndex = items.findIndex((candidate) => candidate.uid === item.uid);
    const nextFocusUid =
      items[removedIndex + 1]?.uid ?? items[removedIndex - 1]?.uid ?? null;
    if (selectedUid === item.uid) onSelect(null);
    setClearConfirmation(false);
    setStatusMessage(`${label}을 제거했습니다.`);
    onRemove(item.uid);
    scheduleListFocus(nextFocusUid);
  }

  function handleCancelClear(): void {
    setClearConfirmation(false);
    setStatusMessage("전체 제거를 취소했습니다.");
    if (pendingFocusFrameRef.current !== null) {
      cancelAnimationFrame(pendingFocusFrameRef.current);
    }
    pendingFocusFrameRef.current = requestAnimationFrame(() => {
      pendingFocusFrameRef.current = null;
      clearButtonRef.current?.focus();
    });
  }

  function handleClear(): void {
    if (!clearConfirmation) {
      setClearConfirmation(true);
      setStatusMessage("5초 안에 전체 제거 확인을 누르면 장착된 모든 소품을 제거합니다.");
      return;
    }
    onSelect(null);
    onClear();
    setClearConfirmation(false);
    setStatusMessage("장착된 모든 소품을 제거했습니다.");
    scheduleListFocus(null);
  }

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-line bg-card/45 p-3 text-fg"
    >
      <div className="flex min-h-11 items-center justify-between gap-3">
        <div className="min-w-0">
          <h3
            ref={headingRef}
            id={headingId}
            tabIndex={-1}
            className="flex items-center gap-1.5 text-sm font-bold text-fg outline-none"
          >
            <Sparkles size={15} className="shrink-0 text-accent" aria-hidden />
            소품 부착
          </h3>
          <p className="mt-0.5 text-[0.64rem] leading-relaxed text-fg-3">
            장착 목록과 맞춤 편집을 먼저 확인하고, 필요한 소품만 카탈로그에서 추가하세요.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-line bg-panel px-2 py-1 text-[0.64rem] font-bold tabular-nums text-fg-3">
          {items.length}개
        </span>
      </div>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusMessage}
      </p>

      {!vrmReady ? (
        <p className="mt-2 rounded-lg border border-warn/35 bg-warn/10 px-2.5 py-2 text-[0.68rem] leading-relaxed text-warn">
          캐릭터 모델 준비가 끝나면 소품을 추가하고 맞춤 값을 조정할 수 있습니다.
        </p>
      ) : null}

      <div className="mt-3">
        <div className="mb-1.5 flex min-h-11 items-center justify-between gap-2">
          <h4
            ref={currentItemsHeadingRef}
            tabIndex={-1}
            className="text-xs font-bold text-fg-2 outline-none"
          >
            현재 장착
          </h4>
          {items.length > 0 ? (
            <div className="flex shrink-0 items-center gap-1">
              <button
                ref={clearButtonRef}
                type="button"
                aria-label={
                  clearConfirmation ? "장착된 모든 소품 제거 확인" : "장착된 모든 소품 제거"
                }
                className={cn(
                  "min-h-11 rounded-lg border px-2.5 text-[0.68rem] font-semibold transition-colors",
                  FOCUS_RING,
                  clearConfirmation
                    ? "border-bad/50 bg-bad/10 text-bad"
                    : "border-line bg-card text-fg-3 hover:bg-raised hover:text-bad"
                )}
                onClick={handleClear}
              >
                {clearConfirmation ? "5초 내 제거" : "전체 제거"}
              </button>
              {clearConfirmation ? (
                <button
                  type="button"
                  aria-label="장착된 모든 소품 제거 취소"
                  className={cn(
                    "min-h-11 rounded-lg border border-line bg-card px-2.5 text-[0.68rem] font-semibold text-fg-3 transition-colors hover:bg-raised hover:text-fg",
                    FOCUS_RING
                  )}
                  onClick={handleCancelClear}
                >
                  취소
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-panel/35 px-3 py-4 text-center">
            <p className="text-xs font-semibold text-fg-2">아직 장착된 소품이 없습니다.</p>
            <p className="mt-1 text-[0.64rem] leading-relaxed text-fg-3">
              아래 추천에서 빠르게 추가하거나 전체 카탈로그를 검색하세요.
            </p>
          </div>
        ) : (
          <ul className="space-y-2" aria-label={`현재 장착된 소품 ${items.length}개`}>
            {items.map((item) => {
              const definition = propDefById(item.propId) ?? null;
              const selected = selectedUid === item.uid;
              return (
                <li
                  key={item.uid}
                  className={cn(
                    "overflow-hidden rounded-lg border bg-card/70",
                    selected ? "border-accent/50" : "border-line"
                  )}
                >
                  <div className="flex min-h-11 items-stretch gap-1.5 p-1">
                    <button
                      ref={(node) => {
                        if (node) itemButtonRefs.current.set(item.uid, node);
                        else itemButtonRefs.current.delete(item.uid);
                      }}
                      type="button"
                      aria-expanded={selected}
                      aria-controls={selected ? selectedEditorId : undefined}
                      className={cn(
                        "min-h-11 min-w-0 flex-1 rounded-lg px-2 text-left transition-colors",
                        FOCUS_RING,
                        selected
                          ? "bg-accent-soft text-accent"
                          : "text-fg hover:bg-raised"
                      )}
                      onClick={() => handleSelect(item)}
                    >
                      <span className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate text-xs font-bold">
                          {definition?.label ?? item.propId}
                        </span>
                        <span className="shrink-0 text-[0.62rem] font-normal text-fg-3">
                          {PROP_BONE_LABELS[item.bone]} · {item.rig ? "스마트 소켓" : "기존 부착"}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`${definition?.label ?? item.propId} 제거`}
                      className={cn(
                        "grid size-11 shrink-0 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-bad",
                        FOCUS_RING
                      )}
                      onClick={() => handleRemove(item)}
                    >
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </div>
                  {selected ? (
                    <SelectedEditor
                      allItems={items}
                      item={item}
                      definition={definition}
                      disabled={!vrmReady}
                      rigMetrics={rigMetrics}
                      editorHeadingRef={selectedEditorHeadingRef}
                      editorId={selectedEditorId}
                      onUpdate={onUpdate}
                      onStatus={setStatusMessage}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex min-h-11 items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold text-fg-2">최근 · 추천</p>
            <p className="text-[0.62rem] text-fg-3">자주 쓰는 8종을 바로 추가합니다.</p>
          </div>
          <span className="text-[0.62rem] tabular-nums text-fg-3">{quickDefinitions.length}/8</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 min-[360px]:grid-cols-4">
          {quickDefinitions.map((definition) => (
            <CatalogButton
              key={`quick-${definition.id}`}
              definition={definition}
              disabled={!vrmReady}
              onAdd={handleAdd}
            />
          ))}
        </div>
      </div>

      <details className="group mt-4 rounded-xl border border-line bg-panel/45">
        <summary
          aria-controls={catalogContentId}
          className={cn(
            "flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 py-2 text-xs font-bold text-fg [&::-webkit-details-marker]:hidden",
            FOCUS_RING
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Search size={14} className="shrink-0 text-accent" aria-hidden />
            전체 소품 찾기
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[0.64rem] font-normal tabular-nums text-fg-3">
            {SELECTABLE_PROP_COUNT}종
            <ChevronDown
              size={14}
              className="transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden
            />
          </span>
        </summary>

        <div id={catalogContentId} className="border-t border-line/70 px-3 py-3">
          <label htmlFor={`${catalogContentId}-search`} className="sr-only">
            소품 검색
          </label>
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3"
              aria-hidden
            />
            <input
              id={`${catalogContentId}-search`}
              type="search"
              value={query}
              placeholder="이름·용도 검색"
              className={cn(
                "min-h-11 w-full rounded-lg border border-line bg-card py-2 pl-9 pr-3 text-xs text-fg placeholder:text-fg-3",
                FOCUS_RING
              )}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div
            role="group"
            aria-label="소품 카테고리"
            className="mt-2 grid grid-cols-4 gap-1"
          >
            {CATALOG_CATEGORIES.map((option) => {
              const active = category === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  className={cn(
                    "min-h-11 rounded-lg border px-1 text-[0.68rem] font-bold",
                    FOCUS_RING,
                    active
                      ? "border-accent/55 bg-accent-soft text-accent"
                      : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
                  )}
                  onClick={() => setCategory(option.id)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <p
            className="my-2 text-[0.64rem] font-semibold tabular-nums text-fg-3"
            role="status"
            aria-live="polite"
          >
            검색 결과 {filteredDefinitions.length}종
          </p>

          {filteredDefinitions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line px-3 py-5 text-center">
              <p className="text-xs font-semibold text-fg-2">검색 결과가 없습니다.</p>
              <button
                type="button"
                className={cn(
                  "mt-2 min-h-11 rounded-lg border border-line bg-card px-3 text-[0.68rem] font-semibold text-fg-2 hover:bg-raised hover:text-fg",
                  FOCUS_RING
                )}
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                }}
              >
                검색 초기화
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 min-[360px]:grid-cols-3">
              {filteredDefinitions.map((definition) => (
                <CatalogButton
                  key={`catalog-${definition.id}`}
                  definition={definition}
                  disabled={!vrmReady}
                  onAdd={handleAdd}
                />
              ))}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

export default StudioVrmPropPanel;
