# Auth Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish slice 5 of the app-migration umbrella — per-field validation on the auth screens, a card heading that follows the card's state, and Consent's grant rows as checkboxes.

**Architecture:** A `Field` component owns the label/control/description/error group and its ARIA wiring, so no screen wires `aria-describedby` by hand. A pure `authValidation.js` holds every message, tested without a DOM. `WelcomeAuth` takes over rendering `AuthShell` so its heading can change with its mode. Nothing server-side moves.

**Tech Stack:** React 18, Tailwind 3.4 (`tailwindcss-animate` only), Radix primitives, Vitest with two projects (`unit` in jsdom, `storybook` in headless chromium), `@testing-library/react` + `@testing-library/user-event`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-14-auth-slice-design.md`. Every ruling in it is binding.
- **Tailwind 3.4.** No `@container`, no `nth-last-2:`, no `has-data-*` shorthand. `aria-invalid` is not a built-in variant — write `aria-[invalid=true]:`.
- **React 18, JSX not TSX.** Registry components are adapted by hand, not copied.
- **Copy follows `/no-ai-slop`.** Say what is true, no overstatement, British English.
- **`overrides` in `frontend/package.json` is not touched.** Removing it lets `@radix-ui/react-primitive` duplicate, which is what broke dropdown dismissal in 5a.
- **Existing tests stay green.** 70 across the four auth test files, 5 in `App.onboarding.test.jsx`.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Run the suite as** `npm test -- --project unit` from `frontend/`. A single file: `npm test -- --project unit src/path/to/file.test.jsx`.
- **All work on branch `design/auth-slice`.** Do not commit to `main`.

---

### Task 1: The Field component

**Files:**
- Create: `frontend/src/components/ui/field.jsx`
- Modify: `frontend/src/components/ui/input.jsx:9`
- Test: `frontend/src/components/ui/field.test.jsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`, `Label` from `@/components/ui/label`.
- Produces: `<Field id label description error>{(control) => …}</Field>`. The
  render-prop argument is `{ id, "aria-invalid", "aria-describedby" }` — spread
  it onto the control. `aria-invalid` is `true` when `error` is a non-empty
  string and absent otherwise. `aria-describedby` names the error element when
  there is an error, the description element when there is a description and no
  error, and is absent when there is neither.

Children are a function, not elements. That is what lets `Field` compute
`aria-describedby` knowing exactly which of the two lines it actually rendered —
a context-and-registration version would be longer and a cloning version would
break on any control that forwards props oddly.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/ui/field.test.jsx`:

```jsx
// The Field kit's whole job is the wiring a screen reader depends on and a
// sighted reader never sees. Each test below is one thing that was previously
// hand-written per field, and therefore one thing that was previously possible
// to get wrong in one place and not another.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "./field";
import { Input } from "./input";

const renderField = (props) =>
  render(
    <Field id="thing" label="Thing" {...props}>
      {(control) => <Input {...control} />}
    </Field>,
  );

describe("Field", () => {
  it("labels the control, so getByLabelText finds it", () => {
    renderField();
    expect(screen.getByLabelText("Thing")).toBeInTheDocument();
  });

  it("says nothing about validity when there is no error", () => {
    renderField();
    const input = screen.getByLabelText("Thing");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("points the control at its description", () => {
    renderField({ description: "Some help." });
    const input = screen.getByLabelText("Thing");
    expect(input).toHaveAccessibleDescription("Some help.");
  });

  it("marks the control invalid and points it at the message", () => {
    renderField({ error: "That is wrong." });
    const input = screen.getByLabelText("Thing");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("That is wrong.");
  });

  it("announces the error, so it is heard without moving focus", () => {
    renderField({ error: "That is wrong." });
    expect(screen.getByRole("alert")).toHaveTextContent("That is wrong.");
  });

  it("describes by the error rather than the help when both are present", () => {
    // Both would be defensible. The error is chosen because it is the newer
    // information and the one that has to be acted on; the help line is still
    // on screen for anyone reading.
    renderField({ description: "Some help.", error: "That is wrong." });
    expect(screen.getByLabelText("Thing")).toHaveAccessibleDescription("That is wrong.");
  });

  it("renders no alert when the error is empty rather than absent", () => {
    // A validator returning "" is a bug in the validator, not a message.
    renderField({ error: "" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Thing")).not.toHaveAttribute("aria-invalid");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npm test -- --project unit src/components/ui/field.test.jsx`
Expected: FAIL — `Failed to resolve import "./field"`.

- [ ] **Step 3: Write the component**

`frontend/src/components/ui/field.jsx`:

```jsx
/**
 * One form field: its label, its control, its help line and its error.
 *
 * The point is the ARIA wiring. Every auth screen used to write
 * `aria-describedby` by hand, which means each one could be right or wrong
 * independently -- and `landing/WaitlistForm.jsx` was the only one that bothered.
 * Here it is computed once, from knowledge of which lines actually rendered.
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
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd frontend && npm test -- --project unit src/components/ui/field.test.jsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Give an invalid Input a red border**

In `frontend/src/components/ui/input.jsx`, append to the class string inside
`cn(...)` on line 9, immediately before `className`:

```js
"aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive",
```

`aria-[invalid=true]:` rather than `aria-invalid:` — Tailwind 3.4's built-in
`aria-*` variants do not include `invalid`, so the shorthand silently produces
no CSS.

- [ ] **Step 6: Prove that class is real, not just plausible**

Tailwind generating nothing for an unrecognised variant is a silent failure, so
check the built stylesheet rather than trusting the source.

Run:
```bash
cd frontend && npx tailwindcss -i src/index.css -o /tmp/field-check.css 2>/dev/null \
  && grep -c 'aria-\\\[invalid' /tmp/field-check.css
```
Expected: a count of 2 or more. If it is 0, the variant did not compile — do not
proceed.

Note the triple backslash: Tailwind escapes `[` in the emitted selector, and a
naive `grep -F 'aria-[invalid'` matches nothing even when the CSS is correct.

- [ ] **Step 7: Run the whole unit suite**

Run: `cd frontend && npm test -- --project unit`
Expected: PASS. Nothing consumes `Field` yet, and the `Input` change is additive.

- [ ] **Step 8: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add frontend/src/components/ui/field.jsx frontend/src/components/ui/field.test.jsx frontend/src/components/ui/input.jsx
git commit -F - <<'EOF'
feat(ui): a Field that wires its own error to its own control

Every auth screen wrote aria-describedby by hand, so each one could be right
or wrong on its own -- and only the landing page's waitlist form bothered.
Field computes it from which lines it actually rendered, and gives the message
role=alert so a blur that fails is announced where it happens.

Adapted from shadcn's field rather than copied: that one is 248 lines of
Tailwind v4 selectors this project cannot compile.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The validation rules, as a pure module

**Files:**
- Create: `frontend/src/lib/authValidation.js`
- Test: `frontend/src/lib/authValidation.test.js`

**Interfaces:**
- Consumes: `looksLikeEmail` from `@/lib/session.js` (a pure regex test; that
  module has no side effects at module scope, so a node-environment test can
  import it).
- Produces, each returning a message string or `null`:
  - `MIN_PASSWORD_LENGTH` — `8`
  - `validateUsername(value, { acceptsEmail })`
  - `validatePassword(value, { isNew })`
  - `validateConfirmPassword(value, password)`
  - `validateResetEmail(value)`
  - `validateServerUrl(value)`

The invite code is deliberately **not** here. Its check is a pre-flight before a
network call rather than a blur rule (`InviteGate.jsx:73`), it needs
`INVITE_LENGTH`, and the field auto-submits when the last cell is filled — there
is no blur to validate on. It stays where it is.

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/authValidation.test.js`:

```js
// @vitest-environment node
//
// No DOM: these are strings in and strings out. Run in node so a rule cannot
// accidentally come to depend on one.
import { describe, it, expect } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  validateUsername,
  validatePassword,
  validateConfirmPassword,
  validateResetEmail,
  validateServerUrl,
} from "./authValidation.js";

describe("validateUsername", () => {
  it("accepts something typed", () => {
    expect(validateUsername("liamthura")).toBeNull();
  });

  it.each([[""], ["   "], [undefined], [null]])("asks for one when given %s", (value) => {
    expect(validateUsername(value)).toBe("Enter a username.");
  });

  it("names both identifiers where both are accepted", () => {
    // Sign-in takes either; sign-up and detached mode take a username only.
    // The message has to match the label above it or one of the two is lying.
    expect(validateUsername("", { acceptsEmail: true })).toBe("Enter a username or email.");
  });

  it("does not check the shape of what was typed", () => {
    // Whether an identifier exists is the server's answer, not this function's.
    expect(validateUsername("not an email@", { acceptsEmail: true })).toBeNull();
  });
});

describe("validatePassword", () => {
  it("accepts an existing password of any length", () => {
    // Signing in with an old short password must still be possible. A length
    // rule applied here would lock out any account that predates the rule.
    expect(validatePassword("abc")).toBeNull();
  });

  it.each([[""], [undefined], [null]])("asks for one when given %s", (value) => {
    expect(validatePassword(value)).toBe("Enter a password.");
  });

  it("holds a new password to the minimum", () => {
    expect(validatePassword("abc", { isNew: true })).toBe(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  });

  it("accepts a new password at exactly the minimum", () => {
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH), { isNew: true })).toBeNull();
  });

  it("does not trim a password", () => {
    // Spaces are characters. Trimming here would accept a password the server
    // then rejects, or worse, quietly change the one being set.
    expect(validatePassword("   ", { isNew: false })).toBeNull();
  });
});

describe("validateConfirmPassword", () => {
  it("accepts a match", () => {
    expect(validateConfirmPassword("a-good-password", "a-good-password")).toBeNull();
  });

  it("reports a mismatch", () => {
    expect(validateConfirmPassword("a-good-password", "a-good-passwerd")).toBe(
      "Passwords do not match.",
    );
  });

  it("asks for the field rather than calling an empty box a mismatch", () => {
    expect(validateConfirmPassword("", "a-good-password")).toBe("Re-enter your password.");
  });

  it("is quiet while there is nothing to match against", () => {
    // Blurring Confirm before Password is typed is not an error the reader
    // made, and a mismatch message there points at the wrong field.
    expect(validateConfirmPassword("", "")).toBeNull();
  });
});

describe("validateResetEmail", () => {
  it("accepts an address", () => {
    expect(validateResetEmail("someone@example.com")).toBeNull();
  });

  it("asks for one", () => {
    expect(validateResetEmail("  ")).toBe("Enter the email on your account.");
  });

  it("rejects something that is not an address", () => {
    // This field is email-only: a reset cannot be sent to a username, so
    // accepting one buys a round trip and a silent nothing.
    expect(validateResetEmail("liamthura")).toBe("That does not look like an email address.");
  });

  it("ignores surrounding space", () => {
    expect(validateResetEmail("  someone@example.com  ")).toBeNull();
  });
});

describe("validateServerUrl", () => {
  it("accepts a URL", () => {
    expect(validateServerUrl("https://mygist.example.com/api")).toBeNull();
  });

  it("asks for one", () => {
    expect(validateServerUrl("")).toBe("Server URL is required.");
  });

  it("does not judge the shape", () => {
    // The connection test is what finds out whether a URL works. Guessing here
    // would reject a hostname, a port, or a path someone is legitimately using.
    expect(validateServerUrl("localhost:8000")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npm test -- --project unit src/lib/authValidation.test.js`
Expected: FAIL — `Failed to resolve import "./authValidation.js"`.

- [ ] **Step 3: Write the module**

`frontend/src/lib/authValidation.js`:

```js
/**
 * What is wrong with one auth field, as a sentence, or null.
 *
 * Pure and DOM-free on purpose. These rules were previously five copies of an
 * if-chain inside two components' submit handlers, which is why the sign-up
 * form and the reset form disagreed about how to say the same thing.
 *
 * Two limits on what belongs here:
 *
 *   1. Shape only. Whether an account exists, whether a password is right,
 *      whether a server answers -- those are answers, they arrive after a round
 *      trip, and they belong on the form-level line.
 *   2. Nothing that would reject an input the server accepts. A length rule on
 *      an EXISTING password would lock out every account older than the rule;
 *      a URL pattern would reject a port or a path somebody is really using.
 */
import { looksLikeEmail } from "@/lib/session.js";

/** Matches MIN_PASSWORD_LENGTH in backend/main.py and Better Auth's own floor. */
export const MIN_PASSWORD_LENGTH = 8;

const isBlank = (value) => !String(value ?? "").trim();

/**
 * `acceptsEmail` follows the label: sign-in takes either identifier, sign-up
 * and detached mode take a username only. The message and the label have to
 * agree or one of them is lying.
 */
export function validateUsername(value, { acceptsEmail = false } = {}) {
  if (isBlank(value)) {
    return acceptsEmail ? "Enter a username or email." : "Enter a username.";
  }
  return null;
}

/** `isNew` is signing up or resetting; the minimum applies only then. */
export function validatePassword(value, { isNew = false } = {}) {
  if (!value) return "Enter a password.";
  if (isNew && value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/**
 * Silent while the password above is still empty: blurring Confirm first is not
 * a mistake anyone made, and a mismatch message there points at the wrong box.
 */
export function validateConfirmPassword(value, password) {
  if (!password) return null;
  if (!value) return "Re-enter your password.";
  if (value !== password) return "Passwords do not match.";
  return null;
}

/**
 * The forgot-password field, which is email-only -- unlike sign-in, a reset
 * cannot be sent to a username. `looksLikeEmail` is session.js's, so this
 * screen and the sign-in router cannot drift apart on what an address is.
 */
export function validateResetEmail(value) {
  if (isBlank(value)) return "Enter the email on your account.";
  if (!looksLikeEmail(value)) return "That does not look like an email address.";
  return null;
}

export function validateServerUrl(value) {
  if (isBlank(value)) return "Server URL is required.";
  return null;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd frontend && npm test -- --project unit src/lib/authValidation.test.js`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add frontend/src/lib/authValidation.js frontend/src/lib/authValidation.test.js
git commit -F - <<'EOF'
feat(auth): the field rules, in one place and testable without a DOM

Five copies of an if-chain across two submit handlers, which is how the
sign-up form and the reset form ended up phrasing the same failure two ways.

Two limits are load bearing rather than tidy: shape only, and nothing that
rejects an input the server accepts. A length rule on an existing password
would lock out every account older than the rule.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Delete the access-token link

**Files:**
- Modify: `frontend/src/components/WelcomeAuth.jsx:64` (signature), `:482-498` (the row)
- Modify: `frontend/src/App.jsx:104-109`, `:617-640`
- Test: `frontend/src/components/WelcomeAuth.test.jsx`

**Interfaces:**
- Produces: `WelcomeAuth` no longer accepts `onUseToken`. Its props become
  `{ onSuccess }` until task 4 adds `intent`.

Read the spec's correction section before starting. This deletion removes the
only first-run route to the token field, that is known, and the owner ruled it
acceptable.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/components/WelcomeAuth.test.jsx`:

```jsx
describe("what the sign-in screen no longer offers", () => {
  // Per the prototype's change 5: Better Auth supersedes the pasted token.
  // Asserted rather than assumed because deleting it also cost the first-run
  // route to the token field -- see the auth slice spec's correction section.
  // If that decision is ever revisited, this test is where it surfaces.
  it("does not offer a pasted access token", async () => {
    render(<WelcomeAuth onSuccess={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/username/i)).toBeInTheDocument());
    expect(screen.queryByText(/access token/i)).not.toBeInTheDocument();
  });

  it("still lets the server be changed, which shared that row", async () => {
    render(<WelcomeAuth onSuccess={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/username/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^Server:/ })).toBeInTheDocument();
  });
});
```

Check the top of that file for how it already renders `WelcomeAuth` and which
of `render`, `screen`, `waitFor` are imported; match it rather than adding a
second style.

- [ ] **Step 2: Run it and watch the first one fail**

Run: `cd frontend && npm test -- --project unit src/components/WelcomeAuth.test.jsx`
Expected: the "does not offer a pasted access token" test FAILS; the Server one
passes already.

- [ ] **Step 3: Delete the link**

In `frontend/src/components/WelcomeAuth.jsx`, change the signature on line 64:

```jsx
export function WelcomeAuth({ onSuccess }) {
```

Replace the whole block at `:482-498` with the Server toggle alone:

```jsx
      <div className="flex items-center justify-center border-t pt-3 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => setShowServer((v) => !v)}
          className="underline hover:text-foreground"
        >
          Server: {connectionType === "cloud" ? "Cloud" : "Self-hosted"}
        </button>
      </div>
```

The `gap-3` and the `&middot;` separator go with the second item.

- [ ] **Step 4: Run it and watch it pass**

Run: `cd frontend && npm test -- --project unit src/components/WelcomeAuth.test.jsx`
Expected: PASS, 32 tests.

- [ ] **Step 5: Drop the prop at both App call sites**

In `frontend/src/App.jsx`, at `:104-109`, delete the `onUseToken` prop and the
four-line comment above it that exists only to explain the no-op:

```jsx
        <WelcomeAuth
          onSuccess={() => {
```

At `:617-640`, delete `onUseToken` and the now-unreachable dialog. The `<>…</>`
fragment goes with it, since one child remains:

```jsx
        <WelcomeAuth
          onSuccess={({ isNew } = {}) => {
            // A brand-new account lands on Welcome, not on an empty Profile:
            // that is the moment intent is highest, and Welcome is where the
            // offer to hand the work to a client is made.
            if (isNew) navigate("onboarding", DEFAULT_ONBOARDING_STEP);
            loadAllData();
            loadSettings();
          }}
        />
```

- [ ] **Step 6: Confirm nothing else opened that dialog**

Run: `cd frontend && grep -n "onUseToken\|showConnectionSettings" src/App.jsx src/components/*.jsx`
Expected: no `onUseToken` anywhere. `showConnectionSettings` still appears — the
Connection Failed branch and the header use it. If it appears zero times, too
much was deleted; put the state back.

- [ ] **Step 7: Run the whole unit suite**

Run: `cd frontend && npm test -- --project unit`
Expected: PASS. `App.test.jsx` and `App.onboarding.test.jsx` are the ones at
risk here.

- [ ] **Step 8: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add frontend/src/components/WelcomeAuth.jsx frontend/src/components/WelcomeAuth.test.jsx frontend/src/App.jsx
git commit -F - <<'EOF'
feat(auth): the sign-in screen stops offering a pasted access token

The prototype's change 5, and Better Auth does supersede it. Deleting it also
leaves the settings dialog on the welcome branch with nothing to open it, so
that goes too.

Known cost, ruled acceptable by the owner and written down in the spec: a
first run with no account now has no way to enter a bare token. The 5a spec
claimed Connection Failed still reached it, which is wrong -- showingAuth sits
above that branch, so with no credential you never get there.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: The heading follows the card's state

**Files:**
- Modify: `frontend/src/components/WelcomeAuth.jsx`
- Modify: `frontend/src/App.jsx:95-123`, `:611-643`
- Test: `frontend/src/components/WelcomeAuth.test.jsx`

**Interfaces:**
- Produces: `WelcomeAuth` accepts `{ intent = "app", onSuccess }` and renders
  `AuthShell` itself. `intent` is `"app"` or `"connect"`. `App` no longer wraps
  it in `AuthShell`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/components/WelcomeAuth.test.jsx`:

```jsx
describe("the card's heading is part of its state", () => {
  // The heading used to be App's, set at the point WelcomeAuth was mounted, so
  // it could not change when the form did: "Welcome to MyGist -- Sign in or
  // create an account to get started" sat above the forgot-password form.
  const heading = () => screen.getByRole("heading", { level: 1 }).textContent;

  it("welcomes on sign-in", async () => {
    render(<WelcomeAuth onSuccess={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/username/i)).toBeInTheDocument());
    expect(heading()).toMatch(/Welcome to MyGist/i);
  });

  it("changes when an account is being created", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/username/i)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /create an account/i }));
    expect(heading()).toMatch(/Create your account/i);
  });

  it("changes again for a password reset", async () => {
    const user = userEvent.setup();
    render(<WelcomeAuth onSuccess={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/username/i)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /forgot your password/i }));
    expect(heading()).toMatch(/Reset your password/i);
  });

  it("says what the sign-in is for when a client is waiting", async () => {
    render(<WelcomeAuth intent="connect" onSuccess={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/username/i)).toBeInTheDocument());
    expect(heading()).toMatch(/Sign in to connect/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npm test -- --project unit src/components/WelcomeAuth.test.jsx`
Expected: all four FAIL — there is no `h1` in the tree, because `AuthShell`
renders it and the test does not mount one.

- [ ] **Step 3: Add the copy table**

At module scope in `frontend/src/components/WelcomeAuth.jsx`, below
`ORIGIN_API_URL`:

```jsx
/**
 * The card's heading, by what it is currently asking for.
 *
 * `intent` is the one thing App knows that this component does not: whether
 * this is the app's own sign-in or the middle of an OAuth flow, where the
 * person did not come here to sign in and is owed a sentence saying why they
 * are being asked.
 *
 * The invite gate reads the same under both -- it is a statement about the
 * instance, and nothing about it changes because a client is waiting.
 */
const COPY = {
  app: {
    signin: {
      title: "Welcome to MyGist",
      description: "Your portable personal context for AI.",
    },
    signup: {
      title: "Create your account",
      description:
        "One account, and every AI client you use reads the same persona.",
    },
    forgot: {
      title: "Reset your password",
      description: "We will email you a link.",
    },
  },
  connect: {
    signin: {
      title: "Sign in to connect",
      description: "Sign in to let this application connect to your persona.",
    },
    signup: {
      title: "Create your account",
      description: "You will be asked to approve the connection next.",
    },
    forgot: {
      title: "Reset your password",
      description: "We will email you a link.",
    },
  },
};

const INVITE_COPY = {
  title: "You need an invite",
  description: "MyGist is in closed testing.",
};
```

- [ ] **Step 4: Render the shell from inside**

Add the import at the top of the file, beside the `InviteGate` one:

```jsx
import { AuthShell } from "@/components/AuthShell";
```

Change the signature:

```jsx
export function WelcomeAuth({ intent = "app", onSuccess }) {
```

Just above `if (needsInvite)`, pick the copy:

```jsx
  const copy = needsInvite ? INVITE_COPY : COPY[intent][mode];
```

Then wrap each of the three returns in `<AuthShell title={copy.title}
description={copy.description}>…</AuthShell>`. The `needsInvite` return becomes:

```jsx
  if (needsInvite) {
    return (
      <AuthShell title={copy.title} description={copy.description}>
        <InviteGate
          initialCode={linkInvite}
          onAccepted={setAcceptedInvite}
          onBack={() => switchMode("signin")}
        />
      </AuthShell>
    );
  }
```

and the `mode === "forgot"` return and the final return are wrapped the same
way, keeping their existing root `<div>` inside the shell.

- [ ] **Step 5: Run it and watch it pass**

Run: `cd frontend && npm test -- --project unit src/components/WelcomeAuth.test.jsx`
Expected: PASS, 36 tests.

- [ ] **Step 6: Unwrap both App call sites**

In `frontend/src/App.jsx`, replace `:95-123` — the whole `AuthShell` wrapper and
the `isOAuthRequest` title logic it fed — with:

```jsx
    return (
      <WelcomeAuth
        intent={isOAuthRequest ? "connect" : "app"}
        onSuccess={() => {
          if (!isOAuthRequest) {
            window.location.assign("/");
            return;
          }
          // Better Auth's /oauth2/authorize re-evaluates now that a session
          // cookie exists, and continues the flow it interrupted -- on to
          // /consent, or straight through for a client that has one already.
          window.location.assign(`/auth/oauth2/authorize${oauthQuery}`);
        }}
      />
    );
```

Keep the `oauthQuery` and `isOAuthRequest` lines above it and their comments.

Replace the `showingAuth` branch at `:611-643` with:

```jsx
  if (showingAuth) {
    return (
      <WelcomeAuth
        onSuccess={({ isNew } = {}) => {
          // A brand-new account lands on Welcome, not on an empty Profile:
          // that is the moment intent is highest, and Welcome is where the
          // offer to hand the work to a client is made.
          if (isNew) navigate("onboarding", DEFAULT_ONBOARDING_STEP);
          loadAllData();
          loadSettings();
        }}
      />
    );
  }
```

- [ ] **Step 7: Check whether App still needs AuthShell**

Run: `cd frontend && grep -n "AuthShell" src/App.jsx`
Expected: only the import on line 29. Delete that import line too.

- [ ] **Step 8: Run the whole unit suite**

Run: `cd frontend && npm test -- --project unit`
Expected: PASS. Any test asserting the old "Sign in or create an account to get
started" copy will fail here; update it to what the screen now says rather than
putting the sentence back.

- [ ] **Step 9: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add frontend/src/components/WelcomeAuth.jsx frontend/src/components/WelcomeAuth.test.jsx frontend/src/App.jsx
git commit -F - <<'EOF'
feat(auth): the heading says which of the three states you are in

App owned the title and set it where it mounted the form, so the heading could
not change when the form did -- "Welcome to MyGist. Sign in or create an
account to get started" sat above the forgot-password form and above the
invite gate.

WelcomeAuth renders AuthShell itself and takes an intent prop for the one
thing App knows and it does not: whether this sign-in is the app's own or the
middle of an OAuth flow.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Blur validation on the sign-in and sign-up forms

**Files:**
- Modify: `frontend/src/components/WelcomeAuth.jsx`
- Test: `frontend/src/components/WelcomeAuth.test.jsx`

**Interfaces:**
- Consumes: `Field` from task 1, the validators from task 2.
- Produces: no external API change.

Four rules from the spec govern this, and the tests below are one per rule:
checked on blur only once touched; cleared on change rather than on the next
blur; submit still checks everything; the form-level line stays for the server.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/components/WelcomeAuth.test.jsx`:

```jsx
describe("validation arrives per field, on blur", () => {
  const openSignIn = async () => {
    render(<WelcomeAuth onSuccess={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/username/i)).toBeInTheDocument());
  };

  it("is silent on a form nobody has touched", async () => {
    await openSignIn();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names the empty field when it is left", async () => {
    const user = userEvent.setup();
    await openSignIn();
    await user.click(screen.getByLabelText(/username/i));
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a username or email.");
  });

  it("marks that field invalid, not the form", async () => {
    const user = userEvent.setup();
    await openSignIn();
    await user.click(screen.getByLabelText(/username/i));
    await user.tab();
    expect(screen.getByLabelText(/username/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/^password/i)).not.toHaveAttribute("aria-invalid");
  });

  it("clears as the fix is typed, not on the next blur", async () => {
    // A red message under the box being corrected is the thing this rule
    // exists to prevent.
    const user = userEvent.setup();
    await openSignIn();
    await user.click(screen.getByLabelText(/username/i));
    await user.tab();
    await user.type(screen.getByLabelText(/username/i), "l");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still checks everything on a submit where nothing was blurred", async () => {
    // Enter submits a form in which no field was ever left.
    const user = userEvent.setup();
    await openSignIn();
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    const messages = screen.getAllByRole("alert").map((el) => el.textContent);
    expect(messages).toContain("Enter a username or email.");
    expect(messages).toContain("Enter a password.");
  });

  it("holds a new password to eight characters, and only when signing up", async () => {
    const user = userEvent.setup();
    await openSignIn();
    await user.type(screen.getByLabelText(/^password/i), "short");
    await user.tab();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /create an account/i }));
    await user.type(screen.getByLabelText(/^password/i), "short");
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Password must be at least 8 characters.",
    );
  });

  it("reports a mismatch under Confirm, where the correction goes", async () => {
    const user = userEvent.setup();
    await openSignIn();
    await user.click(screen.getByRole("button", { name: /create an account/i }));
    await user.type(screen.getByLabelText(/^password/i), "a-good-password");
    await user.type(screen.getByLabelText(/confirm password/i), "a-good-passwerd");
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");
  });

  it("stops saying they differ once the first field is the one that changed", async () => {
    // Fixing Password leaves a stale mismatch under Confirm unless the pair
    // is re-checked when either side moves.
    const user = userEvent.setup();
    await openSignIn();
    await user.click(screen.getByRole("button", { name: /create an account/i }));
    await user.type(screen.getByLabelText(/^password/i), "a-good-passwerd");
    await user.type(screen.getByLabelText(/confirm password/i), "a-good-password");
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");

    await user.clear(screen.getByLabelText(/^password/i));
    await user.type(screen.getByLabelText(/^password/i), "a-good-password");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the form-level line for what the server says", async () => {
    const user = userEvent.setup();
    signIn.mockImplementation(() => Promise.reject(new Error("Invalid username or password")));
    await openSignIn();
    await user.type(screen.getByLabelText(/username/i), "liamthura");
    await user.type(screen.getByLabelText(/^password/i), "a-good-password");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    await waitFor(() =>
      expect(screen.getByText("Invalid username or password")).toBeInTheDocument(),
    );
  });
});
```

`signIn` is already imported and mocked in that file — check how the existing
tests reach it and match them. Use `mockImplementation(() => Promise.reject(…))`
rather than `mockRejectedValue`: the latter builds its rejected promise before
anything attaches a catch, which fails every test in the block.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd frontend && npm test -- --project unit src/components/WelcomeAuth.test.jsx`
Expected: the blur ones FAIL (no `alert` role anywhere); "is silent on a form
nobody has touched" and the form-level one pass already.

- [ ] **Step 3: Add the validation state**

Import at the top of `WelcomeAuth.jsx`:

```jsx
import { Field } from "@/components/ui/field";
import {
  validateUsername,
  validatePassword,
  validateConfirmPassword,
  validateResetEmail,
  validateServerUrl,
} from "@/lib/authValidation.js";
```

`Input` and `Label` stay imported — `Label` is still used by the Server block,
and `Input` by every control.

Below the existing `useState` calls, add the touched set and the message map:

```jsx
  // Which fields have been left, and what is currently wrong with each. Two
  // pieces of state rather than one: a field can be untouched AND invalid
  // (nothing typed yet), and the difference is exactly what decides whether to
  // say so. Submit sets every field touched at once, which is how a form
  // submitted by Enter reports all of its problems rather than none.
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});
```

Then, above `handleResetSubmit`, the checker:

```jsx
  // Every field's rule, evaluated together. Cheap enough to redo on each call,
  // and one function means the blur path and the submit path cannot disagree
  // about what counts as valid.
  const checkAll = () => ({
    username: validateUsername(username, { acceptsEmail }),
    password: validatePassword(password, { isNew: mode === "signup" }),
    ...(mode === "signup"
      ? { confirmPassword: validateConfirmPassword(confirmPassword, password) }
      : {}),
    ...(connectionType === "self-hosted" && showServer
      ? { selfHostedUrl: validateServerUrl(selfHostedUrl) }
      : {}),
  });

  const blur = (field) => () => {
    setTouched((t) => ({ ...t, [field]: true }));
    setErrors(checkAll());
  };

  // Cleared as the fix is typed. The alternative -- waiting for the next blur
  // -- leaves a red message under the box being corrected.
  const change = (setter, ...fields) => (e) => {
    setter(e.target.value);
    setErrors((prev) => {
      const next = { ...prev };
      for (const field of fields) delete next[field];
      return next;
    });
  };

  // Shown only once the field has been left, or once submit has touched
  // everything.
  const shown = (field) => (touched[field] ? errors[field] : undefined);
```

`change` takes more than one field name for the password pair: typing in
Password clears both its own message and Confirm's stale mismatch.

- [ ] **Step 4: Wire the three fields**

Replace the username, password and confirm groups in the final return with
`Field`. Username:

```jsx
        <Field
          id="welcome-username"
          label={acceptsEmail ? "Username or email" : "Username"}
          error={shown("username")}
        >
          {(control) => (
            <Input
              {...control}
              autoComplete="username"
              value={username}
              onChange={change(setUsername, "username")}
              onBlur={blur("username")}
              placeholder={acceptsEmail ? "yourname or you@example.com" : "yourname"}
            />
          )}
        </Field>
```

Password:

```jsx
        <Field id="welcome-password" label="Password" error={shown("password")}>
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={change(setPassword, "password", "confirmPassword")}
              onBlur={blur("password")}
              placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
            />
          )}
        </Field>
```

Confirm, still inside its `mode === "signup" && (…)`:

```jsx
          <Field
            id="welcome-confirm-password"
            label="Confirm password"
            error={shown("confirmPassword")}
          >
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={change(setConfirmPassword, "confirmPassword")}
                onBlur={blur("confirmPassword")}
                placeholder="Re-enter password"
              />
            )}
          </Field>
```

And the self-hosted URL inside the Server block, which keeps its own `Label
className="text-xs font-medium"` header for the group above it:

```jsx
            {connectionType === "self-hosted" && (
              <Field
                id="welcome-server-url"
                label="Server URL"
                error={shown("selfHostedUrl")}
              >
                {(control) => (
                  <Input
                    {...control}
                    placeholder="https://your-mygist-server.com/api"
                    value={selfHostedUrl}
                    onChange={change(setSelfHostedUrl, "selfHostedUrl")}
                    onBlur={blur("selfHostedUrl")}
                  />
                )}
              </Field>
            )}
```

- [ ] **Step 5: Move submit onto the same rules**

In `handleSubmit`, replace the three-part if-chain at `:220-237` with:

```jsx
    // Everything is marked touched so a form submitted by Enter reports all of
    // its problems, not the first one an if-chain happened to reach.
    const found = checkAll();
    setErrors(found);
    setTouched({
      username: true,
      password: true,
      confirmPassword: true,
      selfHostedUrl: true,
    });
    if (Object.values(found).some(Boolean)) return;
