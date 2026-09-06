import { z } from "zod";

export const STUDIO_CHARACTER_BIBLE_VERSION = 1 as const;
export const STUDIO_CHARACTER_BIBLE_MAX_CHARACTERS = 64;
export const STUDIO_CHARACTER_BIBLE_MAX_ID_LENGTH = 120;
export const STUDIO_CHARACTER_BIBLE_MAX_NAME_LENGTH = 80;
export const STUDIO_CHARACTER_BIBLE_MAX_ROLE_LENGTH = 120;
export const STUDIO_CHARACTER_BIBLE_MAX_TEXT_LENGTH = 2_000;
export const STUDIO_CHARACTER_BIBLE_MAX_LIST_ITEMS = 24;
export const STUDIO_CHARACTER_BIBLE_MAX_LIST_ITEM_LENGTH = 160;

const STUDIO_CHARACTER_BIBLE_STORAGE_PREFIX = "toonspectrum-studio-character-bible:v1";

export const STUDIO_CHARACTER_BIBLE_FIELDS = [
  "name",
  "role",
  "appearance",
  "costume",
  "colors",
  "voice",
  "goal",
  "relationships",
  "props",
] as const;

export type StudioCharacterBibleField = (typeof STUDIO_CHARACTER_BIBLE_FIELDS)[number];

const StudioCharacterBibleFieldSchema = z.enum(STUDIO_CHARACTER_BIBLE_FIELDS);
const IdSchema = z.string().trim().min(1).max(STUDIO_CHARACTER_BIBLE_MAX_ID_LENGTH);
const ListItemSchema = z.string().max(STUDIO_CHARACTER_BIBLE_MAX_LIST_ITEM_LENGTH);
const ListSchema = z.array(ListItemSchema).max(STUDIO_CHARACTER_BIBLE_MAX_LIST_ITEMS);

export const StudioCharacterBibleEntrySchema = z
  .object({
    id: IdSchema,
    name: z.string().max(STUDIO_CHARACTER_BIBLE_MAX_NAME_LENGTH),
    role: z.string().max(STUDIO_CHARACTER_BIBLE_MAX_ROLE_LENGTH),
    appearance: z.string().max(STUDIO_CHARACTER_BIBLE_MAX_TEXT_LENGTH),
    costume: z.string().max(STUDIO_CHARACTER_BIBLE_MAX_TEXT_LENGTH),
    colors: ListSchema,
    voice: z.string().max(STUDIO_CHARACTER_BIBLE_MAX_TEXT_LENGTH),
    goal: z.string().max(STUDIO_CHARACTER_BIBLE_MAX_TEXT_LENGTH),
    relationships: ListSchema,
    props: ListSchema,
    lockedFields: z.array(StudioCharacterBibleFieldSchema).max(STUDIO_CHARACTER_BIBLE_FIELDS.length),
  })
  .strict();

export const StudioCharacterBibleSchema = z
  .object({
    version: z.literal(STUDIO_CHARACTER_BIBLE_VERSION),
    characters: z.array(StudioCharacterBibleEntrySchema).max(STUDIO_CHARACTER_BIBLE_MAX_CHARACTERS),
  })
  .strict();

export type StudioCharacterBibleEntry = z.infer<typeof StudioCharacterBibleEntrySchema>;
export type StudioCharacterBible = z.infer<typeof StudioCharacterBibleSchema>;
export type StudioCharacterBibleEntryInput = { id: string } & Partial<Omit<StudioCharacterBibleEntry, "id">>;
export type StudioCharacterBibleEntryPatch = Partial<Omit<StudioCharacterBibleEntry, "id">>;

export interface StudioCharacterBibleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const FIELD_SET = new Set<string>(STUDIO_CHARACTER_BIBLE_FIELDS);
const PATCH_FIELD_SET = new Set<string>([...STUDIO_CHARACTER_BIBLE_FIELDS, "lockedFields"]);
const STRING_FIELDS = ["name", "role", "appearance", "costume", "voice", "goal"] as const;
const LIST_FIELDS = ["colors", "relationships", "props"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeList(value: unknown): string[] {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,;]+/u)
      : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const item = candidate.trim().slice(0, STUDIO_CHARACTER_BIBLE_MAX_LIST_ITEM_LENGTH);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (result.length >= STUDIO_CHARACTER_BIBLE_MAX_LIST_ITEMS) break;
  }
  return result;
}

function normalizeLockedFields(value: unknown): StudioCharacterBibleField[] {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,;]+/u)
      : [];
  const result: StudioCharacterBibleField[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !FIELD_SET.has(candidate)) continue;
    const field = candidate as StudioCharacterBibleField;
    if (!result.includes(field)) result.push(field);
  }
  return result;
}

function normalizeEntry(value: unknown): StudioCharacterBibleEntry | null {
  if (!isRecord(value)) return null;
  const legacyId = value.id ?? value.characterId;
  const idResult = IdSchema.safeParse(legacyId);
  if (!idResult.success) return null;
  const entry: StudioCharacterBibleEntry = {
    id: idResult.data,
    name: normalizeText(value.name ?? value.characterName, STUDIO_CHARACTER_BIBLE_MAX_NAME_LENGTH),
    role: normalizeText(value.role, STUDIO_CHARACTER_BIBLE_MAX_ROLE_LENGTH),
    appearance: normalizeText(value.appearance, STUDIO_CHARACTER_BIBLE_MAX_TEXT_LENGTH),
    costume: normalizeText(value.costume, STUDIO_CHARACTER_BIBLE_MAX_TEXT_LENGTH),
    colors: normalizeList(value.colors ?? value.palette),
    voice: normalizeText(value.voice, STUDIO_CHARACTER_BIBLE_MAX_TEXT_LENGTH),
    goal: normalizeText(value.goal, STUDIO_CHARACTER_BIBLE_MAX_TEXT_LENGTH),
    relationships: normalizeList(value.relationships ?? value.relationship),
    props: normalizeList(value.props),
    lockedFields: normalizeLockedFields(value.lockedFields),
  };
  return StudioCharacterBibleEntrySchema.parse(entry);
}

function extractLegacyCharacters(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  if (Array.isArray(value.characters)) return value.characters;
  if (Array.isArray(value.entries)) return value.entries;
  if (Array.isArray(value.items)) return value.items;
  return [];
}

export function createEmptyStudioCharacterBible(): StudioCharacterBible {
  return { version: STUDIO_CHARACTER_BIBLE_VERSION, characters: [] };
}

/**
 * Reads the current container and the unversioned array/characters/entries/items forms used by
 * early Studio experiments. Bad records and duplicate IDs are dropped; an ID is never invented
 * during migration because character IDs are owned by the client that created them.
 */
export function normalizeStudioCharacterBible(value: unknown): StudioCharacterBible {
  let decoded = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value) as unknown;
    } catch {
      return createEmptyStudioCharacterBible();
    }
  }

  const current = StudioCharacterBibleSchema.safeParse(decoded);
  const candidates = current.success ? current.data.characters : extractLegacyCharacters(decoded);
  const ids = new Set<string>();
  const characters: StudioCharacterBibleEntry[] = [];
  for (const candidate of candidates) {
    const entry = normalizeEntry(candidate);
    if (!entry || ids.has(entry.id)) continue;
    ids.add(entry.id);
    characters.push(entry);
    if (characters.length >= STUDIO_CHARACTER_BIBLE_MAX_CHARACTERS) break;
  }
  return { version: STUDIO_CHARACTER_BIBLE_VERSION, characters };
}

export function serializeStudioCharacterBible(bible: StudioCharacterBible): string {
  return JSON.stringify(StudioCharacterBibleSchema.parse(bible));
}

export function studioCharacterBibleStorageKey(input: {
  userId?: string | null;
  workId?: string | null;
  remixId?: string | null;
}): string {
  const owner = encodeURIComponent(input.userId?.trim() || "guest");
  const documentId = input.workId
    ? `work:${encodeURIComponent(input.workId)}`
    : input.remixId
      ? `remix:${encodeURIComponent(input.remixId)}`
      : "new";
  return `${STUDIO_CHARACTER_BIBLE_STORAGE_PREFIX}:${owner}:${documentId}`;
}

export function loadStudioCharacterBible(
  storage: Pick<StudioCharacterBibleStorage, "getItem"> | null | undefined,
  key: string
): StudioCharacterBible {
  if (!storage) return createEmptyStudioCharacterBible();
  try {
    const value = storage.getItem(key);
    return value ? normalizeStudioCharacterBible(value) : createEmptyStudioCharacterBible();
  } catch {
    return createEmptyStudioCharacterBible();
  }
}

export function saveStudioCharacterBible(
  storage: Pick<StudioCharacterBibleStorage, "setItem">,
  key: string,
  bible: StudioCharacterBible
): StudioCharacterBible {
  const normalized = StudioCharacterBibleSchema.parse(bible);
  try {
    storage.setItem(key, JSON.stringify(normalized));
  } catch {
    throw new Error("브라우저 저장공간이 부족해 캐릭터 바이블을 저장하지 못했어요.");
  }
  return normalized;
}

