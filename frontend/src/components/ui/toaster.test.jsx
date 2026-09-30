// The Toaster's own clock: a toast closes after its duration, holds while the
// pointer or focus is on it, and a toast that vanished from under the pointer
// leaves nothing held for the next one -- which is where Radix's own pause
// stuck, and Review's decisions with it.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "./toaster";
import { toast } from "./use-toast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => vi.runAllTimers());
  vi.useRealTimers();
});

const item = (title) => screen.getByText(title).closest("li");

describe("the Toaster's clock", () => {
  it("closes a toast after its duration, and holds it while hovered", () => {
    render(<Toaster />);
    const onClose = vi.fn();
    act(() => { toast({ title: "Approved", duration: 8000, onClose }); });

    fireEvent.pointerEnter(item("Approved"));
    act(() => vi.advanceTimersByTime(20000));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerLeave(item("Approved"));
    act(() => vi.advanceTimersByTime(7999));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes the next toast on time after one vanished from under the pointer", () => {
    render(<Toaster />);
    let first;
    act(() => { first = toast({ title: "Rejected", duration: 8000 }); });
    fireEvent.pointerEnter(item("Rejected"));
    // Undo clicked: gone while the pointer is on it, with no pointerleave.
    act(() => first.dismiss());
    act(() => vi.advanceTimersByTime(3000));

    const onClose = vi.fn();
    act(() => { toast({ title: "Approved", duration: 8000, onClose }); });
    act(() => vi.advanceTimersByTime(8000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays held while its button has focus, even once the pointer leaves", () => {
    render(<Toaster />);
    const onClose = vi.fn();
    act(() => {
      toast({ title: "Deleted", duration: 8000, onClose, action: <button type="button">Undo</button> });
    });
    fireEvent.pointerEnter(item("Deleted"));
    fireEvent.focus(screen.getByRole("button", { name: "Undo" }));
    fireEvent.pointerLeave(item("Deleted"));
    act(() => vi.advanceTimersByTime(20000));
    expect(onClose).not.toHaveBeenCalled();
  });
});
