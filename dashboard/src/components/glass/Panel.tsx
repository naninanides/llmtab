import type { ReactNode } from "react";

export type Material = "thin" | "regular" | "thick" | "hud";

const MATERIAL: Record<Material, string> = {
  thin: "glass-thin",
  regular: "glass",
  thick: "glass-thick",
  hud: "glass-hud",
};

/**
 * The panel material. `material` picks the tier — thin for nested surfaces,
 * regular for cards, thick for the piece the eye should land on first, hud for
 * floating chrome. Blur and hairlines come from theme.css so every panel reads
 * as one system.
 */
export function Panel({
  material = "regular",
  className = "",
  children,
  ...rest
}: {
  material?: Material;
  className?: string;
  children?: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div className={`${MATERIAL[material]} rounded-panel ${className}`} {...rest}>
      {children}
    </div>
  );
}
