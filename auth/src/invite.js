/**
 * Invite codes: the rule that decides whether one admits.
 *
 * This module is the single implementation, and that is the design rather than
 * an accident. There are two ways to create an account -- Better Auth's
 * /sign-up/email and FastAPI's /api/auth/register -- and a gate on one is not a
 * gate. Rather than teach both sides the same rule and hope they stay in step,
 * the rule lives here and FastAPI simply locks its door while the mode is on.
 *
 * Two callers, both inside this service:
 *
 *   - the `before` hook on /sign-up/email, which is the gate
 *   - /auth/invite/check, which backs the first screen of the sign-up flow
 *
 * They cannot disagree, because they are the same function.
 */

/**
 * Crockford base32 minus I, L, O and U.
 *
 * I/1, L/1 and O/0 are the pairs people mistype; U is dropped because Crockford
 * drops it, so that a code can never accidentally spell something. 32^8 is
 * about 1.1e12, which is what makes /auth/invite/check safe to expose: with a
 * hundred codes live, a guesser at a hundred requests a second is looking at
 * years for a single hit.
 */
export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** XXXX-XXXX. Checked before any query, and before any network call on the
 *  client, so a typo costs neither a round trip nor a rate-limit token. */
export const CODE_PATTERN = new RegExp(`^[${ALPHABET}]{4}-[${ALPHABET}]{4}$`);

/**
 * Every rejection says this, and only this.
 *
 * Distinguishing "expired" from "already used" from "never existed" tells a
 * guesser which codes are worth pursuing, and tells a genuine tester nothing
 * they can act on -- they will message you either way.
 */
export const REJECTION = "That invite code isn't valid.";

/**
 * Uppercase, and with the separator put back if it was left out.
 *
 * People retype these from screenshots and read them over calls, so `7f2kqx91`
 * and `7F2K-QX91` have to be the same code. Normalising in one place is the
 * lesson from the username casing that locked out every account with a capital
 * letter in it: the trap is not the rule, it is having the rule in two places.
 */
export function normalise(input) {
  if (typeof input !== "string") return "";

  const bare = input.trim().toUpperCase().replace(/[\s-]/g, "");
  if (bare.length !== 8) return bare; // let the pattern check reject it
  return `${bare.slice(0, 4)}-${bare.slice(4)}`;
}

/** Whether the mode is on at all. Read in one place so a feature-flag system
 *  later replaces this function rather than every call site. */
export function inviteOnly() {
  return String(process.env.INVITE_ONLY || "").toLowerCase() === "true";
}

/**
 * Whether a code admits, without changing anything.
 *
 * Read-only on purpose. Reserving a use here would burn one whenever the
 * sign-up that follows fails -- most obviously on a duplicate username, which
 * testers will hit -- and telling someone holding a valid code that it is spent
 * is a worse failure than admitting one extra person on a genuine race.
 *
 * @returns {Promise<{ok: true, code: string} | {ok: false, reason: string}>}
 */
export async function check(pool, rawCode) {
  const code = normalise(rawCode);
  if (!CODE_PATTERN.test(code)) return { ok: false, reason: REJECTION };

  const { rows } = await pool.query(
    `select code
       from public.invite_codes
      where code = $1
        and revoked_at is null
        and (expires_at is null or expires_at > now())
        and uses < max_uses`,
    [code],
  );

  return rows.length > 0 ? { ok: true, code } : { ok: false, reason: REJECTION };
}

/**
 * Record that a code was used, and by whom.
 *
 * Called only once the account row exists, so a sign-up that fails on its way
 * there costs nobody a use.
 *
 * The increment is guarded by `uses < max_uses` even though `check` has already
 * passed, because between the two a concurrent sign-up may have taken the last
 * one. Losing that race does not fail the registration -- the account is
 * already created and refusing now would be worse than admitting one over --
 * but it must not silently push the counter past its own limit.
 */
export async function redeem(pool, rawCode, userId) {
  const code = normalise(rawCode);
  if (!CODE_PATTERN.test(code)) return false;

  const { rows } = await pool.query(
    `update public.invite_codes
        set uses = uses + 1
      where code = $1
        and revoked_at is null
        and (expires_at is null or expires_at > now())
        and uses < max_uses
      returning code`,
    [code],
  );

  // Attribution is written whether or not the counter moved: the account did
  // come in on this code, and that is the question this column answers.
  await pool.query(`update public.users set invited_with = $1 where id = $2`, [
    code,
    userId,
  ]);

  return rows.length > 0;
}

/** How many codes could admit someone right now. Printed at boot, because
 *  turning the mode on with none minted locks out everyone including you. */
export async function activeCount(pool) {
  const { rows } = await pool.query(
    `select count(*)::int as n
       from public.invite_codes
      where revoked_at is null
        and (expires_at is null or expires_at > now())
        and uses < max_uses`,
  );
  return rows[0].n;
}
