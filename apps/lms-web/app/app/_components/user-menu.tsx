"use client";

import { LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { signOutAction } from "../_actions";

export function UserMenu({ name, email }: { name: string | null; email: string }) {
  const initials = (name ?? email).slice(0, 2).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="User menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--secondary)] text-sm font-medium text-[color:var(--secondary-foreground)] transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-[color:var(--foreground)]">
              {name ?? "Account"}
            </span>
            <span className="text-xs text-[color:var(--muted-foreground)]">{email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            // Prevent Radix from closing the menu *before* the action runs;
            // signOut() redirects, so the menu vanishes anyway.
            e.preventDefault();
            void signOutAction();
          }}
          className="cursor-pointer"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
