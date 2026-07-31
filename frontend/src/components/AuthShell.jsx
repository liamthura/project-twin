/**
 * The frame around anything shown to someone who is not yet through the door:
 * the welcome screen, and the reset-password screen a link drops them on.
 *
 * Extracted when the second one arrived. Both are full-page, both are the only
 * thing on screen, and both are the first impression of the product -- a reset
 * screen that looked like a different application would be the moment someone
 * decides the link was phishing.
 */
export function AuthShell({ title, description, children }) {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
            <svg
              width="40"
              height="40"
              viewBox="0 0 96 96"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <circle
                cx="45"
                cy="40"
                r="15"
                fill="none"
                stroke="hsl(var(--primary-foreground))"
                strokeWidth="9"
              />
              <path
                d="M60 40 v22 a14 14 0 0 1 -14 14 h-9"
                fill="none"
                stroke="hsl(var(--primary-foreground))"
                strokeWidth="9"
                strokeLinecap="round"
              />
            </svg>
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
