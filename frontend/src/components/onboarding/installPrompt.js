/**
 * What someone pastes into a client that has no install card.
 *
 * The fallback under the picker, and the reason the picker can stay short: a
 * roster of six covers most readers, and this covers the rest without anybody
 * maintaining a seventh set of steps for a client they have never opened.
 *
 * Addressed to the agent rather than to the reader, because the reader is about
 * to hand it over verbatim. Every line is an instruction it can act on.
 *
 * Three things are stated that a client gets wrong when left to guess. The
 * transport, because a client that assumes stdio will try to run the URL as a
 * command. That there is no token, because the alternative is an agent asking
 * for a key that does not exist. And the propose permission, because the review
 * queue is the whole design and a read-only connection never reaches it.
 *
 * A function, not a constant like `AUTOFILL_PROMPT` beside it. That one is the
 * same words on every instance; this one carries an address that is not.
 *
 * This prompt asserts OAuth unconditionally. It is correct only on an instance
 * where `mcp_oauth` is true (see getInstance() in the backend). Any caller must
 * gate on that flag before showing this prompt, or the agent will hit a 401
 * when OAuth discovery is not mounted.
 */
export function installPrompt(url) {
  return (
    `Add an MCP server named mygist at ${url}, over HTTP. ` +
    "It signs clients in with OAuth, so there is no token to paste. " +
    "Open the sign-in link it gives you and approve the connection. Keep " +
    "'Suggest changes for your approval' checked, and uncheck 'Change your " +
    "persona directly'. If you cannot add it yourself, tell me where that " +
    "setting lives in this client."
  );
}