```

Leave `setFormError(null)` at the top of the handler and the whole `try` block
below it untouched: the form-level line is still where a server error lands.

Do the same in `handleResetSubmit`, replacing its `if (!resetEmail.trim())`
check:

```jsx
    const emailError = validateResetEmail(resetEmail);
    setTouched((t) => ({ ...t, resetEmail: true }));
    setErrors((prev) => ({ ...prev, resetEmail: emailError }));
    if (emailError) return;
```

and wire the forgot form's field, keeping its help line as the `description`:

```jsx
            <Field
              id="reset-email"
              label="Email"
              description="The address on your account. If you never added one, a reset cannot reach you — sign in and add one first."
              error={shown("resetEmail")}
            >
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  autoComplete="email"
                  value={resetEmail}
                  onChange={change(setResetEmail, "resetEmail")}
                  onBlur={() => {
                    setTouched((t) => ({ ...t, resetEmail: true }));
                    setErrors((prev) => ({
                      ...prev,
                      resetEmail: validateResetEmail(resetEmail),
                    }));
                  }}
                />
              )}
            </Field>
```

The reset field gets its own blur handler rather than `blur("resetEmail")`
because `checkAll` covers the sign-in form's fields, and running it here would
mark the username and password invalid on a screen that is not showing them.

- [ ] **Step 6: Clear both on a mode change**

In `switchMode`, beside the existing resets:

```jsx
    setTouched({});
    setErrors({});
