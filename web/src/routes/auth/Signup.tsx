import { useEffect, useRef, useState } from "react";
import { useT } from "@/app/i18n";
import { Check, X } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth/useAuth";
import { PASSWORD_RULES, isEmail, passwordProblems } from "@/auth/types";
import { rememberAfterAuth, takeAfterAuth } from "@/auth/firebase-auth";
import { APP_HOME, LOGIN, VERIFY } from "@/auth/paths";
import {
  AuthShell,
  Field,
  FormError,
  GoogleButton,
} from "@/routes/auth/AuthShell";
import { cn } from "@/lib/utils";

/** Requirements are shown as you type, so a failed submit is never the first news. */
function PasswordRules({ password }: { password: string }) {
  return (
    <ul className="mt-2 space-y-1">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li
            key={rule.label}
            className={cn(
              "flex items-center gap-1.5 text-[12.5px]",
              met ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {met ? (
              <Check className="size-3.5 text-primary" aria-hidden="true" />
            ) : (
              <X className="size-3.5 text-ink-faint" aria-hidden="true" />
            )}
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}

export default function Signup() {
  const t = useT();
  const { adapter, user, loading } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    if (loading || !user || submitting.current) return;
    if (!user.emailVerified) {
      navigate(VERIFY, { state: { email: user.email }, replace: true });
      return;
    }
    navigate(takeAfterAuth(APP_HOME), { replace: true });
  }, [user, loading, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const next: typeof fieldErrors = {};
    if (!isEmail(email)) next.email = "Enter a valid email address.";
    const problems = passwordProblems(password);
    if (problems.length)
      next.password = `Password still needs: ${problems.join(", ").toLowerCase()}.`;
    setFieldErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    submitting.current = true;
    const created = await adapter.signUp(email, password);
    if (!created.ok) {
      submitting.current = false;
      setBusy(false);
      setError(created.message);
      return;
    }
    // Send the code immediately: the next screen is where it gets entered.
    await adapter.sendVerificationCode(email);
    setBusy(false);
    navigate(VERIFY, { state: { email }, replace: true });
  }

  async function google() {
    setError(null);
    setGoogleBusy(true);
    rememberAfterAuth(APP_HOME);
    const res = await adapter.signInWithGoogle();
    if (!res.ok) {
      setGoogleBusy(false);
      setError(res.message);
      return;
    }
    if (res.redirected) return;
    setGoogleBusy(false);
    navigate(APP_HOME, { replace: true });
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free to start. Nothing irreversible happens without your say-so."
      footer={
        <>
          Already have an account?{" "}
          <Link
            to={LOGIN}
            className="font-medium text-blue-deep underline-offset-4 hover:underline dark:text-blue-bright"
          >
            {t("auth.signIn")}
          </Link>
        </>
      }
    >
      <GoogleButton
        onClick={google}
        disabled={busy || googleBusy}
        label="Sign up with Google"
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
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          hint={<PasswordRules password={password} />}
        />

        <Button
          type="submit"
          variant="brand"
          size="xl"
          className="mt-2 w-full"
          disabled={busy || googleBusy}
        >
          {busy ? "Creating your account…" : "Create account"}
        </Button>
        <p className="mt-4 text-center text-[12.5px] leading-relaxed text-muted-foreground">
          By creating an account you agree to the{" "}
          <Link
            to="/terms"
            className="font-medium text-blue-deep underline-offset-2 hover:underline dark:text-blue-bright"
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            to="/privacy"
            className="font-medium text-blue-deep underline-offset-2 hover:underline dark:text-blue-bright"
          >
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthShell>
  );
}
