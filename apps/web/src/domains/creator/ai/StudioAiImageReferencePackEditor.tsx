import {
  Camera,
  Image as ImageIcon,
  Paintbrush,
  Plus,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useId, useState } from "react";

import {
  hydrateStudioAiImageReferenceDocument,
  STUDIO_AI_IMAGE_REFERENCE_DOCUMENT_VERSION,
  STUDIO_AI_IMAGE_REFERENCE_LIMITS,
  STUDIO_AI_IMAGE_REFERENCE_ROLES,
  type StudioAiImageReference,
  type StudioAiImageReferenceDocument,
  type StudioAiImageReferenceRole,
} from "./studio-ai-image-reference-roles";

import { cn } from "@/shared/lib/utils";

export const STUDIO_AI_IMAGE_REFERENCE_PROVIDER_SAFE_MAX = 16;

const SAFE_REFERENCE_THUMBNAIL_DATA_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export interface StudioAiImageReferenceAssetOption {
  readonly id: string;
  readonly name: string;
  /**
   * Display-only object URL, remote URL, or data URL. The editor never copies this value into the
   * canonical reference document; provider upload remains the integration layer's responsibility.
   */
  readonly thumbnailUrl: string;
  readonly sha256?: string;
}

export interface StudioAiImageReferencePackEditorProps {
  readonly document: StudioAiImageReferenceDocument;
  readonly assetOptions: readonly StudioAiImageReferenceAssetOption[];
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly onChange: (next: StudioAiImageReferenceDocument) => void;
}

interface RolePresentation {
  readonly eyebrow: "Character" | "Method" | "Style";
  readonly title: string;
  readonly description: string;
  readonly emptyLabel: string;
  readonly icon: typeof UserRound;
  readonly iconClassName: string;
  readonly iconSurfaceClassName: string;
}

const ROLE_PRESENTATION: Readonly<
  Record<StudioAiImageReferenceRole, RolePresentation>
> = {
  character: {
    eyebrow: "Character",
    title: "캐릭터",
    description: "얼굴·체형·헤어·의상처럼 반복되어야 할 정체성만 참고합니다.",
    emptyLabel: "캐릭터 정체성 참조가 없습니다.",
    icon: UserRound,
    iconClassName: "text-accent",
    iconSurfaceClassName: "border-accent/25 bg-accent-soft/45",
  },
  method: {
    eyebrow: "Method",
    title: "구도·연출",
    description: "카메라 각도·프레이밍·포즈·공간 배치만 참고합니다.",
    emptyLabel: "구도와 연출 참조가 없습니다.",
    icon: Camera,
    iconClassName: "text-warning",
    iconSurfaceClassName: "border-warning/25 bg-warning/10",
  },
  style: {
    eyebrow: "Style",
    title: "화풍",
    description: "선질·색 관계·광원·질감·마감 방식만 참고합니다.",
    emptyLabel: "화풍 참조가 없습니다.",
    icon: Paintbrush,
    iconClassName: "text-fg",
    iconSurfaceClassName: "border-line-strong bg-raised",
  },
};

function normalizedSha256(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^(?:sha256:)?([a-f0-9]{64})$/iu.exec(value.trim());
  return match ? `sha256:${match[1].toLowerCase()}` : null;
}

function referenceMatchesOption(
  reference: StudioAiImageReference,
  option: StudioAiImageReferenceAssetOption,
): boolean {
  const referenceSha256 = normalizedSha256(reference.asset.sha256);
  const optionSha256 = normalizedSha256(option.sha256);
  if (referenceSha256) return referenceSha256 === optionSha256;
  return Boolean(
    reference.asset.assetId
    && reference.asset.assetId === option.id,
  );
}

/**
 * Prevents a reference picker from contacting an arbitrary third-party host merely to render a
 * thumbnail. Local raster data URLs, same-origin blob URLs, and same-origin HTTP(S) assets are
 * admitted; active SVG/data documents and cross-origin network URLs fail closed to the icon
 * fallback.
 */
function admitStudioAiImageReferenceThumbnailUrl(
  value: string,
  currentOrigin: string | null =
    typeof window === "undefined" ? null : window.location.origin,
): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.startsWith("data:")) {
    const commaIndex = value.indexOf(",");
    if (commaIndex <= "data:".length || commaIndex > 256) return null;
    const headerParts = value
      .slice("data:".length, commaIndex)
      .split(";")
      .map((part) => part.trim().toLowerCase());
    return SAFE_REFERENCE_THUMBNAIL_DATA_MIME_TYPES.has(headerParts[0] ?? "")
      && headerParts.slice(1).includes("base64")
      ? value
      : null;
  }

  const trimmed = value.trim();
  if (!trimmed || !currentOrigin) return null;
  try {
    const url = new URL(trimmed, `${currentOrigin}/`);
    if (
      (url.protocol === "blob:"
        || url.protocol === "http:"
        || url.protocol === "https:")
      && url.origin === currentOrigin
    ) {
      return url.href;
    }
  } catch {
    // Invalid and opaque preview URLs use the non-networking icon fallback.
  }
  return null;
}

function optionForReference(
  reference: StudioAiImageReference,
  assetOptions: readonly StudioAiImageReferenceAssetOption[],
): StudioAiImageReferenceAssetOption | undefined {
  return assetOptions.find((option) => referenceMatchesOption(reference, option));
}

function displayReferenceName(
  reference: StudioAiImageReference,
  option: StudioAiImageReferenceAssetOption | undefined,
): string {
  return (
    option?.name.trim()
    || reference.label?.trim()
    || reference.asset.assetId
    || "연결된 이미지"
  );
}

function canonicalDocument(
  references: readonly unknown[],
): StudioAiImageReferenceDocument {
  return hydrateStudioAiImageReferenceDocument({
    version: STUDIO_AI_IMAGE_REFERENCE_DOCUMENT_VERSION,
    references,
  });
}

interface ReferenceGuidanceProps {
  readonly reference: StudioAiImageReference;
  readonly name: string;
  readonly disabled: boolean;
  readonly onChange: (guidance: string) => void;
}

function ReferenceGuidance({
  reference,
  name,
  disabled,
  onChange,
}: ReferenceGuidanceProps) {
  const [draft, setDraft] = useState(reference.guidance ?? "");

  useEffect(() => {
    setDraft(reference.guidance ?? "");
  }, [reference.guidance, reference.id]);

  return (
    <textarea
      value={draft}
      onChange={(event) => {
        const next = event.target.value.slice(
          0,
          STUDIO_AI_IMAGE_REFERENCE_LIMITS.maxGuidanceLength,
        );
        setDraft(next);
        onChange(next);
      }}
      aria-label={`${name} 참조 지침`}
      placeholder="선택 사항 · 이 역할에서 참고할 특징"
      disabled={disabled}
      rows={2}
      maxLength={STUDIO_AI_IMAGE_REFERENCE_LIMITS.maxGuidanceLength}
      className="mt-1.5 min-h-11 w-full min-w-0 resize-y rounded-lg border border-line bg-panel px-2.5 py-2 text-xs leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-3 hover:border-line-strong focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:bg-raised/45 disabled:text-fg-3"
    />
  );
}

interface ReferenceRowProps {
  readonly reference: StudioAiImageReference;
  readonly role: StudioAiImageReferenceRole;
  readonly assetOptions: readonly StudioAiImageReferenceAssetOption[];
  readonly disabled: boolean;
  readonly onGuidanceChange: (referenceId: string, guidance: string) => void;
  readonly onRemove: (referenceId: string) => void;
}

function ReferenceRow({
  reference,
  role,
  assetOptions,
  disabled,
  onGuidanceChange,
  onRemove,
}: ReferenceRowProps) {
  const option = optionForReference(reference, assetOptions);
  const name = displayReferenceName(reference, option);
  const roleName = ROLE_PRESENTATION[role].eyebrow;
  const thumbnailUrl = option?.thumbnailUrl
    ? admitStudioAiImageReferenceThumbnailUrl(option.thumbnailUrl)
    : null;

  return (
    <li className="min-w-0 rounded-lg border border-line bg-panel/70 p-2">
      <div className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)_44px] items-start gap-2">
        <div
          title={
            option?.thumbnailUrl && !thumbnailUrl
              ? "외부 미리보기는 개인정보 보호를 위해 차단되었습니다."
              : undefined
          }
          className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-raised text-fg-3"
        >
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              referrerPolicy="no-referrer"
              className="size-full object-cover"
            />
          ) : (
            <ImageIcon size={18} aria-hidden />
          )}
        </div>

        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-fg" title={name}>
            {name}
          </p>
          <p className="mt-0.5 truncate text-[0.65rem] text-fg-3">
            {roleName} 참조
          </p>
          <ReferenceGuidance
            reference={reference}
            name={name}
            disabled={disabled}
            onChange={(guidance) => onGuidanceChange(reference.id, guidance)}
          />
        </div>

        <button
          type="button"
          onClick={() => onRemove(reference.id)}
          disabled={disabled}
          aria-label={`${name} ${roleName} 참조 제거`}
          title="이 역할에서 제거"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-transparent text-fg-2 transition-colors hover:border-danger/20 hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/35 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </li>
  );
}

interface ReferenceRoleSectionProps {
  readonly role: StudioAiImageReferenceRole;
  readonly references: readonly StudioAiImageReference[];
  readonly totalReferenceCount: number;
  readonly assetOptions: readonly StudioAiImageReferenceAssetOption[];
  readonly loading: boolean;
  readonly disabled: boolean;
  readonly onAdd: (
    role: StudioAiImageReferenceRole,
    option: StudioAiImageReferenceAssetOption,
  ) => void;
  readonly onGuidanceChange: (referenceId: string, guidance: string) => void;
  readonly onRemove: (referenceId: string) => void;
}

