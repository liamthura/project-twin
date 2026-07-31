/**
 * Segmented code entry, over the headless `input-otp` package.
 *
 * Adapted from shadcn's component rather than installed through it: this
 * project has no `components.json`, and `shadcn init` would rewrite
 * tailwind.config.js and the global stylesheet to add one control. The classes
 * below are therefore MyGist's tokens -- `border`, `card`, `ring`, `--radius`
 * -- not shadcn's defaults, which is the standing rule for anything adopted
 * from a registry.
 *
 * The dependency is deliberate and worth naming: it is headless, brings no
 * styling and no transitive packages, and owns the parts that are tedious and
 * easy to get subtly wrong -- caret movement between slots, paste across them,
 * backspace at a boundary, and mobile keyboards.
 */
import * as React from "react";
import { OTPInput, OTPInputContext } from "input-otp";
import { Minus } from "lucide-react";

import { cn } from "@/lib/utils";

const InputOTP = React.forwardRef(({ className, containerClassName, ...props }, ref) => (
  <OTPInput
    ref={ref}
    containerClassName={cn(
      "flex items-center gap-2 has-[:disabled]:opacity-50",
      containerClassName,
    )}
    className={cn("disabled:cursor-not-allowed", className)}
    {...props}
  />
));
InputOTP.displayName = "InputOTP";

const InputOTPGroup = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center gap-1.5", className)} {...props} />
));
InputOTPGroup.displayName = "InputOTPGroup";

const InputOTPSlot = React.forwardRef(({ index, className, ...props }, ref) => {
  const inputOTPContext = React.useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = inputOTPContext.slots[index];

  return (
    <div
      ref={ref}
      // Mono so the characters sit on a common width -- a code is read back
      // character by character, and a proportional font makes that harder than
      // it needs to be.
      className={cn(
        "relative flex h-11 w-9 items-center justify-center rounded-md border border-input",
        "bg-muted/30 font-mono text-base uppercase transition-colors",
        isActive && "z-10 bg-background ring-2 ring-ring ring-offset-1 ring-offset-background",
        className,
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-caret-blink bg-foreground duration-1000" />
        </div>
      )}
    </div>
  );
});
InputOTPSlot.displayName = "InputOTPSlot";

const InputOTPSeparator = React.forwardRef(({ ...props }, ref) => (
  <div ref={ref} role="separator" {...props}>
    <Minus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  </div>
));
InputOTPSeparator.displayName = "InputOTPSeparator";

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };
