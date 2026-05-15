"use client";

import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

export function CalendarSubscription({ feedUrl }: { feedUrl: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Some browsers block clipboard without a user gesture or over
      // http — fall back to selecting the input so the user can copy
      // manually. The native field below is already selectable.
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="ics-url">Subscription URL</Label>
        <div className="flex items-center gap-2">
          <Input
            id="ics-url"
            value={feedUrl}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCopy}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium text-foreground">
          How to subscribe
        </summary>
        <div className="mt-2 space-y-2">
          <p>
            <strong className="text-foreground">Google Calendar:</strong> open
            Calendar → Other calendars → <em>Add by URL</em>, paste the URL.
          </p>
          <p>
            <strong className="text-foreground">iOS / macOS Calendar:</strong>{" "}
            File → New Calendar Subscription, paste the URL, set auto-refresh
            to "Every hour".
          </p>
          <p>
            <strong className="text-foreground">Outlook:</strong> Add calendar
            → Subscribe from web, paste the URL.
          </p>
        </div>
      </details>
    </div>
  );
}
