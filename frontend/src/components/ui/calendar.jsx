// The month grid, adapted from shadcn's Calendar.
//
// Three deliberate departures from the registry copy:
//
//   - JSX, not TSX, and no `size-*` utilities. `size-8` needs Tailwind 3.4 and
//     works here, but every other component in this codebase writes `h-8 w-8`,
//     and one file using the other spelling is the kind of thing that makes a
//     reader check whether it matters.
//   - No stylesheet import. react-day-picker ships `style.css`, but every
//     structural class it uses is overridden below, so importing it would add a
//     second source of truth for the same layout.
//   - The classNames keys come from react-day-picker's own `UI`, `DayFlag` and
//     `SelectionState` enums (read out of the installed package, not copied from
//     a v8 example) -- v9 renamed most of them, and a key that no longer exists
//     fails silently as an unstyled grid.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export function Calendar({ className, classNames, showOutsideDays = true, ...props }) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        // `relative` here, not on month_caption. The nav is a child of THIS
        // element -- react-day-picker v9 renders it as a sibling of `month`, not
        // inside the caption -- so with the caption positioned instead, the
        // absolutely-placed nav below resolved against whatever happened to be
        // positioned further up the tree (the popover). It landed in roughly the
        // right place by luck, and would have moved the moment this was used
        // anywhere else.
        months: "relative flex flex-col gap-2 sm:flex-row",
        month: "flex flex-col gap-4",
        // Same height as the nav, so the caption row and the arrows occupy one
        // band rather than the arrows almost fitting above the weekdays.
        month_caption: "flex h-9 items-center justify-center",
        caption_label: "text-sm font-medium",
        nav: "absolute right-0 top-0 flex h-9 items-center gap-1",
        // 36px, the same as a day button, rather than shadcn's 28. The app has a
        // `tap-target` utility for undersized controls (globals.css) and it is
        // deliberately NOT used here: it extends the hit area 6px in every
        // direction, and two arrows a gap-1 apart would end up with overlapping
        // targets. Sending "previous" to "next" is worse than a small button, so
        // these get real size instead of a bigger invisible one.
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-9 w-9 bg-transparent p-0 opacity-60 hover:opacity-100",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-9 w-9 bg-transparent p-0 opacity-60 hover:opacity-100",
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 text-[0.8rem] font-normal text-muted-foreground",
        week: "mt-2 flex w-full",
        day: "relative h-9 w-9 p-0 text-center text-sm focus-within:relative focus-within:z-20",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal",
        ),
        // Selected has to out-specify day_button's ghost hover, or the day the
        // reader picked loses its fill the moment the pointer crosses it.
        selected:
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button:hover]:bg-primary [&>button:hover]:text-primary-foreground [&>button:focus]:bg-primary [&>button:focus]:text-primary-foreground",
        today: "[&>button]:bg-accent [&>button]:text-accent-foreground",
        outside: "text-muted-foreground opacity-50",
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        // v9 replaced the two icon slots with one that reports which way it
        // points. lucide is already the app's icon set.
        Chevron: ({ orientation, ...rest }) =>
          orientation === "left" ? (
            <ChevronLeft className="h-4 w-4" {...rest} />
          ) : (
            <ChevronRight className="h-4 w-4" {...rest} />
          ),
      }}
      {...props}
    />
  );
}
