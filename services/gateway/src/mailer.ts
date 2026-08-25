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

class ConsoleMailer implements Mailer {
  async sendCode(to: string, code: string, purpose: keyof typeof SUBJECTS) {
    console.info(`[mailer:console] ${SUBJECTS[purpose]} -> ${to}: ${code}`);
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
  if (env.production) {
    // Loud at boot, so this is discovered from the logs of a healthy service
    // rather than from a user who never received their code.
    console.error(`[mailer] ${UNCONFIGURED} Email-dependent routes will fail.`);
    return new UnconfiguredMailer();
  }
  return new ConsoleMailer();
}
