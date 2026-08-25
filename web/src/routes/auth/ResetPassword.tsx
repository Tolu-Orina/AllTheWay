import { useState } from "react";
import { Check, X } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth/useAuth";
import { PASSWORD_RULES, passwordProblems } from "@/auth/types";
import { AuthShell, Field, FormError } from "@/routes/auth/AuthShell";
import { CodeInput } from "@/routes/auth/CodeInput";
import { cn } from "@/lib/utils";

export default function ResetPassword() {
  const { adapter } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { email?: string } };
  const email = location.state?.email ?? "";

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const problems = passwordProblems(password);
    if (problems.length) {
      setFieldError(
        `Password still needs: ${problems.join(", ").toLowerCase()}.`,
      );
      return;
    }
    if (code.length < 6) {
      setError("Enter the six-digit code from your email.");
      return;
    }
    setFieldError(undefined);

    setBusy(true);
    const res = await adapter.resetPassword(email, code, password);
    setBusy(false);
    if (res.ok) navigate("/login", { replace: true });
    else setError(res.message);
  }

  if (!email) {
    return (
      <AuthShell
        title="Start from the beginning"
        subtitle="We need the email on your account before we can reset it."
      >
        <Button
          render={<Link to="/forgot-password" />}
          variant="brand"
          size="xl"
          className="w-full"
        >
          Request a code
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle={
        <>
          Enter the code we sent to{" "}
          <span className="font-medium text-foreground">{email}</span>.
        </>
      }
      footer={
        <Link
          to="/login"
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={submit} noValidate>
        <FormError message={error} />

        <div className="mb-5">
          <span className="mb-1.5 block text-[13px] font-medium">
            Verification code
          </span>
          <CodeInput
            value={code}
            onChange={setCode}
            disabled={busy}
            invalid={!!error}
          />
        </div>

        <Field
          id="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldError}
          hint={
            <ul className="space-y-1">
              {PASSWORD_RULES.map((rule) => {
                const met = rule.test(password);
                return (
                  <li
                    key={rule.label}
                    className={cn(
                      "flex items-center gap-1.5",
                      met ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {met ? (
                      <Check
                        className="size-3.5 text-primary"
                        aria-hidden="true"
                      />
                    ) : (
                      <X
                        className="size-3.5 text-ink-faint"
                        aria-hidden="true"
                      />
                    )}
                    {rule.label}
                  </li>
                );
              })}
            </ul>
          }
        />

        <Button
          type="submit"
          variant="brand"
          size="xl"
          className="mt-2 w-full"
          disabled={busy}
        >
          {busy ? "Saving…" : "Save new password"}
        </Button>
      </form>
    </AuthShell>
  );
}
