import { useEffect, useRef, useState } from "react";
import type { AccountState, RememberedAccount } from "../../../shared/ipc";

/** The first letter of the name, or of the email when there is no name yet. */
function initial(account: AccountState): string {
  const source = account.name || account.email || "?";
  return source.trim().charAt(0).toUpperCase();
}

/**
 * Who is signed in, at the foot of the sidebar: a round initial, the name and the plan. Clicking
 * it opens upwards, because there is no room below.
 */
export function ProfileMenu({ account }: { account: AccountState }) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const name = account.name || account.email || "You";
  // Other accounts on this Mac (work and personal, say): one click to switch. Null where the app
  // cannot switch (the Electron app), and the menu then shows only Sign out.
  const [others, setOthers] = useState<RememberedAccount[] | null>(null);
  useEffect(() => {
    if (!open) return;
    void window.subx.auth.accounts().then(
      (list) => setOthers(list.filter((item) => !item.current)),
      () => setOthers(null),
    );
  }, [open]);

  // A menu that stays open after you look away is a menu in the way.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div ref={holder} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-[12px] px-1.5 py-1.5 text-left transition-colors hover:bg-side-rule/60"
      >
        {account.photo ? (
          <img src={account.photo} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-side-accent font-display text-[15px] [font-weight:var(--display-weight)] text-side">
            {initial(account)}
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate font-semibold">{name}</span>
          {/* The email, not a plan name: there are no plans to name until billing exists. */}
          {account.email && <span className="block truncate text-xs text-side-soft">{account.email}</span>}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-2 w-60 rounded-[12px] border border-rule-strong bg-paper p-1 text-ink shadow-[0_8px_24px_rgb(var(--shade)/18%)]"
        >
          <div className="border-b border-rule px-3 py-2.5">
            {account.name && <p className="truncate font-semibold">{account.name}</p>}
            <p className="truncate text-xs text-ink-soft">{account.email}</p>
          </div>
          {others?.map((other) => (
            <button
              key={other.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void window.subx.auth.switchTo(other.id).catch((error: unknown) => {
                  alert(error instanceof Error ? error.message : "Couldn't switch. Sign in again.");
                });
              }}
              className="mt-1 flex w-full min-w-0 items-center gap-2 rounded-[8px] px-3 py-2 text-left hover:bg-well"
            >
              {other.photo ? (
                <img src={other.photo} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-well text-xs font-semibold">
                  {(other.name || other.email).trim().charAt(0).toUpperCase()}
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-[13px]">Switch to {other.name || other.email}</span>
                {other.name && <span className="block truncate text-xs text-ink-soft">{other.email}</span>}
              </span>
            </button>
          ))}
          {others && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void window.subx.auth.addAccount();
              }}
              className="mt-1 w-full rounded-[8px] px-3 py-2 text-left text-ink-soft hover:bg-well hover:text-ink"
            >
              Add another account
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void window.subx.auth.signOut();
            }}
            className="mt-1 w-full rounded-[8px] px-3 py-2 text-left text-ink-soft hover:bg-well hover:text-ink"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