```

Leaving them would carry "Enter a password" from sign-in onto the sign-up form.

- [ ] **Step 7: Run the file**

Run: `cd frontend && npm test -- --project unit src/components/WelcomeAuth.test.jsx`
Expected: PASS, 45 tests.

- [ ] **Step 8: Run the whole unit suite**

Run: `cd frontend && npm test -- --project unit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add frontend/src/components/WelcomeAuth.jsx frontend/src/components/WelcomeAuth.test.jsx
git commit -F - <<'EOF'
feat(auth): the sign-in form says which field is wrong, when you leave it

One formError string above the button became a message under the field it is
about. Four rules, each because the alternative is worse: nothing is checked
until it has been left, an error clears as the fix is typed rather than on the
next blur, submit still checks everything because Enter submits a form nobody
blurred, and the form-level line stays for what the server answers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Blur validation on the reset-password screen

**Files:**
- Modify: `frontend/src/components/ResetPassword.jsx`
- Test: `frontend/src/components/ResetPassword.test.jsx`

**Interfaces:**
- Consumes: `Field` from task 1, `validatePassword` /
  `validateConfirmPassword` / `MIN_PASSWORD_LENGTH` from task 2.
- Produces: no external API change. `ResetPassword`'s local
  `MIN_PASSWORD_LENGTH` const is deleted in favour of the shared one.

