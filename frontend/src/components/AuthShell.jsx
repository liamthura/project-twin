/**
 * The frame around anything shown to someone who is not yet through the door:
 * the sign-in card in its four states, the reset-password screen a link drops
 * them on, and the OAuth consent screen.
 *
 * Extracted when the second one arrived. All of them are full-page, all of them
 * are the only thing on screen, and all of them are the first impression of the
 * product -- a reset screen that looked like a different application would be
 * the moment someone decides the link was phishing.
 *
 * The heading is the caller's, and it is expected to change: WelcomeAuth passes
 * a different one for each of sign in, sign up, forgot and the invite gate.
 */
import { Mark } from "@/landing/Brand";

export function AuthShell({ title, description, children }) {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      {/* 400px is the prototype's auth card. max-w-sm, which this was, is 384. */}
      <div className="w-full max-w-[400px] space-y-6 text-center">
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
            <Mark className="h-10 w-10 text-primary-foreground" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