export function addStudioCharacter(
  bible: StudioCharacterBible,
  input: StudioCharacterBibleEntryInput
): StudioCharacterBible {
  if (bible.characters.length >= STUDIO_CHARACTER_BIBLE_MAX_CHARACTERS) {
    throw new Error(`캐릭터는 최대 ${STUDIO_CHARACTER_BIBLE_MAX_CHARACTERS}명까지 저장할 수 있어요.`);
  }
  const entry = normalizeEntry(input);
  if (!entry) throw new Error("캐릭터 ID는 클라이언트에서 발급한 유효한 문자열이어야 해요.");
  if (bible.characters.some((character) => character.id === entry.id)) {
    throw new Error("이미 사용 중인 캐릭터 ID예요.");
  }
  return { ...bible, characters: [...bible.characters, entry] };
}

function normalizePatch(patch: StudioCharacterBibleEntryPatch): StudioCharacterBibleEntryPatch {
  if (!isRecord(patch)) throw new Error("올바르지 않은 캐릭터 수정 내용이에요.");
  for (const key of Object.keys(patch)) {
    if (!PATCH_FIELD_SET.has(key)) throw new Error(`수정할 수 없는 캐릭터 필드예요: ${key}`);
  }
  const normalized: StudioCharacterBibleEntryPatch = {};
  for (const field of STRING_FIELDS) {
    if (!Object.hasOwn(patch, field)) continue;
    const max = field === "name"
      ? STUDIO_CHARACTER_BIBLE_MAX_NAME_LENGTH
      : field === "role"
        ? STUDIO_CHARACTER_BIBLE_MAX_ROLE_LENGTH
        : STUDIO_CHARACTER_BIBLE_MAX_TEXT_LENGTH;
    normalized[field] = normalizeText(patch[field], max);
  }
  for (const field of LIST_FIELDS) {
    if (Object.hasOwn(patch, field)) normalized[field] = normalizeList(patch[field]);
  }
  if (Object.hasOwn(patch, "lockedFields")) {
    normalized.lockedFields = normalizeLockedFields(patch.lockedFields);
  }
  return normalized;
}

export function patchStudioCharacter(
  bible: StudioCharacterBible,
  characterId: string,
  patch: StudioCharacterBibleEntryPatch
): StudioCharacterBible {
  const index = bible.characters.findIndex((character) => character.id === characterId);
  if (index < 0) return bible;
  const nextCharacter = StudioCharacterBibleEntrySchema.parse({
    ...bible.characters[index],
    ...normalizePatch(patch),
  });
  const characters = bible.characters.slice();
  characters[index] = nextCharacter;
  return { ...bible, characters };
}

export function removeStudioCharacter(
  bible: StudioCharacterBible,
  characterId: string
): StudioCharacterBible {
  const characters = bible.characters.filter((character) => character.id !== characterId);
  return characters.length === bible.characters.length ? bible : { ...bible, characters };
}

export function reorderStudioCharacter(
  bible: StudioCharacterBible,
  characterId: string,
  toIndex: number
): StudioCharacterBible {
  const fromIndex = bible.characters.findIndex((character) => character.id === characterId);
  if (fromIndex < 0 || !Number.isFinite(toIndex) || bible.characters.length < 2) return bible;
  const targetIndex = Math.max(0, Math.min(bible.characters.length - 1, Math.trunc(toIndex)));
  if (fromIndex === targetIndex) return bible;
  const characters = bible.characters.slice();
  const [character] = characters.splice(fromIndex, 1);
  characters.splice(targetIndex, 0, character);
  return { ...bible, characters };
}

const PROMPT_FIELD_LABELS: Record<StudioCharacterBibleField, string> = {
  name: "이름",
  role: "역할",
  appearance: "외형",
  costume: "의상",
  colors: "대표 색",
  voice: "말투",
  goal: "목표",
  relationships: "관계",
  props: "소품",
};

/**
 * Turns the canonical bible into bounded, deterministic prompt context. A `[고정]` marker is
 * deliberately attached to locked fields so text/image orchestration can treat them as hard
 * constraints rather than ordinary inspiration. Empty fields are omitted to avoid prompt noise.
 */
export function buildStudioCharacterBiblePromptContext(
  value: unknown,
  maxLength = 12_000
): string {
  const bible = normalizeStudioCharacterBible(value);
  const sections = bible.characters.flatMap((character, index) => {
    const lines: string[] = [];
    for (const field of STUDIO_CHARACTER_BIBLE_FIELDS) {
      const raw = character[field];
      const text = Array.isArray(raw) ? raw.join(" | ") : raw.trim();
      if (!text) continue;
      const locked = character.lockedFields.includes(field) ? " [고정]" : "";
      lines.push(`- ${PROMPT_FIELD_LABELS[field]}${locked}: ${text}`);
    }
    return lines.length > 0 ? [`캐릭터 ${index + 1}\n${lines.join("\n")}`] : [];
  });
  if (sections.length === 0) return "";
  return sections.join("\n\n").slice(0, Math.max(0, Math.trunc(maxLength)));
}
