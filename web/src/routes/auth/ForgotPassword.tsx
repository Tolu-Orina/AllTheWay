import { useState } from "react";
import { useT } from "@/app/i18n";
import { Link, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth/useAuth";
import { isEmail } from "@/auth/types";
import { AuthShell, Field, FormError } from "@/routes/auth/AuthShell";

export default function ForgotPassword() {
  const t = useT();
  const { adapter } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isEmail(email)) {
      setFieldError("Enter a valid email address.");
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    const res = await adapter.requestPasswordReset(email);
    setBusy(false);
    // Always advances, whether or not the address is registered: telling an
    // unauthenticated caller which emails exist is an account-enumeration leak.
    if (res.ok) navigate("/reset-password", { state: { email } });
    else setError(res.message);
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Give us the email on your account and we will send a six-digit code."
      footer={
        <Link
          to="/login"
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          {t("auth.backToSignIn")}
        </Link>
      }
    >
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
          error={fieldError}
        />
        <Button
          type="submit"
          variant="brand"
          size="xl"
          className="w-full"
          disabled={busy}
        >
          {busy ? "Sending…" : "Send code"}
        </Button>
      </form>
    </AuthShell>
  );
}
