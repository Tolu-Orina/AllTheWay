import { useEffect, useState } from "react";
import { useT } from "@/app/i18n";
import { Link, useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth/useAuth";
import { AuthShell, FormError } from "@/routes/auth/AuthShell";
import { CodeInput } from "@/routes/auth/CodeInput";

const RESEND_SECONDS = 30;

export default function Verify() {
  const t = useT();
  const { adapter, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { email?: string } };
  const email = location.state?.email ?? user?.email ?? "";

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function verify(candidate: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await adapter.verifyCode(email, candidate);
    setBusy(false);
    if (res.ok) navigate("/app", { replace: true });
    else {
      setError(res.message);
      setCode("");
    }
  }

  async function resend() {
    setError(null);
    const res = await adapter.sendVerificationCode(email);
    if (!res.ok) setError(res.message);
    setCooldown(RESEND_SECONDS);
  }

  if (!email) {
    return (
      <AuthShell
        title="We need your email first"
        subtitle="Start from sign-in and we will send a fresh code."
      >
        <Button
          render={<Link to="/login" />}
          variant="brand"
          size="xl"
          className="w-full"
        >
          {t("auth.goToSignIn")}
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Check your email"
      subtitle={
        <>
          We sent a six-digit code to{" "}
          <span className="font-medium text-foreground">{email}</span>. It
          expires in 10 minutes.
        </>
      }
      footer={
        <Link
          to="/login"
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          {t("auth.useADifferentEmail")}
        </Link>
      }
    >
      <FormError message={error} />

      <CodeInput
        value={code}
        onChange={setCode}
        onComplete={verify}
        disabled={busy}
        invalid={!!error}
      />

      <Button
        variant="brand"
        size="xl"
        className="mt-6 w-full"
        disabled={busy || code.length < 6}
        onClick={() => verify(code)}
      >
        {busy ? "Checking…" : "Verify"}
      </Button>

      <p className="mt-4 text-center text-[13px] text-muted-foreground">
        {cooldown > 0 ? (
          <>Didn’t get it? You can resend in {cooldown}s.</>
        ) : (
          <>
            Didn’t get it?{" "}
            <button
              type="button"
              onClick={resend}
              className="font-medium text-blue-deep underline-offset-4 hover:underline dark:text-blue-bright"
            >
              {t("auth.sendANewCode")}
            </button>
          </>
        )}
      </p>
    </AuthShell>
  );
}
