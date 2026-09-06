import * as React from "react";

import { cn } from "@/shared/lib/utils";

// 최소 Slot — 단일 자식에 props/className 병합 (asChild 패턴)
export function Slot({
  children,
  className,
  ...props
}: { children?: React.ReactNode; className?: string } & Record<string, unknown>) {
  if (!React.isValidElement(children)) return null;
  const child = children as React.ReactElement<Record<string, unknown>>;
  const childProps = child.props;
  return React.cloneElement(child, {
    ...props,
    ...childProps,
    className: cn(className, childProps.className as string | undefined),
  });
}