This is the prototype's "two fields with a live match hint": the mismatch
appears under Confirm as soon as the field is left, instead of at submit.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/components/ResetPassword.test.jsx`:

```jsx
describe("the fields say what is wrong before the button is pressed", () => {
  it("is silent until a field is left", async () => {
    open();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("holds the new password to the minimum on blur", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText(/new password/i), "short");
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Password must be at least 8 characters.",
    );
  });

  it("shows the mismatch under Confirm, not above the button", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText(/new password/i), "a-good-password");
    await user.type(screen.getByLabelText(/confirm password/i), "a-good-passwerd");
    await user.tab();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Passwords do not match.");
    expect(screen.getByLabelText(/confirm password/i)).toHaveAttribute(
      "aria-describedby",
      alert.id,
    );
  });

  it("stops saying they differ once they do not", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText(/new password/i), "a-good-password");
    await user.type(screen.getByLabelText(/confirm password/i), "a-good-passwerd");
    await user.tab();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/confirm password/i));
    await user.type(screen.getByLabelText(/confirm password/i), "a-good-password");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not submit a form it has already found fault with", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText(/new password/i), "short");
    await user.type(screen.getByLabelText(/confirm password/i), "short");
    await user.click(screen.getByRole("button", { name: /set new password/i }));
    expect(resetPassword).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd frontend && npm test -- --project unit src/components/ResetPassword.test.jsx`
Expected: three FAIL. "is silent until a field is left" and the
non-submit one pass already — the second because the old code caught the same
case at submit.

- [ ] **Step 3: Rewrite the form**

Replace the imports of `Input`/`Label` usage and the local constant. Delete
lines 23-26 (the local `MIN_PASSWORD_LENGTH` and its comment) and import
instead:

```jsx
import { Field } from "@/components/ui/field";
import {
  MIN_PASSWORD_LENGTH,
  validatePassword,
  validateConfirmPassword,
} from "@/lib/authValidation.js";
```

`Label` is no longer used here — drop its import. `Input` stays.

Add the state and helpers below the existing `useState` calls:

```jsx
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});

  // Both fields, together, because the second one's rule is about the first.
  const checkAll = () => ({
    password: validatePassword(password, { isNew: true }),
    confirmPassword: validateConfirmPassword(confirmPassword, password),
  });

  const blur = (field) => () => {
    setTouched((t) => ({ ...t, [field]: true }));
    setErrors(checkAll());
  };

  const change = (setter, ...fields) => (e) => {
    setter(e.target.value);
    setErrors((prev) => {
      const next = { ...prev };
      for (const field of fields) delete next[field];
      return next;
    });
  };

  const shown = (field) => (touched[field] ? errors[field] : undefined);
```

Replace the two field groups:

```jsx
        <Field id="reset-password" label="New password" error={shown("password")}>
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={change(setPassword, "password", "confirmPassword")}
              onBlur={blur("password")}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            />
          )}
        </Field>
        <Field
          id="reset-confirm-password"
          label="Confirm password"
          error={shown("confirmPassword")}
        >
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={change(setConfirmPassword, "confirmPassword")}
              onBlur={blur("confirmPassword")}
              placeholder="Re-enter password"
            />
          )}
        </Field>
```

And the two checks at the top of `handleSubmit`:

```jsx
    const found = checkAll();
    setErrors(found);
    setTouched({ password: true, confirmPassword: true });
    if (Object.values(found).some(Boolean)) return;
```

`setFormError(null)` above it and the `try` block below it are unchanged: an
expired or already-used token is the server's answer and still belongs on the
form-level line.

- [ ] **Step 4: Run the file**

Run: `cd frontend && npm test -- --project unit src/components/ResetPassword.test.jsx`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add frontend/src/components/ResetPassword.jsx frontend/src/components/ResetPassword.test.jsx
git commit -F - <<'EOF'
feat(auth): the reset screen's match hint arrives when you leave the field

The prototype's "two fields with a live match hint". Mismatch now appears
under Confirm, which is where the correction goes, rather than above the
button at submit. Drops the local copy of MIN_PASSWORD_LENGTH for the shared
one -- it was already a second declaration of the same number.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 7: The invite gate's field and its helper line

**Files:**
- Modify: `frontend/src/components/InviteGate.jsx:99-156`
- Test: `frontend/src/components/InviteGate.test.jsx`

**Interfaces:**
- Consumes: `Field` from task 1.
- Produces: no external API change. The code's own check stays in
  `submit`; nothing moves to `authValidation.js` (see task 2's note).

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/components/InviteGate.test.jsx`:

```jsx
describe("the helper line", () => {
  it("does not claim the dash is optional to type", () => {
    // It was one text input when that sentence was written. The dash is now
    // drawn between the two groups and cannot be typed into at all, so the
    // promise was about a field that no longer exists.
    render(<InviteGate initialCode="" onAccepted={() => {}} onBack={() => {}} />);
    expect(screen.getByText(/case does not matter/i)).toBeInTheDocument();
    expect(screen.queryByText(/the dash/i)).not.toBeInTheDocument();
  });

  it("still describes the field it belongs to", () => {
    render(<InviteGate initialCode="" onAccepted={() => {}} onBack={() => {}} />);
    expect(screen.getByLabelText(/invite code/i)).toHaveAccessibleDescription(
      /closed testing/i,
    );
  });
});
```

Match how the file already renders `InviteGate` — check its existing helpers
before writing a third way of doing it.

- [ ] **Step 2: Run them and watch the first one fail**

Run: `cd frontend && npm test -- --project unit src/components/InviteGate.test.jsx`
Expected: "does not claim the dash is optional" FAILS on the `queryByText`.

- [ ] **Step 3: Swap in Field and fix the copy**

Import it:

```jsx
import { Field } from "@/components/ui/field";
```

`Label` is no longer used — drop its import. Replace the `<div
className="space-y-2">` group and its contents with:

