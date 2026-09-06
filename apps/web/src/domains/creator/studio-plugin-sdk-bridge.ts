/**
 * Studio Plugin Extension SDK & Runtime Bridge — 외부 개발자 플러그인,
 * 커스텀 도구/필터/인스펙터 패널 확장, 샌드박스 권한 게이트 및 IPC 브릿지 코어.
 *
 * 마스터플랜 15.3 (Plugin SDK), 15.4 (Embedded Editor SDK), 30장 생태계 & 997개 기능 갭:
 * - 플러그인 매니페스트(Plugin Manifest) 정의 및 버전/작성자/아이콘
 * - 세분화된 보안 권한(Permissions: Canvas Read/Write, Layer Manage, Export Hook, Network)
 * - 기여 포인트(Contribution Points): 커스텀 도구, 필터, 인스펙터 사이드 패널
 * - 플러그인 생명주기 이벤트(onActivate, onDeactivate, onBeforeExport, onSelectionChange) 디스패치
 * - 안전한 샌드박스 IPC 메시지 직렬화/역직렬화
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_PLUGIN_SDK_VERSION = 1 as const;

export const PLUGIN_PERMISSIONS = [
  "canvas:read",
  "canvas:write",
  "layers:manage",
  "export:hook",
  "ui:custom-panel",
  "network:fetch",
  "storage:local",
] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export const CONTRIBUTED_TOOL_TYPES = [
  "brush",
  "filter",
  "generator",
  "exporter",
  "utility",
] as const;
export type ContributedToolType = (typeof CONTRIBUTED_TOOL_TYPES)[number];

export interface ContributedTool {
  readonly id: string;
  readonly name: string;
  readonly type: ContributedToolType;
  readonly iconName: string;
  readonly defaultShortcut?: string;
}

export interface ContributedPanel {
  readonly id: string;
  readonly title: string;
  readonly location: "left-dock" | "right-inspector" | "floating";
}

export interface StudioPluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly author: string;
  readonly description: string;
  readonly permissions: readonly PluginPermission[];
  readonly contributedTools?: readonly ContributedTool[];
  readonly contributedPanels?: readonly ContributedPanel[];
  readonly entrypointUri: string;
}

export interface StudioPluginRegistry {
  readonly version: typeof STUDIO_PLUGIN_SDK_VERSION;
  readonly plugins: readonly StudioPluginManifest[];
  readonly activePluginIds: readonly string[];
}

export type PluginLifecycleEventName =
  | "onActivate"
  | "onDeactivate"
  | "onBeforeExport"
  | "onAfterExport"
  | "onSelectionChange"
  | "onStrokeDrawn";

export interface PluginBridgeMessage {
  readonly pluginId: string;
  readonly type: "event" | "command-request" | "command-response" | "error";
  readonly action: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlationId?: string;
  readonly timestampMs: number;
}

export function createPluginRegistry(params: {
  plugins?: readonly StudioPluginManifest[];
  activePluginIds?: readonly string[];
} = {}): StudioPluginRegistry {
  return Object.freeze({
    version: STUDIO_PLUGIN_SDK_VERSION,
    plugins: Object.freeze([...(params.plugins ?? [])]),
    activePluginIds: Object.freeze([...(params.activePluginIds ?? [])]),
  });
}

export function registerPluginManifest(
  registry: StudioPluginRegistry,
  manifest: StudioPluginManifest,
): StudioPluginRegistry {
  if (registry.plugins.some((p) => p.id === manifest.id)) {
    throw new Error(`Plugin ${manifest.id} is already registered`);
  }
  return {
    ...registry,
    plugins: Object.freeze([...registry.plugins, manifest]),
  };
}

export function activatePlugin(
  registry: StudioPluginRegistry,
  pluginId: string,
): StudioPluginRegistry {
  if (!registry.plugins.some((p) => p.id === pluginId)) {
    throw new Error(`Plugin ${pluginId} not found`);
  }
  if (registry.activePluginIds.includes(pluginId)) {
    return registry;
  }
  return {
    ...registry,
    activePluginIds: Object.freeze([...registry.activePluginIds, pluginId]),
  };
}

export function deactivatePlugin(
  registry: StudioPluginRegistry,
  pluginId: string,
): StudioPluginRegistry {
  return {
    ...registry,
    activePluginIds: Object.freeze(
      registry.activePluginIds.filter((id) => id !== pluginId),
    ),
  };
}

/**
 * 플러그인이 특정 작업 권한을 보유하고 있는지 엄격히 검증한다.
 */
export function checkPluginPermission(
  manifest: StudioPluginManifest,
  permission: PluginPermission,
): boolean {
  return manifest.permissions.includes(permission);
}

/**
 * 활성 플러그인들을 대상으로 생명주기 이벤트 메시지 브로드캐스트 목록을 생성한다.
 */
export function dispatchPluginLifecycleEvent(
  registry: StudioPluginRegistry,
  eventName: PluginLifecycleEventName,
  payload: Readonly<Record<string, unknown>>,
  nowMs: number,
): readonly PluginBridgeMessage[] {
  const activePlugins = registry.plugins.filter((p) =>
    registry.activePluginIds.includes(p.id),
  );

  return Object.freeze(
    activePlugins.map((plugin) =>
      Object.freeze({
        pluginId: plugin.id,
        type: "event" as const,
        action: eventName,
        payload: Object.freeze({ ...payload }),
        timestampMs: nowMs,
      }),
    ),
  );
}

/**
 * 호스트와 샌드박스 워커 간 IPC 메시지 직렬화/역직렬화 검증.
 */
export function serializeBridgeMessage(msg: PluginBridgeMessage): string {
  return JSON.stringify(msg);
}

export function deserializeBridgeMessage(rawJson: string): PluginBridgeMessage {
  const parsed = JSON.parse(rawJson) as PluginBridgeMessage;
  if (!parsed.pluginId || !parsed.type || !parsed.action) {
    throw new Error("Invalid plugin bridge message format");
  }
  return Object.freeze(parsed);
}
