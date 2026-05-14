import { cn } from "@/lib/utils";

type SectionHeaderProps = {
  title: string;
  eyebrow?: string;
  action?: React.ReactNode;
  className?: string;
};

export function SectionHeader({
  title,
  eyebrow,
  action,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="truncate text-sm font-semibold text-foreground">
          {title}
        </h2>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
