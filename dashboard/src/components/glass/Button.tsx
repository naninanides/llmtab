import type { ReactNode } from "react";

/**
 * Primary carries the accent fill; default is a thin-material control. Both
 * keep a visible focus ring — the popover is fully keyboard operable.
 */
export function Button({
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
    "px-[13px] py-[7px] inline-flex items-center justify-center gap-[6px] rounded-control " +
    "text-[12px] font-medium transition-colors duration-100 motion-reduce:transition-none " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-2";
  const variantCls =
    variant === "primary"
      ? "bg-accent text-[#04140e] border border-transparent hover:brightness-110"
      : "glass-thin text-text-1 hover:bg-mat-thick";
  return (
    <button className={`${base} ${variantCls} ${className}`} {...rest}>
      {children}
    </button>
  );
}