function ReferenceRoleSection({
  role,
  references,
  totalReferenceCount,
  assetOptions,
  loading,
  disabled,
  onAdd,
  onGuidanceChange,
  onRemove,
}: ReferenceRoleSectionProps) {
  const id = useId();
  const [pendingAssetId, setPendingAssetId] = useState("");
  const presentation = ROLE_PRESENTATION[role];
  const Icon = presentation.icon;
  const roleLimitReached =
    references.length >= STUDIO_AI_IMAGE_REFERENCE_LIMITS.maxReferencesPerRole;
  const providerLimitReached =
    totalReferenceCount >= STUDIO_AI_IMAGE_REFERENCE_PROVIDER_SAFE_MAX;
  const availableOptions = assetOptions.filter(
    (option) =>
      !references.some((reference) => referenceMatchesOption(reference, option)),
  );
  const selectedOption = availableOptions.find(
    (option) => option.id === pendingAssetId,
  );
  const addUnavailable =
    disabled
    || loading
    || roleLimitReached
    || providerLimitReached
    || availableOptions.length === 0;
  const availabilityMessage = disabled
    ? "읽기 전용 상태에서는 참조를 변경할 수 없습니다."
    : loading
      ? "프로젝트 에셋을 불러오는 중입니다."
      : providerLimitReached
        ? `AI 제공자 안전 한도 ${STUDIO_AI_IMAGE_REFERENCE_PROVIDER_SAFE_MAX}개에 도달했습니다. 기존 참조를 제거한 뒤 추가하세요.`
        : roleLimitReached
          ? `${presentation.eyebrow} 역할은 최대 ${STUDIO_AI_IMAGE_REFERENCE_LIMITS.maxReferencesPerRole}개까지 연결할 수 있습니다.`
          : availableOptions.length === 0
            ? "이 역할에 새로 연결할 에셋이 없습니다."
            : "같은 이미지를 다른 역할에도 의도적으로 연결할 수 있습니다.";

  useEffect(() => {
    if (
      pendingAssetId
      && !availableOptions.some((option) => option.id === pendingAssetId)
    ) {
      setPendingAssetId("");
    }
  }, [availableOptions, pendingAssetId]);

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="min-w-0 rounded-lg border border-line bg-card/35 p-2.5"
      data-studio-ai-image-reference-role={role}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg border",
            presentation.iconSurfaceClassName,
            presentation.iconClassName,
          )}
        >
          <Icon size={17} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h3
              id={`${id}-title`}
              className="min-w-0 truncate text-xs font-bold text-fg"
            >
              {presentation.eyebrow} · {presentation.title}
            </h3>
            <span className="shrink-0 rounded-full border border-line bg-panel px-2 py-0.5 text-[0.65rem] font-semibold tabular-nums text-fg-2">
              {references.length}/{STUDIO_AI_IMAGE_REFERENCE_LIMITS.maxReferencesPerRole}
            </span>
          </div>
          <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-2">
            {presentation.description}
          </p>
        </div>
      </div>

      {references.length > 0 ? (
        <ul className="mt-2.5 grid min-w-0 gap-2">
          {references.map((reference) => (
            <ReferenceRow
              key={reference.id}
              reference={reference}
              role={role}
              assetOptions={assetOptions}
              disabled={disabled}
              onGuidanceChange={onGuidanceChange}
              onRemove={onRemove}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-2.5 rounded-lg border border-dashed border-line px-2.5 py-3 text-center text-[0.68rem] text-fg-3">
          {presentation.emptyLabel}
        </p>
      )}

      <div className="mt-2.5 border-t border-line pt-2.5">
        <label
          htmlFor={`${id}-asset`}
          className="mb-1 block text-[0.68rem] font-semibold text-fg-2"
        >
          에셋 추가
        </label>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_44px] gap-2">
          <select
            id={`${id}-asset`}
            value={pendingAssetId}
            onChange={(event) => setPendingAssetId(event.target.value)}
            disabled={addUnavailable}
            aria-label={`${presentation.eyebrow}에 추가할 에셋`}
            aria-describedby={`${id}-availability`}
            className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-panel px-2.5 text-xs text-fg outline-none transition-colors hover:border-line-strong focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:bg-raised/45 disabled:text-fg-3"
          >
            <option value="">
              {loading
                ? "에셋 불러오는 중…"
                : availableOptions.length > 0
                  ? "이미지 에셋 선택…"
                  : "추가할 에셋 없음"}
            </option>
            {availableOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              if (!selectedOption) return;
              onAdd(role, selectedOption);
              setPendingAssetId("");
            }}
            disabled={addUnavailable || !selectedOption}
            aria-label={`${presentation.eyebrow} 참조 추가`}
            title={
              selectedOption
                ? `${selectedOption.name} 추가`
                : availabilityMessage
            }
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-accent text-on-accent transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:cursor-not-allowed disabled:bg-raised disabled:text-fg-3"
          >
            <Plus size={17} aria-hidden />
          </button>
        </div>
        <p
          id={`${id}-availability`}
          className={cn(
            "mt-1.5 text-[0.65rem] leading-relaxed",
            roleLimitReached || providerLimitReached ? "text-warning" : "text-fg-3",
          )}
        >
          {availabilityMessage}
        </p>
      </div>
    </section>
  );
}

