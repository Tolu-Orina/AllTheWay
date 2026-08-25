import type { ReactNode } from "react";
import { Link } from "react-router";

import { Ambient } from "@/components/blocks/ambient";
import { Logo } from "@/components/primitives/logo";

/** One shell for every auth screen, so they cannot drift apart. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <Ambient />

      <Link to="/" className="mb-8 rounded-sm" aria-label="AllTheWay home">
        <Logo />
      </Link>

      <main className="w-full max-w-[26rem]">
        <div className="rounded-brand-lg border bg-card p-6 shadow-e2 sm:p-8">
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.02em]">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
          <div className="mt-6">{children}</div>
        </div>

        {footer ? (
          <p className="mt-5 text-center text-[14px] text-muted-foreground">
            {footer}
          </p>
        ) : null}
      </main>
    </div>
  );
}

/** Form-level error. Announced, never a raw stack trace. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mb-4 rounded-brand border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-destructive"
    >
      {message}
    </p>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  ...props
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [errorId, hintId].filter(Boolean).join(" ") || undefined
        }
        className="w-full rounded-brand border bg-background px-3.5 py-2.5 text-[14px] outline-none placeholder:text-muted-foreground aria-[invalid]:border-destructive"
        {...props}
      />
      {hint ? (
        <div id={hintId} className="mt-1.5 text-[12.5px] text-muted-foreground">
          {hint}
        </div>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1.5 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Google's mark. Inline so it works offline and needs no external request. */
export function GoogleButton({
  onClick,
  disabled,
  label = "Continue with Google",
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2.5 rounded-brand border bg-card px-4 py-2.5 text-[14px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
    >
      <svg viewBox="0 0 18 18" className="size-[18px]" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
        />
        <path
          fill="#FBBC05"
          d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
        />
      </svg>
      {label}
    </button>
  );
}
