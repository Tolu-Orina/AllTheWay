import { useState } from "react";
import { useT } from "@/app/i18n";
import { Link, useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth/useAuth";
import { isEmail } from "@/auth/types";
import {
  AuthShell,
  Field,
  FormError,
  GoogleButton,
} from "@/routes/auth/AuthShell";

export default function Login() {
  const t = useT();
  const { adapter } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const from = location.state?.from ?? "/app";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validate before submitting, so the first failure is not a round trip.
    const next: typeof fieldErrors = {};
    if (!isEmail(email)) next.email = "Enter a valid email address.";
    if (!password) next.password = "Enter your password.";
    setFieldErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    const res = await adapter.signIn(email, password);
    setBusy(false);
    if (res.ok) navigate(from, { replace: true });
    else setError(res.message);
  }

  async function google() {
    setError(null);
    setBusy(true);
    const res = await adapter.signInWithGoogle();
    setBusy(false);
    if (res.ok) navigate(from, { replace: true });
    else setError(res.message);
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Pick up where you and the companion left off."
      footer={
        <>
          New here?{" "}
          <Link
            to="/signup"
            className="font-medium text-blue-deep underline-offset-4 hover:underline dark:text-blue-bright"
          >
            {t("auth.createAnAccount")}
          </Link>
        </>
      }
    >
      <GoogleButton
        onClick={google}
        disabled={busy}
        label="Sign in with Google"
      />

      <div className="my-5 flex items-center gap-3 text-[12px] text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={submit} noValidate>
        <FormError message={error} />

        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />

        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
        />

        <div className="mb-5 text-right">
          <Link
            to="/forgot-password"
            className="text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("auth.forgotYourPassword")}
          </Link>
        </div>

        <Button
          type="submit"
          variant="brand"
          size="xl"
          className="w-full"
          disabled={busy}
        >
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
