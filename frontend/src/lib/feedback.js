/**
 * Feedback from the island (components/FeedbackIsland.jsx) to POST /api/feedback.
 *
 * reportContext() is the source of the form's "Sent with this report" line:
 * the page, the version and commit, the browser and the screen size. Nothing
 * from the persona. Who sent it the server takes from the session.
 */
import { api } from "./api.js";

/** The island listens for this; an error toast's Report fires it. */
export const FEEDBACK_EVENT = "mygist:feedback";

const LONG_EDGE = 2000;
// backend/feedback_store.py MAX_SCREENSHOT.
export const MAX_IMAGE = 2 * 1024 * 1024;

export function openFeedback(prefill) {
  window.dispatchEvent(new CustomEvent(FEEDBACK_EVENT, { detail: prefill }));
}

export function reportContext() {
  return {
    page: window.location.hash || "#/",
    version: typeof __APP_VERSION__ === "undefined" ? "dev" : __APP_VERSION__,
    commit: typeof __APP_COMMIT__ === "undefined" ? "dev" : __APP_COMMIT__,
    browser: navigator.userAgent,
    screen: `${window.innerWidth}×${window.innerHeight}`,
  };
}

// Bare base64, the shape the endpoint takes.
function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function sendFeedback({ kind, message, screenshot = null }) {
  return api("/feedback", {
    method: "POST",
    body: JSON.stringify({
      kind,
      message,
      context: reportContext(),
      screenshot: screenshot ? await toBase64(screenshot) : null,
    }),
  });
}

const toJpeg = (canvas, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

/**
 * An image as a JPEG at most 2000 px on its long edge. Drawing it again on a
 * canvas drops its EXIF, which is where a phone photo keeps its location.
 * Rejects with "unreadable" or "too-large".
 */
export async function shrinkImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("unreadable");
  }
  const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  // JPEG has no transparency; a transparent PNG would otherwise turn black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.9, 0.7]) {
    const blob = await toJpeg(canvas, quality);
    if (blob && blob.size <= MAX_IMAGE) return blob;
  }
  throw new Error("too-large");
}
