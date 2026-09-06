/**
 * Studio 3D Scene Dependency Graph
 *
 * 오브젝트 수정 시 영향 받는 Shot/패스만 선택적으로 갱신하는
 * Dependency Graph 및 Dirty Propagation 시스템입니다.
 *
 * 설계서 참조: §4.2 단일 진실 공급원 원칙, §DOC-003
 */

export type NodeType =
  | "geometry"
  | "material"
  | "camera"
  | "light"
  | "rig"
  | "modifier"
  | "shot"
  | "toon-pass"
  | "linked-ink"
  | "render-cache";

export interface DependencyNode {
  id: string;
  type: NodeType;
  name: string;
  dirty: boolean;
  revision: number;
  dependsOn: Set<string>; // 이 노드가 의존하는 노드 ID들
  dependents: Set<string>; // 이 노드에 의존하는 노드 ID들
}

export class Studio3DSceneDependencyGraph {
  private nodes = new Map<string, DependencyNode>();

  public addNode(id: string, type: NodeType, name: string): DependencyNode {
    if (!id.trim()) throw new Error("의존성 노드 ID는 비어 있을 수 없습니다.");
    if (this.nodes.has(id)) throw new Error(`중복 의존성 노드 ID: ${id}`);
    const node: DependencyNode = {
      id,
      type,
      name,
      dirty: false,
      revision: 0,
      dependsOn: new Set(),
      dependents: new Set(),
    };
    this.nodes.set(id, node);
    return this.cloneNode(node);
  }

  public removeNode(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    // 의존 관계 정리
    for (const depId of node.dependsOn) {
      const dep = this.nodes.get(depId);
      if (dep) dep.dependents.delete(id);
    }
    for (const depId of node.dependents) {
      const dep = this.nodes.get(depId);
      if (dep) dep.dependsOn.delete(id);
    }
    return this.nodes.delete(id);
  }

  /**
   * source → target 의존 관계를 추가합니다.
   * target이 source에 의존합니다 (source가 변경되면 target도 dirty).
   */
  public addDependency(sourceId: string, targetId: string): boolean {
    const source = this.nodes.get(sourceId);
    const target = this.nodes.get(targetId);
    if (!source || !target) return false;

    // 순환 의존성 검사
    if (this.wouldCreateCycle(sourceId, targetId)) return false;

    source.dependents.add(targetId);
    target.dependsOn.add(sourceId);
    return true;
  }

  public removeDependency(sourceId: string, targetId: string): boolean {
    const source = this.nodes.get(sourceId);
    const target = this.nodes.get(targetId);
    if (!source || !target) return false;

    const removedFromSource = source.dependents.delete(targetId);
    const removedFromTarget = target.dependsOn.delete(sourceId);
    return removedFromSource && removedFromTarget;
  }

  /**
   * 노드를 dirty로 마킹하고 영향 받는 모든 하류 노드를 전파합니다.
   */
  public markDirty(id: string): string[] {
    const dirtyNodes: string[] = [];
    const queue = [id];
    const visited = new Set<string>();

    for (let cursor = 0; cursor < queue.length; cursor++) {
      const currentId = queue[cursor];
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const node = this.nodes.get(currentId);
      if (!node) continue;

      node.dirty = true;
      node.revision++;
      dirtyNodes.push(currentId);

      for (const depId of node.dependents) {
        if (!visited.has(depId)) queue.push(depId);
      }
    }

    return dirtyNodes;
  }

  /**
   * dirty 상태를 해제합니다 (갱신 완료 시).
   */
  public clearDirty(id: string): void {
    const node = this.nodes.get(id);
    if (node) node.dirty = false;
  }

  public clearAllDirty(): void {
    for (const node of this.nodes.values()) {
      node.dirty = false;
    }
  }

  /**
   * dirty 상태인 모든 노드를 반환합니다.
   */
  public getDirtyNodes(): DependencyNode[] {
    return [...this.nodes.values()].filter((n) => n.dirty).map((node) => this.cloneNode(node));
  }

  /**
   * 특정 타입의 dirty 노드만 반환합니다.
   */
  public getDirtyNodesByType(type: NodeType): DependencyNode[] {
    return [...this.nodes.values()]
      .filter((n) => n.dirty && n.type === type)
      .map((node) => this.cloneNode(node));
  }

  /**
   * 노드의 모든 상류(upstream) 의존성을 반환합니다.
   */
  public getUpstream(id: string): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const queue = [id];

    for (let cursor = 0; cursor < queue.length; cursor++) {
      const currentId = queue[cursor];
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const node = this.nodes.get(currentId);
      if (!node) continue;

      if (currentId !== id) result.push(currentId);
      for (const depId of node.dependsOn) {
        if (!visited.has(depId)) queue.push(depId);
      }
    }

    return result;
  }

  /**
   * 노드의 모든 하류(downstream) 의존성을 반환합니다.
   */
  public getDownstream(id: string): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const queue = [id];

    for (let cursor = 0; cursor < queue.length; cursor++) {
      const currentId = queue[cursor];
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const node = this.nodes.get(currentId);
      if (!node) continue;

      if (currentId !== id) result.push(currentId);
      for (const depId of node.dependents) {
        if (!visited.has(depId)) queue.push(depId);
      }
    }

    return result;
  }

  public getNode(id: string): DependencyNode | undefined {
    const node = this.nodes.get(id);
    return node ? this.cloneNode(node) : undefined;
  }

  public getAllNodes(): DependencyNode[] {
    return [...this.nodes.values()].map((node) => this.cloneNode(node));
  }

  /**
   * 순환 의존성을 감지합니다.
   */
  private wouldCreateCycle(sourceId: string, targetId: string): boolean {
    // target에서 source로 도달 가능한지 확인 (있으면 순환)
    const visited = new Set<string>();
    const queue = [targetId];

    for (let cursor = 0; cursor < queue.length; cursor++) {
      const currentId = queue[cursor];
      if (currentId === sourceId) return true;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const node = this.nodes.get(currentId);
      if (!node) continue;
      for (const depId of node.dependents) {
        if (!visited.has(depId)) queue.push(depId);
      }
    }

    return false;
  }

  private cloneNode(node: DependencyNode): DependencyNode {
    return {
      ...node,
      dependsOn: new Set(node.dependsOn),
      dependents: new Set(node.dependents),
    };
  }
}
