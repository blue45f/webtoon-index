/**
 * Live command-execution bridge for unified search.
 *
 * This is a deliberately small strangler in front of the full CommandRegistry migration.
 * Menu rows remain the product execution authority; only rows that explicitly declare
 * `searchActivation: "execute"` are published. Search therefore calls the exact same
 * `onSelect` closure as the menu, while save/publish/delete and every unreviewed command
 * remain help-only by default.
 */

export interface StudioCommandExecutionBinding {
  readonly commandId: string;
  readonly label: string;
  readonly execute: () => void;
  readonly disabled: boolean;
  readonly unavailableReason?: string;
}

export interface StudioCommandExecutionMenuItem {
  readonly commandId?: string;
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  readonly unavailableReason?: string;
  readonly danger?: boolean;
  readonly searchActivation?: "execute";
}

export interface StudioCommandExecutionMenuGroup {
  readonly items: readonly StudioCommandExecutionMenuItem[];
}

const EMPTY_BINDINGS: ReadonlyMap<string, StudioCommandExecutionBinding> = new Map();
let bindingsSnapshot: ReadonlyMap<string, StudioCommandExecutionBinding> = EMPTY_BINDINGS;
let activeInstallation: symbol | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Flattens menu groups into direct-search bindings. First declaration wins so a duplicate
 * CommandId cannot silently change meaning just because presentation order changed.
 */
export function createStudioCommandExecutionBindings(
  groups: readonly StudioCommandExecutionMenuGroup[],
): readonly StudioCommandExecutionBinding[] {
  const seen = new Set<string>();
  const result: StudioCommandExecutionBinding[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      const commandId = item.commandId?.trim();
      if (
        !commandId
        || item.searchActivation !== "execute"
        || item.danger === true
        || seen.has(commandId)
      ) {
        continue;
      }
      seen.add(commandId);
      result.push({
        commandId,
        label: item.label,
        execute: item.onSelect,
        disabled: item.disabled === true,
        ...(item.unavailableReason
          ? { unavailableReason: item.unavailableReason }
          : {}),
      });
    }
  }
  return result;
}

/** Installs one live Studio host. A stale StrictMode cleanup cannot clear a newer host. */
export function installStudioCommandExecutionBindings(
  bindings: readonly StudioCommandExecutionBinding[],
): () => void {
  const installation = Symbol("studio-command-execution-bindings");
  const next = new Map<string, StudioCommandExecutionBinding>();
  for (const binding of bindings) {
    if (!next.has(binding.commandId)) next.set(binding.commandId, binding);
  }
  activeInstallation = installation;
  bindingsSnapshot = next;
  emit();

  return () => {
    if (activeInstallation !== installation) return;
    activeInstallation = null;
    bindingsSnapshot = EMPTY_BINDINGS;
    emit();
  };
}

export function subscribeStudioCommandExecutionBindings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getStudioCommandExecutionBindings(): ReadonlyMap<
  string,
  StudioCommandExecutionBinding
> {
  return bindingsSnapshot;
}

/** Test-only reset; product code installs and disposes through the host effect above. */
export function resetStudioCommandExecutionBindingsForTests(): void {
  activeInstallation = null;
  bindingsSnapshot = EMPTY_BINDINGS;
  emit();
}
