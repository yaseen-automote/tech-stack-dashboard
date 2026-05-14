import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SearchInputProps = {
  className?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: () => void;
  isLoading?: boolean;
  buttonLabel?: string;
  placeholder?: string;
  errorMessage?: string | null;
  label?: string;
  hint?: string;
  variant?: "default" | "hero";
  inputId?: string;
  errorId?: string;
  formAriaLabel?: string;
};

export function SearchInput({
  className,
  value,
  onValueChange,
  onSubmit,
  isLoading = false,
  buttonLabel = "Lookup",
  placeholder = "Search a domain, technology, or company",
  errorMessage,
  label = "Search or inspect a domain",
  hint = "Enter an apex domain to discover subdomain infrastructure. Press Enter or click Lookup.",
  variant = "default",
  inputId = "search-intelligence",
  errorId = "search-intelligence-feedback",
  formAriaLabel = "Subdomain lookup",
}: SearchInputProps) {
  const handleSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      onSubmit?.();
    },
    [onSubmit],
  );

  const isHero = variant === "hero";
  const hasValue = Boolean(value?.trim());

  return (
    <form
      role="search"
      aria-label={formAriaLabel}
      className={cn("w-full", className)}
      onSubmit={handleSubmit}
    >
      <label
        htmlFor={inputId}
        className={cn(
          "block font-medium text-foreground",
          isHero ? "mb-3 text-base font-semibold tracking-tight sm:text-lg" : "mb-2 text-sm",
        )}
      >
        {label}
      </label>

      <div className={cn("flex gap-3", isHero ? "flex-col min-[520px]:flex-row min-[520px]:items-center" : "items-center")}>
        <div
          className={cn(
            "relative min-w-0 flex-1 transition-colors duration-200",
            isHero ? "rounded-xl border bg-background" : "rounded-md border bg-[#0d0d0d]",
            errorMessage
              ? "border-destructive ring-1 ring-destructive/20"
              : "border-border focus-within:border-foreground/30 focus-within:ring-1 focus-within:ring-foreground/10",
          )}
        >
          <input
            id={inputId}
            type="search"
            value={value}
            onChange={(e) => onValueChange?.(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={errorMessage ? true : undefined}
            aria-describedby={
              errorMessage ? errorId : hint ? `${inputId}-hint` : undefined
            }
            className={cn(
              "w-full min-w-0 bg-transparent text-foreground outline-none transition-colors placeholder:text-muted-foreground",
              isHero
                ? "h-12 rounded-xl px-4 pr-12 text-base font-medium sm:h-14 sm:px-5 sm:pr-14"
                : "h-11 rounded-md px-4 text-sm",
            )}
          />
          {hasValue ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onValueChange?.("")}
              className={cn(
                "absolute right-3 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isHero ? "size-9" : "size-8",
              )}
            >
              <X className={isHero ? "size-4" : "size-3.5"} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <Button
          type="submit"
          variant="secondary"
          disabled={isLoading}
          className={cn(
            "shrink-0 text-foreground transition-colors",
            isHero
              ? "h-12 w-full rounded-xl border border-border bg-surface-subtle hover:bg-surface px-6 text-base font-medium min-[520px]:h-14 min-[520px]:w-auto min-[520px]:min-w-[130px]"
              : "h-11 rounded-md border border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#3a3a3a] hover:bg-[#252525] px-5 text-sm font-medium",
          )}
        >
          {isLoading ? "Scanning…" : buttonLabel}
        </Button>
      </div>

      {errorMessage ? (
        <p id={errorId} className={cn("mt-3 text-destructive", isHero ? "text-sm" : "text-xs")}>
          {errorMessage}
        </p>
      ) : hint ? (
        <p
          id={`${inputId}-hint`}
          className={cn(
            "text-muted-foreground",
            isHero ? "mt-3 text-sm leading-6" : "mt-2 text-xs",
          )}
        >
          {hint}
        </p>
      ) : null}
    </form>
  );
}
