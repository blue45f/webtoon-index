import type { ReactElement } from "react";

/**
 * Declarative URL contract owned by the application layer.
 *
 * Domain route groups provide only match metadata and a lazy page element. The root router owns
 * React Router's `<Route>` components and all cross-domain boundaries, which keeps URL ownership
 * searchable without spreading router lifecycle concerns through feature modules.
 */
export interface AppRouteDefinition {
  readonly id: string;
  readonly path: string;
  readonly element: ReactElement;
}

export function defineAppRoutes<const TRoutes extends readonly AppRouteDefinition[]>(
  routes: TRoutes,
): TRoutes {
  return routes;
}