```jsx
        <Field
          id="invite-code"
          label="Invite code"
          description="MyGist is in closed testing. Paste the code from your invite — case does not matter."
          error={error}
        >
          {(control) => (
            <InputOTP
              {...control}
              maxLength={INVITE_LENGTH}
              pattern={PATTERN}
              // input-otp defaults this to "numeric", which is right for the
              // one-time codes it was written for and wrong here: two thirds of
              // the invite alphabet is letters, so a phone raises the number pad
              // and the code cannot be typed at all. Invisible on a desktop,
              // where every keyboard has everything.
              inputMode="text"
              // The alphabet is uppercase, and normaliseInvite would fix the case
              // anyway -- but a keyboard that shows the case it will produce is
              // less unnerving than one whose letters arrive changed.
              autoCapitalize="characters"
              value={code}
              onChange={(value) => {
                setCode(normaliseInvite(value));
                setError(null);
              }}
              // Enter is natural once the last slot is filled, and waiting for a
              // deliberate button press after that is friction with no purpose.
              onComplete={(value) => submit(value)}
              disabled={pending}
            >
              <InputOTPGroup>
                {[0, 1, 2, 3].map((i) => (
                  <InputOTPSlot key={i} index={i} />
                ))}
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                {[4, 5, 6, 7].map((i) => (
                  <InputOTPSlot key={i} index={i} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          )}
        </Field>
```

Then delete the standalone `{error && <p className="text-xs
text-destructive">{error}</p>}` line below the form group — `Field` renders it
now, under the field it is about. The hand-written `aria-describedby=
"invite-code-help"` goes too; `Field` supplies it.

- [ ] **Step 4: Run the file**

Run: `cd frontend && npm test -- --project unit src/components/InviteGate.test.jsx`
Expected: PASS, 17 tests. If a test asserted the error's position or the old
`invite-code-help` id, update it to the new markup rather than reverting.

- [ ] **Step 5: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add frontend/src/components/InviteGate.jsx frontend/src/components/InviteGate.test.jsx
git commit -F - <<'EOF'
fix(auth): the invite helper stops promising the dash does not matter

True when the field was one text input. The dash is drawn between the two
groups now and cannot be typed into, so the sentence described a field that no
longer exists -- round 2's change 6 calls this out. Moves the group onto Field
while it is open, which is what wires the error to the input.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Consent's grant rows become checkboxes

**Files:**
- Create: `frontend/src/components/ui/checkbox.jsx`
- Modify: `frontend/package.json:20-28`
- Modify: `frontend/src/components/Consent.jsx:37-48`, `:246-327`
- Test: `frontend/src/components/Consent.test.jsx`

**Interfaces:**
- Consumes: `SCOPE_LABELS` from `@/lib/scopes.js`, which is
  `[[PROPOSE, "Suggest changes for your approval"], [WRITE, "Change your
  persona directly"]]`.
- Produces: `Checkbox` from `@/components/ui/checkbox`, the Radix primitive
  with this project's styling. `ScopeRow`'s props are unchanged.

A switch means the thing it controls is on or off now — which is how this app
uses it everywhere else. These rows describe a grant that does not exist until
Allow is pressed. Nothing about what gets posted changes.

- [ ] **Step 1: Install the primitive**

```bash
cd frontend && npm install @radix-ui/react-checkbox@^1.3.11
```

Then check nothing duplicated:

```bash
cd frontend && npm ls @radix-ui/react-primitive @radix-ui/react-presence
```
Expected: one version of each — `2.1.10` and `1.1.10`, which is what
`overrides` pins and what this release declares. If npm reports two of either,
stop: that is the shape of the bug that broke dropdown dismissal in 5a. Do not
edit `overrides` to paper over it.

- [ ] **Step 2: Write the failing test**

Append to `frontend/src/components/Consent.test.jsx`:

```jsx
describe("the grant rows are checkboxes, not switches", () => {
  it("offers each mutable scope as a checkbox", () => {
    render(<Consent client={CLIENT} username="liamthura" />);
    // A switch says "this is on now". These rows say "this is what I am about
    // to agree to", and nothing happens until Allow.
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });

  it("will not let read be withdrawn", () => {
    render(<Consent client={CLIENT} username="liamthura" />);
    const read = screen.getByLabelText(/Read your persona/i);
    expect(read).toBeChecked();
    expect(read).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `cd frontend && npm test -- --project unit src/components/Consent.test.jsx`
Expected: the checkbox one FAILS — three switches, no checkboxes.

- [ ] **Step 4: Add the component**

`frontend/src/components/ui/checkbox.jsx`:

```jsx
/**
 * A checkbox, from Radix.
 *
 * Sized and coloured to match Switch and the rest of ui/, so the consent
 * screen does not look like it came from somewhere else. Adapted from shadcn's
 * registry item: React 18 forwardRef rather than the v19 ref-as-prop form the
 * current registry emits, and no data-slot attributes, since nothing in this
 * project styles by them.
 */
import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-4 w-4 shrink-0 rounded-sm border border-input ring-offset-background transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Check className="h-3.5 w-3.5" aria-hidden="true" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";

export { Checkbox };
```

- [ ] **Step 5: Use it, and take the labels from scopes.js**

In `Consent.jsx`, swap the import:

```jsx
import { Checkbox } from "@/components/ui/checkbox";
```

Delete the `Switch` import. Extend the `scopes.js` import to bring in the
labels:

```jsx
import { READ, PROPOSE, WRITE, PERSONA_SCOPES, SCOPE_LABELS } from "@/lib/scopes.js";
```

Add a lookup below `readError`:

```jsx
// The two mutable rows' labels, from the constant the settings slice extracted
// so that the consent screen and the token list cannot describe the same grant
// two ways.
const LABELS = Object.fromEntries(SCOPE_LABELS);
```

In `ScopeRow`, replace `Switch` with `Checkbox`, keeping the classes:

```jsx
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange ?? (() => {})}
        className="mt-0.5 shrink-0"
      />
