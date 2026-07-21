import { cn } from "@/lib/utils";

export function Switch({ checked, onCheckedChange, className, ...props }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "tap-target relative h-5 w-9 shrink-0 rounded-full transition-colors",
        checked ? "bg-primary" : "border bg-muted",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "absolute left-0 top-[2px] h-4 w-4 rounded-full border bg-card transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[2px]"
        )}
      />
    </button>
  );
}
