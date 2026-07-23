import { cn } from "@/lib/utils";

export function EmptyState({ children, className }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  );
}
