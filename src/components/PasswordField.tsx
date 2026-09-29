"use client";

import { useState } from "react";

/**
 * A password field you can read back.
 *
 * Typing a password blind is where most failed sign-ins come from, and on a
 * phone keyboard it is worse. The toggle is a button rather than a checkbox so
 * it can sit inside the field, and it is `type="button"` — inside a form, a
 * bare <button> submits, which would have made revealing the password attempt
 * a sign-in with whatever was typed so far.
 *
 * `defaultValue` rather than a controlled value: these forms post to a server
 * action, and the field only needs to survive the render it is in.
 */
export function PasswordField({
  label,
  name,
  autoComplete,
  required,
  minLength,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  defaultValue?: string;
}) {
  const [shown, setShown] = useState(false);

  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-[var(--l-heading)]">
        {label}
      </span>
      <div className="relative">
        <input
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className="w-full rounded-lg border border-[var(--l-border-strong)] bg-white px-3 py-2.5 pr-11 text-sm text-[var(--l-heading)] outline-none transition-colors placeholder:text-[var(--l-muted)] focus:border-[var(--l-accent)] focus:ring-2 focus:ring-[var(--l-accent-soft)]"
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          // The label says what pressing it does; aria-pressed says what state
          // it is in, so a screen reader user knows the password is exposed.
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          className="absolute right-1 top-1/2 grid h-8 w-9 -translate-y-1/2 place-items-center rounded-md text-[var(--l-muted)] transition-colors hover:text-[var(--l-heading)]"
        >
          {shown ? <EyeOff /> : <Eye />}
        </button>
      </div>
    </label>
  );
}

function Eye() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c6.4 0 10 7 10 7a17 17 0 0 1-3 3.9M6.3 6.3A17 17 0 0 0 2 13s3.6 7 10 7a9.6 9.6 0 0 0 4.2-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}
