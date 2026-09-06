/**
 * rbush 4.0.1 ships JavaScript only and does not declare a `types` export.
 * Keep this deliberately small declaration aligned with the public v4 API used
 * by the renderer-neutral Studio spatial-index boundary.
 */
declare module "rbush" {
  export interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }

  export type EqualsFunction<T> = (left: T, right: T) => boolean;

  export default class RBush<T extends BBox = BBox> {
    constructor(maxEntries?: number);

    all(): T[];
    search(bbox: BBox): T[];
    collides(bbox: BBox): boolean;
    load(data: T[]): this;
    insert(item: T): this;
    clear(): this;
    remove(item: T, equalsFunction?: EqualsFunction<T>): this;
  }
}
