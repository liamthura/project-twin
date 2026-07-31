/**
 * Outbound email.
 *
 * A thin interface over one provider, because the provider is the part most
 * likely to change and the least interesting to be coupled to. Resend is called
 * over plain fetch rather than through its SDK: two request shapes do not
 * justify a dependency, and this way the whole integration is visible in one
 * file.
 *
 * **Unconfigured, it logs instead of sending.** That is deliberate rather than a
 * fallback: password reset and verification can then be exercised end to end
 * locally, with the link printed to the console, before anyone has a Resend
 * account or DNS records. A silent no-op would have been worse than either
 * sending or failing -- you would think the mail went.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function logMailer() {
  return {
    name: "log",
    async send({ to, subject, text }) {
      // The link is the whole point of these emails, so it goes to stdout
      // where a developer will actually see it.
      console.log(
        `\n[email:log] no provider configured, not sending\n` +
          `  to:      ${to}\n` +
          `  subject: ${subject}\n` +
          `  ${text.split("\n").join("\n  ")}\n`,
      );
    },
  };
}

function resendMailer({ apiKey, from }) {
  return {
    name: "resend",
    async send({ to, subject, text, html }) {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to, subject, text, html: html || undefined }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        // Thrown, not swallowed. Better Auth surfaces the failure to the caller,
        // so someone who asks for a reset that could not be sent is told --
        // rather than waiting for mail that will never arrive.
        throw new Error(`Resend responded ${res.status}: ${detail.slice(0, 200)}`);
      }
    },
  };
}

/** The configured mailer, or the logging one when there is no provider. */
export function createMailer() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") {
      // In production this is a misconfiguration, not a choice: password reset
      // would appear to work and silently do nothing.
      console.warn(
        "[email] RESEND_API_KEY or EMAIL_FROM is unset — password reset and " +
          "verification emails will be logged, not sent.",
      );
    }
    return logMailer();
  }

  return resendMailer({ apiKey, from });
}
