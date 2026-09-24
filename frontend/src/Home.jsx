/**
 * The page at `/`: the landing page, for everyone.
 *
 * A signed-in visitor sees "Open app" where a visitor sees "Sign in", rather
 * than being bounced into the app -- `/` is where the product is explained,
 * and someone who came to read it should be able to.
 */
import { useEffect, useState } from "react";

import Landing from "@/landing/Landing";
import { getAuthToken } from "@/lib/api.js";
import { hasSession } from "@/lib/session.js";
import { APP_PATH } from "@/lib/paths.js";

export default function Home() {
  const [signedIn, setSignedIn] = useState(() => Boolean(getAuthToken()));

  useEffect(() => {
    if (signedIn) return undefined;
    let cancelled = false;
    hasSession()
      .then((present) => { if (!cancelled) setSignedIn(present); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [signedIn]);

  return (
    <Landing
      signedIn={signedIn}
      onSignIn={() => window.location.assign(`${APP_PATH}/#/signin`)}
      onOpenApp={() => window.location.assign(`${APP_PATH}/`)}
    />
  );
}
