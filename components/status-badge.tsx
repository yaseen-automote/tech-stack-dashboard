import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
};

const toneClassName = {
  neutral: "border-border bg-surface text-muted-foreground",
  success: "border-white/35 bg-white/10 text-white",
  warning: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  danger: "border-destructive/35 bg-destructive/10 text-destructive",
};

export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  const accentColor = tone === "success" ? "#0070f3" : undefined;

  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1 rounded-md border px-2 text-xs font-medium",
        toneClassName[tone],
      )}
      data-accent-color={accentColor}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