export function StudioAiImageReferencePackEditor({
  document,
  assetOptions,
  loading = false,
  disabled = false,
  onChange,
}: StudioAiImageReferencePackEditorProps) {
  const headingId = useId();
  const totalReferenceCount = document.references.length;

  const emitReferences = (references: readonly unknown[]) => {
    onChange(canonicalDocument(references));
  };
  const handleAdd = (
    role: StudioAiImageReferenceRole,
    option: StudioAiImageReferenceAssetOption,
  ) => {
    if (
      disabled
      || loading
      || totalReferenceCount >= STUDIO_AI_IMAGE_REFERENCE_PROVIDER_SAFE_MAX
    ) {
      return;
    }
    const roleReferences = document.references.filter(
      (reference) => reference.role === role,
    );
    if (
      roleReferences.length >=
        STUDIO_AI_IMAGE_REFERENCE_LIMITS.maxReferencesPerRole
      || roleReferences.some((reference) => referenceMatchesOption(reference, option))
    ) {
      return;
    }
    emitReferences([
      ...document.references,
      {
        role,
        assetId: option.id,
        ...(option.sha256 ? { sha256: option.sha256 } : {}),
        label: option.name,
      },
    ]);
  };
  const handleGuidanceChange = (referenceId: string, guidance: string) => {
    if (disabled) return;
    emitReferences(
      document.references.map((reference) =>
        reference.id === referenceId
          ? {
              ...reference,
              guidance: guidance.slice(
                0,
                STUDIO_AI_IMAGE_REFERENCE_LIMITS.maxGuidanceLength,
              ),
            }
          : reference
      ),
    );
  };
  const handleRemove = (referenceId: string) => {
    if (disabled) return;
    emitReferences(
      document.references.filter((reference) => reference.id !== referenceId),
    );
  };

  return (
    <section
      aria-labelledby={headingId}
      data-disabled={disabled || undefined}
      data-studio-ai-image-reference-pack-editor="true"
      className="w-full min-w-0 overflow-hidden rounded-lg border border-line bg-panel p-3 text-fg"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-bold text-fg">
            AI 이미지 참조 팩
          </h2>
          <p className="mt-1 text-[0.7rem] leading-relaxed text-fg-2">
            이미지마다 역할을 분리해 정체성·구도·화풍이 서로 섞이는 현상을 줄입니다.
          </p>
        </div>
        <span
          aria-label={`전체 참조 ${totalReferenceCount}/${STUDIO_AI_IMAGE_REFERENCE_PROVIDER_SAFE_MAX}`}
          className="shrink-0 rounded-full border border-line bg-raised px-2.5 py-1 text-[0.68rem] font-bold tabular-nums text-fg-2"
        >
          {totalReferenceCount}/{STUDIO_AI_IMAGE_REFERENCE_PROVIDER_SAFE_MAX}
        </span>
      </div>

      {loading ? (
        <p
          role="status"
          className="mt-2.5 flex min-h-11 items-center rounded-lg border border-line bg-raised/60 px-3 text-xs text-fg-2"
        >
          프로젝트 이미지 에셋을 불러오는 중…
        </p>
      ) : null}
      {disabled ? (
        <p className="mt-2.5 rounded-lg border border-line bg-raised/60 px-3 py-2 text-[0.68rem] leading-relaxed text-fg-2">
          읽기 전용 상태입니다. 현재 참조와 지침은 확인할 수 있지만 변경할 수 없습니다.
        </p>
      ) : null}

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-2.5">
        {STUDIO_AI_IMAGE_REFERENCE_ROLES.map((role) => (
          <ReferenceRoleSection
            key={role}
            role={role}
            references={document.references.filter(
              (reference) => reference.role === role,
            )}
            totalReferenceCount={totalReferenceCount}
            assetOptions={assetOptions}
            loading={loading}
            disabled={disabled}
            onAdd={handleAdd}
            onGuidanceChange={handleGuidanceChange}
            onRemove={handleRemove}
          />
        ))}
      </div>
    </section>
  );
}
