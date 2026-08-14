/**
 * Step zero: what this is, and the offer to not do it yourself.
 *
 * The delegate offer sits ABOVE everything, before any field. It landed below a
 * step's own fields first and was moved deliberately: handing the work to a
 * client is a choice offered before the work, not a consolation found after it.
 */
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

import { WelcomeVisual } from "./WelcomeVisual";

export function StepWelcome({ onStart, onSkip }) {
  return (
    <div className="space-y-8">
      <div className="flex justify-center">
        <WelcomeVisual />
      </div>

      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to MyGist</h1>
        <p className="leading-relaxed text-muted-foreground">
          MyGist is one place to keep the context an AI assistant needs about
          you — your name, your work, how you like answers written — so you stop
          explaining yourself at the start of every conversation.
        </p>
      </div>

      <div className="rounded-lg border bg-muted/40 p-4">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="space-y-1">
            <p className="text-sm font-medium">You don't have to type any of it</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Connect an assistant and it can fill this in for you, a suggestion
              at a time, for you to approve. That is the next screen — and you
              can still type it yourself from there.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={onStart} className="sm:w-auto">
          Get started
        </Button>
        <Button variant="ghost" onClick={onSkip} className="sm:w-auto">
          Skip for now
        </Button>
      </div>
    </div>
  );
}
