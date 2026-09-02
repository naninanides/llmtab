import type { ReactNode } from "react";

export function Bevel({
  inset,
  className = "",
  children,
  ...rest
}: {
  inset?: boolean;
  className?: string;
  children?: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div className={`${inset ? "bevel-in" : "bevel"} ${className}`} {...rest}>
      {children}
    </div>
  );
}
