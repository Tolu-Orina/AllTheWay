import { useState } from "react";
import { useT } from "@/app/i18n";
import { Check, X } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth/useAuth";
import { PASSWORD_RULES, isEmail, passwordProblems } from "@/auth/types";
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
  const { adapter } = useAuth();
  const navigate = useNavigate();

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

    const next: typeof fieldErrors = {};
    if (!isEmail(email)) next.email = "Enter a valid email address.";
    const problems = passwordProblems(password);
    if (problems.length)
      next.password = `Password still needs: ${problems.join(", ").toLowerCase()}.`;
    setFieldErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    const created = await adapter.signUp(email, password);
    if (!created.ok) {
      setBusy(false);
      setError(created.message);
      return;
    }
    // Send the code immediately: the next screen is where it gets entered.
    await adapter.sendVerificationCode(email);
    setBusy(false);
    navigate("/verify", { state: { email }, replace: true });
  }

  async function google() {
    setError(null);
    setBusy(true);
    const res = await adapter.signInWithGoogle();
    setBusy(false);
    if (res.ok) navigate("/app", { replace: true });
    else setError(res.message);
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free to start. Nothing irreversible happens without your say-so."
      footer={
        <>
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-medium text-blue-deep underline-offset-4 hover:underline dark:text-blue-bright"
          >
            {t("auth.signIn")}
          </Link>
        </>
      }
    >
      <GoogleButton
        onClick={google}
        disabled={busy}
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
          disabled={busy}
        >
          {busy ? "Creating your account…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}
