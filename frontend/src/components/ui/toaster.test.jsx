// The toasts, over Sonner's stack: they stack rather than replace one another,
// tell their owner once when they go, close from their own buttons, and hold
// while a toast has keyboard focus -- which Sonner alone does not do, and
// which a keyboard reader's Undo depends on.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast as sonner } from "sonner";

import { Toaster } from "./toaster";
import { ToastAction } from "./toast";
import { toast } from "./use-toast";

// Sonner keeps its toasts in module scope, so each case clears its own.
afterEach(async () => {
  act(() => { sonner.dismiss(); });
  await new Promise((r) => setTimeout(r, 50));
});

const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("the toasts", () => {
  it("stack rather than replace one another, and each tells its owner once when it goes", async () => {
    render(<Toaster />);
    const first = vi.fn();
    let handle;
    act(() => { handle = toast({ title: "Hana added to Circle", onClose: first }); });
    act(() => { toast({ title: "Rejected Datadog" }); });
    expect(await screen.findByText("Hana added to Circle")).toBeInTheDocument();
    expect(screen.getByText("Rejected Datadog")).toBeInTheDocument();
    expect(first).not.toHaveBeenCalled();

    act(() => handle.dismiss());
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    await wait(50);
    expect(first).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Rejected Datadog")).toBeInTheDocument();
  });

  it("closes after its duration", async () => {
    render(<Toaster />);
    const onClose = vi.fn();
    act(() => { toast({ title: "Saved", duration: 60, onClose }); });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("closes from its own button, after the button has done its work", async () => {
    render(<Toaster />);
    const onClose = vi.fn();
    const undo = vi.fn(() => expect(onClose).not.toHaveBeenCalled());
    act(() => {
      toast({ title: "Rejected Datadog", onClose, action: <ToastAction altText="Undo" onClick={undo}>Undo</ToastAction> });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("holds while one of its buttons has keyboard focus, and runs again once it loses it", async () => {
    render(<Toaster />);
    const onClose = vi.fn();
    act(() => {
      toast({ title: "Deleted", duration: 100, onClose, action: <ToastAction onClick={() => {}}>Undo</ToastAction> });
    });
    const undo = await screen.findByRole("button", { name: "Undo" });
    act(() => undo.focus());
    await wait(300);
    expect(onClose).not.toHaveBeenCalled();

    act(() => undo.blur());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("draws the time left only on a toast with something to act on", async () => {
    render(<Toaster />);
    act(() => { toast({ title: "Saved" }); });
    act(() => { toast({ title: "Hana added to Circle", duration: 8000, action: <ToastAction>Undo</ToastAction> }); });
    await screen.findByText("Hana added to Circle");
    const bars = document.querySelectorAll("[data-toast-time]");
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveStyle({ animationDuration: "8000ms" });
  });
});

describe("Report on an error", () => {
  it("adds Report to a destructive toast, which opens the island with the error", async () => {
    const heard = vi.fn();
    window.addEventListener("mygist:feedback", heard);
    render(<Toaster />);
    act(() => {
      toast({ variant: "destructive", title: "Failed to save", description: "Could not reach the server." });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Report this problem" }));
    expect(heard.mock.calls[0][0].detail).toEqual({
      kind: "problem",
      message: 'The app said: "Failed to save. Could not reach the server."',
    });
    window.removeEventListener("mygist:feedback", heard);
  });

  it("leaves a toast's own action alone, and adds nothing to a plain toast", async () => {
    render(<Toaster />);
    act(() => {
      toast({ variant: "destructive", title: "Removed", action: <ToastAction altText="Undo">Undo</ToastAction> });
      toast({ title: "Saved" });
    });
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Report this problem" })).not.toBeInTheDocument();
  });
});
