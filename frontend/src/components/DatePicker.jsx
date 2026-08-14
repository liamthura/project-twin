/**
 * A date field: a button that reads the date, and a calendar in a popover.
 *
 * Replaces `<input type="date">`, whose calendar cannot be styled past
 * `color-scheme` -- which is why the old control carried
 * `[color-scheme:light] dark:[color-scheme:dark]`, a workaround for the browser
 * drawing a light-on-light calendar in dark mode. A popover the app owns needs
 * no such workaround.
 *
 * What carries over unchanged is the reason the old control had a text
 * fallback. Nothing validates a date field on write, so an MCP client can put
 * "next spring" or "Q2 2027" into `goals.target_date`. The native input dropped
 * any value it could not parse -- showing empty, then saving the emptiness on
 * the next edit -- and a calendar would do exactly the same. So a value that is
 * not a real calendar date is NOT handed to this component at all; ScalarField
 * keeps it in a text input. See `parseIsoDate` for what counts.
 *
 * `value` is the stored `yyyy-mm-dd` string or empty. `onChange` is called with
 * the same shape, never with a Date -- the storage format is the contract, and
 * a component that leaked Date objects would push the timezone problem into
 * every caller.
 */
import { useState } from "react";
import { CalendarDays, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatDateLabel, formatIsoDate, parseIsoDate } from "@/renderers/isoDate";

export function DatePicker({ id, value, onChange, placeholder = "Pick a date" }) {
  const [open, setOpen] = useState(false);
  const selected = parseIsoDate(value);

  const pick = (date) => {
    // react-day-picker calls onSelect with undefined when the selected day is
    // clicked again. Treating that as "cleared" is the calendar's own
    // convention and matches the segmented controls elsewhere in the app, which
    // also clear on a second press.
    onChange(date ? formatIsoDate(date) : "");
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className={cn(
              "w-[220px] justify-start gap-2 font-normal",
              !value && "text-muted-foreground",
            )}
          >
            <CalendarDays className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
            <span className="truncate">{value ? formatDateLabel(value) : placeholder}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <Calendar
            mode="single"
            // A month to open on when nothing is stored yet. Without it the
            // calendar starts on the current month, which is right -- this only
            // matters once something IS stored, where it must open on that
            // month rather than making the reader navigate back to it.
            defaultMonth={selected ?? undefined}
            selected={selected ?? undefined}
            onSelect={pick}
            autoFocus
          />
        </PopoverContent>
      </Popover>

      {/* Only once there is something to clear. A date field is optional, and
          the picker alone offers no way back to empty. */}
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => onChange("")}
          aria-label="Clear date"
          title="Clear date"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
