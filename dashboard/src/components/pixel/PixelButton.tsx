import type { ReactNode } from "react";

export function PixelButton({
  variant = "default",
  className = "",
  children,
  ...rest
}: {
  variant?: "default" | "primary";
  className?: string;
  children?: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>): ReactNode {
  const base =
    "px-[11px] py-[6px] inline-flex items-center gap-[6px] font-silkscreen text-[9px] tracking-[0.06em] shadow-[inset_0_3px_0_0_var(--lit),inset_3px_0_0_0_var(--lit),inset_0_-3px_0_0_var(--shade),inset_-3px_0_0_0_var(--shade)] active:shadow-[inset_0_3px_0_0_var(--shade),inset_3px_0_0_0_var(--shade),inset_0_-3px_0_0_var(--lit),inset_-3px_0_0_0_var(--lit)]";
  const variantCls = variant === "primary" ? "bg-amber text-rail" : "bg-panel text-bone";
  return (
    <button className={`${base} ${variantCls} ${className}`} {...rest}>
      {children}
    </button>
  );
}
