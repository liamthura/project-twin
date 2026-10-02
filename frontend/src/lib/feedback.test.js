import { describe, it, expect, vi, beforeEach } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api.js", () => ({ api: apiMock }));

const { FEEDBACK_EVENT, openFeedback, reportContext, sendFeedback, shrinkImage, MAX_IMAGE } =
  await import("./feedback.js");

let drawn;
let qualities;
beforeEach(() => {
  apiMock.mockReset().mockResolvedValue({ id: 7 });
  drawn = null;
  qualities = [];
  globalThis.createImageBitmap = vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() }));
  HTMLCanvasElement.prototype.getContext = vi.fn(function () {
    return { fillRect: vi.fn(), drawImage: (_b, _x, _y, w, h) => (drawn = [w, h]) };
  });
  HTMLCanvasElement.prototype.toBlob = vi.fn(function (done, type, quality) {
    qualities.push(quality);
    done(new Blob(["x".repeat(10)], { type }));
  });
});

describe("shrinkImage", () => {
  it("draws the long edge at 2000 px and saves a JPEG", async () => {
    const blob = await shrinkImage(new Blob(["png"]));
    expect(drawn).toEqual([2000, 1500]);
    expect(blob.type).toBe("image/jpeg");
    expect(qualities).toEqual([0.9]);
  });

  it("leaves a small image its size", async () => {
    globalThis.createImageBitmap = vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() }));
    await shrinkImage(new Blob(["png"]));
    expect(drawn).toEqual([800, 600]);
  });

  it("tries a lower quality once, then refuses", async () => {
    HTMLCanvasElement.prototype.toBlob = vi.fn(function (done, type, quality) {
      qualities.push(quality);
      done({ size: MAX_IMAGE + 1, type });
    });
    await expect(shrinkImage(new Blob(["png"]))).rejects.toThrow("too-large");
    expect(qualities).toEqual([0.9, 0.7]);
  });

  it("says when it cannot read the image", async () => {
    globalThis.createImageBitmap = vi.fn(async () => {
      throw new Error("decode");
    });
    await expect(shrinkImage(new Blob(["heic"]))).rejects.toThrow("unreadable");
  });
});

describe("sendFeedback", () => {
  it("posts the report, what goes with it, and the screenshot as base64", async () => {
    window.location.hash = "#/review";
    await sendFeedback({ kind: "idea", message: "hi", screenshot: new Blob(["abc"], { type: "image/jpeg" }) });
    const [endpoint, options] = apiMock.mock.calls[0];
    expect(endpoint).toBe("/feedback");
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ kind: "idea", message: "hi", screenshot: btoa("abc") });
    expect(Object.keys(body.context).sort()).toEqual(["browser", "commit", "page", "screen", "version"]);
    expect(body.context.page).toBe("#/review");
  });

  it("sends no screenshot when there is none", async () => {
    await sendFeedback({ kind: "problem", message: "hi" });
    expect(JSON.parse(apiMock.mock.calls[0][1].body).screenshot).toBeNull();
  });
});

describe("openFeedback", () => {
  it("asks the island to open, with what to fill in", () => {
    const heard = vi.fn();
    window.addEventListener(FEEDBACK_EVENT, heard);
    openFeedback({ kind: "problem", message: 'The app said: "Failed to save"' });
    expect(heard.mock.calls[0][0].detail).toEqual({ kind: "problem", message: 'The app said: "Failed to save"' });
    window.removeEventListener(FEEDBACK_EVENT, heard);
  });
});

it("reportContext names the screen size", () => {
  expect(reportContext().screen).toBe(`${window.innerWidth}×${window.innerHeight}`);
});
