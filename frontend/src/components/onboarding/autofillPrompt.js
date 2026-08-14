/**
 * What someone pastes into a connected assistant to have it fill their persona.
 *
 * Shared by the Connect step and the Getting-started card, because it is one
 * piece of copy and two screens that offer it. Duplicating it would let the two
 * drift, and the reader would have no way to tell which one was current.
 *
 * It asks for PROPOSALS, not writes, and that is the whole design: the reader's
 * first real task becomes approving rows in Review, so the review mechanic is
 * learned on day one rather than discovered later when something has already
 * changed under them.
 *
 * The wording about compactness is deliberate and matches `propose_update`'s
 * own docstring (backend/server.py). Not every model is equally careful, and a
 * client that sends the whole record back on every suggestion produces a review
 * queue nobody will read.
 */
export const AUTOFILL_PROMPT =
  "Read my MyGist persona with the tools you have, then propose updates for " +
  "anything you already know about me that is missing or out of date. Send one " +
  "compact proposal per fact — only the fields that change — and give a " +
  "one-sentence reason for each.";
