"use client";

import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import {
  runAssignmentRemindersAction,
  runWhsRemindersAction,
} from "../_actions/reminders";

export function AssignmentReminderButton() {
  return (
    <form
      action={runAssignmentRemindersAction}
      onSubmit={(e) => {
        if (
          !confirm(
            "Send a reminder email to every employee with outstanding training?",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <Submit label="Send pending-assignment reminders" />
    </form>
  );
}

export function WhsReminderButton() {
  return (
    <form
      action={runWhsRemindersAction}
      onSubmit={(e) => {
        if (
          !confirm(
            "Send WHS expiry reminders now? Records reminded in the last 14 days are skipped.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <Submit label="Send WHS expiry reminders" />
    </form>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? "Sending…" : label}
    </Button>
  );
}
