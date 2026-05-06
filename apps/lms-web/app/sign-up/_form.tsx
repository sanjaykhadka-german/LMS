"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { signUpAction, type SignUpState } from "./actions";

const initial: SignUpState = { status: "idle" };

export function SignUpForm({ plan }: { plan?: string }) {
  const [state, action, pending] = useActionState(signUpAction, initial);

  return (
    <form action={action} className="space-y-4">
      {plan && <input type="hidden" name="plan" value={plan} />}
      <Field
        name="name"
        label="Full name"
        type="text"
        autoComplete="name"
        errors={state.status === "error" ? state.fieldErrors?.name : undefined}
      />
      <Field
        name="email"
        label="Work email"
        type="email"
        autoComplete="email"
        errors={state.status === "error" ? state.fieldErrors?.email : undefined}
      />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        hint="At least 8 characters."
        errors={state.status === "error" ? state.fieldErrors?.password : undefined}
      />
      {state.status === "error" && !state.fieldErrors && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {state.message}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}

function Field({
  name,
  label,
  type,
  autoComplete,
  hint,
  errors,
}: {
  name: string;
  label: string;
  type: string;
  autoComplete?: string;
  hint?: string;
  errors?: string[];
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        aria-invalid={errors ? true : undefined}
      />
      {errors && errors.length > 0 ? (
        <p className="text-xs text-red-600 dark:text-red-400">{errors[0]}</p>
      ) : hint ? (
        <p className="text-xs text-[color:var(--muted-foreground)]">{hint}</p>
      ) : null}
    </div>
  );
}