```

`mt-0.5` stays: the row is `items-start`, so without it a 16px box sits at the
top of a 20px line box and reads high against the label beside it. Check this by
eye in task 10 rather than trusting it — the switch it replaces was 24px, and
what looked centred for that may not for this.

Then use the shared labels in the two mutable rows:

```jsx
          {askedPropose && (
            <ScopeRow
              id="scope-propose"
              label={LABELS[PROPOSE]}
              …
          {askedWrite && (
            <ScopeRow
              id="scope-write"
              label={LABELS[WRITE]}
              …
```

"Read your persona" stays a literal: `scopes.js` has no label for `READ` — its
`SCOPE_LABELS` covers only the two a token can vary.

- [ ] **Step 6: Run the file**

Run: `cd frontend && npm test -- --project unit src/components/Consent.test.jsx`
Expected: PASS, 18 tests. Radix renders `role="checkbox"` with `aria-checked`,
so the existing `getByLabelText` and `toBeChecked` assertions
(`Consent.test.jsx:66,74`) keep working.

- [ ] **Step 7: Run the whole unit suite**

Run: `cd frontend && npm test -- --project unit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add frontend/package.json frontend/package-lock.json frontend/src/components/ui/checkbox.jsx frontend/src/components/Consent.jsx frontend/src/components/Consent.test.jsx
git commit -F - <<'EOF'
feat(auth): consent's grant rows are checkboxes

A switch means the thing it controls is on or off now, which is how the rest
of this app uses it -- in Preferences, and on the autosave setting. These rows
are neither: they describe a grant that does not exist until Allow is pressed.

The two mutable labels now come from SCOPE_LABELS, so the consent screen and
the token list cannot describe the same grant two ways. Nothing about the
posted scope changes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 9: AuthShell stops re-drawing the logo

**Files:**
- Modify: `frontend/src/components/AuthShell.jsx`
- Test: `frontend/src/components/AuthShell.test.jsx` (create)

**Interfaces:**
- Consumes: `Mark` from `@/landing/Brand`, which takes `className` and applies
  `currentColor` to both strokes.
- Produces: no API change. `AuthShell({ title, description, children })` is
  unchanged.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/AuthShell.test.jsx`:

```jsx
// AuthShell had no tests of its own. It gets two, because the thing being
// changed here is easy to break silently: the mark is inlined SVG, and a
// wrong `fill`/`stroke` combination renders an invisible logo rather than an
// error.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthShell } from "./AuthShell";

describe("AuthShell", () => {
  it("draws the mark once, from the shared component", () => {
    const { container } = render(<AuthShell title="Sign in" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    // Brand.jsx's Mark takes currentColor so it works on any ground. A copy
    // that hardcoded hsl(var(--primary-foreground)) is what this replaces.
    expect(svg.querySelector("circle")).toHaveAttribute("stroke", "currentColor");
  });

  it("shows the title as the page's heading and the description under it", () => {
    render(<AuthShell title="Sign in" description="Sign in to your account." />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sign in");
    expect(screen.getByText("Sign in to your account.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and watch the first one fail**

Run: `cd frontend && npm test -- --project unit src/components/AuthShell.test.jsx`
Expected: the mark test FAILS — the inlined copy hardcodes
`hsl(var(--primary-foreground))`.

- [ ] **Step 3: Use Mark, and widen the card to the prototype's 400**

Replace the body of `frontend/src/components/AuthShell.jsx`:

```jsx
/**
 * The frame around anything shown to someone who is not yet through the door:
 * the sign-in card in its three states, the reset-password screen a link drops
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
      {/* 400px is the prototype's auth card. max-w-sm, which this used to be,
          is 384. */}
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
```

`h-10 w-10` is 40px, matching the `width="40" height="40"` the inlined copy set.

- [ ] **Step 4: Run the file**

Run: `cd frontend && npm test -- --project unit src/components/AuthShell.test.jsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the whole unit suite**

Run: `cd frontend && npm test -- --project unit`
Expected: PASS.

- [ ] **Step 6: Look at it**

The mark is now stroked in `currentColor` inside a `bg-primary` tile, where it
used to be `hsl(var(--primary-foreground))` explicitly. Those should resolve to
the same colour; check rather than assume.

```bash
cd frontend && npm run dev
```
Open the sign-in screen, in both light and dark. Expected: the mark is legible
against the indigo tile in both, and the card is imperceptibly wider than
before. If the mark disappears in either mode, `text-primary-foreground` is not
resolving and the fix is the class, not the component.

- [ ] **Step 7: Commit**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add frontend/src/components/AuthShell.jsx frontend/src/components/AuthShell.test.jsx
git commit -F - <<'EOF'
refactor(ui): AuthShell uses the shared mark instead of a third copy

Brand.jsx exports Mark for exactly this, taking currentColor. Header.jsx holds
a third copy of the same path data; that is slice 1's file and is left alone.

Card goes to the prototype's 400px from max-w-sm's 384. Sixteen pixels nobody
will notice, changed because it costs one class and leaves the file matching
the spec it came from.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 10: Close the slice

**Files:**
- Modify: `docs/superpowers/specs/2026-08-14-auth-slice-design.md`
- Modify: `docs/superpowers/specs/2026-08-10-app-migration-umbrella-design.md:57`

- [ ] **Step 1: Run everything, both projects**

```bash
cd frontend && npm test -- --project unit && npm test -- --project=storybook
```
Expected: both PASS. The storybook project needs a browser; if the run reports a
missing chromium, that is the CI gap the spec's risk section names, not a
regression — install with `npx playwright install chromium` and re-run.

- [ ] **Step 2: Build, so a class nobody tested still compiles**

```bash
cd frontend && npm run build
```
Expected: no errors. This is what would catch `aria-[invalid=true]:` being
malformed.

- [ ] **Step 3: Record what actually happened**

Append a "What shipped" section to the auth slice spec. Cover, honestly:

- Anything that came out differently from the plan, and why.
- The invite code's rule staying in `InviteGate` rather than moving to
  `authValidation.js`, which is a deviation from the spec's own table.
- Whether the mark's colour needed the fallback in task 9 step 6.
- Test counts before and after.

- [ ] **Step 4: Mark slice 5 done in the umbrella**

The umbrella's slice table at `:57` describes slice 5 as one row. Note against
it that it shipped as two specs, `2026-08-14-settings-slice-design.md` and
`2026-08-14-auth-slice-design.md`, and that this was the last slice.

- [ ] **Step 5: Commit and open the PR**

```bash
cd /Users/khantthura/Documents/ProjectL/project-twin
git add docs/superpowers/specs/
git commit -F - <<'EOF'
docs: what the auth slice actually shipped

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

Before pushing, scan the range for anything secret-shaped:

```bash
git diff main...design/auth-slice | grep -nEi '(api[_-]?key|secret|password\s*=|token\s*=|BEGIN [A-Z ]*PRIVATE KEY)' | head -40
```
Expected: only the auth screens' own field names and copy. Anything that looks
like a real value stops the push.

Then push and open the PR. Do not merge without being asked.

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task: the Field kit → 1;
validation on blur → 2, 5, 6; the token link's deletion → 3; the heading → 4;
Consent's checkboxes → 8; the three small ones → 7 (invite copy) and 9 (`Mark`,
400px); testing → each task's own steps plus 10.

**One deliberate divergence from the spec**, recorded here so it is not
discovered as a surprise: the spec's validation table lists the invite code, and
task 2 leaves it in `InviteGate`. The reason is in task 2's interfaces block —
it is a pre-flight before a network call, not a blur rule, and the field
auto-submits when its last cell fills, so there is no blur to hang it on. Task
10 step 3 records this in the spec itself.

**Type consistency.** `Field`'s render-prop argument is
`{ id, "aria-invalid", "aria-describedby" }` in task 1 and is spread as
`{...control}` in tasks 5, 6 and 7. `checkAll`, `blur`, `change` and `shown`
have identical signatures in tasks 5 and 6. `validatePassword(value, { isNew })`
is called with `isNew: mode === "signup"` in task 5 and `isNew: true` in task 6,
matching task 2's definition. `MIN_PASSWORD_LENGTH` is defined once, in task 2,
and imported by task 6.

**Ordering.** Tasks 3 and 4 both edit the same region of `App.jsx`; 3 must land
first, because 4's replacement blocks are written against a file that no longer
has `onUseToken` in it.
