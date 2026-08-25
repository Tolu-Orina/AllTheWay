import { env } from "./env.js";

/**
 * Sending email is a real dependency with a real vendor, so it lives behind an
 * interface. Development logs to the console; production swaps in a provider
 * without touching a single call site.
 */
export interface Mailer {
  sendCode(to: string, code: string, purpose: "verify_email" | "reset_password"): Promise<void>;
}

const SUBJECTS = {
  verify_email: "Your AllTheWay verification code",
  reset_password: "Reset your AllTheWay password",
} as const;

const BODIES = {
  verify_email: (code: string) =>
    `Your AllTheWay verification code is ${code}.

` +
    `It expires in 10 minutes and can be used once.

` +
    `If you did not ask to verify this address, you can ignore this message.`,
  reset_password: (code: string) =>
    `Your AllTheWay password reset code is ${code}.

` +
    `It expires in 10 minutes and can be used once.

` +
    `If you did not ask to reset your password, ignore this message — your ` +
    `password has not changed.`,
} as const;

class ConsoleMailer implements Mailer {
  async sendCode(to: string, code: string, purpose: keyof typeof SUBJECTS) {
    console.info(`[mailer:console] ${SUBJECTS[purpose]} -> ${to}: ${code}`);
  }
}

/**
 * Resend, over plain fetch.
 *
 * No SDK on purpose: this is one POST with a JSON body, and a dependency that
 * ships its own HTTP client, retry policy and telemetry is a larger surface
 * than the thing it replaces.
 *
 * The body is deliberately plain text. An HTML mail carrying a six-digit code
 * gains nothing and loses the ability to be read by anything that is not a
 * browser, and code interpolated into markup is one escaping mistake away from
 * being an injection site.
 */
class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async sendCode(to: string, code: string, purpose: keyof typeof SUBJECTS) {
    // Bounded, because a hanging provider would otherwise hold the request
    // open until Cloud Run's own timeout and make sign-up look broken rather
    // than slow.
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to,
        subject: SUBJECTS[purpose],
        text: BODIES[purpose](code),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // The provider's message is useful (unverified domain, bad key, invalid
      // recipient) and contains no credential, so it is worth keeping. The
      // code is not in it and must never be added: this string reaches logs.
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Resend rejected the message (HTTP ${response.status}): ${detail.slice(0, 500)}`,
      );
    }
  }
}

const UNCONFIGURED =
  "No production mailer configured. Implement a provider (Resend/SendGrid/Postmark) before deploying.";

/**
 * Refuses to *send* in production rather than refusing to construct.
 *
 * The rule is unchanged and non-negotiable: a deployed service must never
 * quietly log a verification code to stdout where anyone with log access can
 * read it. This class still guarantees that — nothing is ever sent or logged.
 *
 * What changed is the blast radius. `createMailer()` is called at module load,
 * so throwing there took down the entire gateway: sessions, watchers and turns
 * all failed because email was unwired, and Cloud Run's smoke check on
 * /healthz failed for a reason unrelated to health. Failing at the point of use
 * keeps every other route working and makes the one broken thing say so.
 */
class UnconfiguredMailer implements Mailer {
  async sendCode(): Promise<never> {
    throw new Error(UNCONFIGURED);
  }
}

export function createMailer(): Mailer {
  // A real provider wherever it is configured, including locally: testing the
  // actual delivery path is the only way to find an unverified sending domain
  // before a user does.
  if (env.resendApiKey && env.mailFrom) {
    console.info(`[mailer] resend, from ${env.mailFrom}`);
    return new ResendMailer(env.resendApiKey, env.mailFrom);
  }

  if (env.production) {
    // Loud at boot, so this is discovered from the logs of a healthy service
    // rather than from a user who never received their code.
    //
    // Reached when only one of the two is set — a mounted key with no From
    // address, or the reverse — which is exactly the half-configured state
    // that would otherwise fail once per sign-up instead of once at startup.
    console.error(`[mailer] ${UNCONFIGURED} Email-dependent routes will fail.`);
    return new UnconfiguredMailer();
  }

  return new ConsoleMailer();
}
