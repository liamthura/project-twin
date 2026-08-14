/**
 * One form field: its label, its control, its help line and its error.
 *
 * The point is the ARIA wiring. Every auth screen used to write
 * `aria-describedby` by hand, which means each one could be right or wrong
 * independently -- and `landing/WaitlistForm.jsx` was the only one that
 * bothered. Here it is computed once, from knowledge of which lines actually
 * rendered.
 *
 * Children are a FUNCTION, given the props to spread onto the control:
 *
 *   <Field id="password" label="Password" error={errors.password}>
 *     {(control) => <Input {...control} type="password" value={…} />}
 *   </Field>
 *
 * The alternative -- Field cloning its child to inject props -- breaks on any
 * control that does something of its own with them, and the alternative to that
 * -- a context the control has to opt into -- cannot be used with a plain
 * <Input> at all.
 *
 * Adapted from shadcn's `field` registry item rather than copied: that version
 * is 248 lines of Tailwind v4 selectors (`nth-last-2:`, `@md/field-group:`,
 * `has-data-[state=checked]:`) and this project is on Tailwind 3.4.
 */
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

export function Field({ id, label, description, error, className, children }) {
  const invalid = typeof error === "string" && error.length > 0;
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;

  const control = {
    id,
    "aria-invalid": invalid || undefined,
    // One id, not both. Screen readers read the whole list, and hearing the
    // help text again after the error is what makes people stop listening to
    // the end of it.
    "aria-describedby": invalid ? errorId : description ? descriptionId : undefined,
  };

  return (
    <div className={cn("space-y-1.5", className)} data-invalid={invalid || undefined}>
      <Label
        htmlFor={id}
        className={cn("text-xs font-medium", invalid && "text-destructive")}
      >
        {label}
      </Label>
      {children(control)}
      {description && (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {invalid && (
        // role=alert so the message is announced where it appears. Without it a
        // blur that produces an error is silent until focus happens to land on
        // the field again.
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
