import { useEffect } from "react";

import {
  LegalList,
  LegalPage,
  LegalSection,
  MailLink,
} from "@/components/blocks/legal-page";
import { Link } from "@/components/primitives/app-link";
import { LEGAL } from "@/legal";

/**
 * The contract for using AllTheWay.
 *
 * Written to match the product: confirm-before-act, no training on your work,
 * Stripe for paid plans, English law. It does not invent certifications,
 * SLAs, or refund windows the billing code does not implement.
 */
export default function TermsPage() {
  useEffect(() => {
    document.title = "Terms of Service · AllTheWay";
  }, []);

  return (
    <LegalPage
      eyebrow="Terms of Service"
      title="Terms of Service"
      lede={
        <>
          These terms are the agreement between you and {LEGAL.company} for
          using {LEGAL.product}. By creating an account or using the service you
          agree to them. If you are using AllTheWay for an organisation, you
          confirm you have authority to bind that organisation.
        </>
      }
    >
      <LegalSection title="1. The service">
        <p>
          AllTheWay is a work companion: you can talk, attach documents, run
          standing watchers, and — after you confirm — have it act on connected
          accounts such as a calendar or mail draft. Features, plan limits, and
          availability may change. We will try not to remove a capability you
          rely on without notice, but we do not promise any particular feature
          will remain in the same form.
        </p>
        <p>
          The service is provided over the internet. We aim for it to be
          available, but we do not warrant uninterrupted or error-free
          operation, and we are not liable for outages at Google Cloud, Stripe,
          or other processors we depend on.
        </p>
      </LegalSection>

      <LegalSection title="2. Your account">
        <p>
          You must provide an accurate email address and keep your sign-in
          details confidential. You are responsible for activity on the
          account. Tell us at <MailLink /> if you think someone else has used
          it. We may suspend an account that looks compromised, abusive, or in
          breach of these terms.
        </p>
        <p>
          You must be at least 16, or the age of digital consent in your
          country if that is higher.
        </p>
      </LegalSection>

      <LegalSection title="3. Confirm before it acts">
        <p>
          Irreversible or external actions — sending mail, creating or changing
          calendar events, payments, deletions — stop and wait for you. A
          watcher does not remove that stop. Clicking “Put on calendar”, “Save
          draft”, or an equivalent confirmation is your instruction to carry
          out the plan you were shown. You are responsible for checking that
          plan before you agree.
        </p>
      </LegalSection>

      <LegalSection title="4. Your content and connected accounts">
        <p>
          You keep ownership of the documents, messages, and other material
          you provide. You grant us a limited licence to host, process, and
          display that material solely to provide the service to you —
          including sending it to the model providers that generate replies.
        </p>
        <p>
          You must have the right to upload what you upload, and to connect
          the accounts you connect. If you connect Google Calendar or Gmail, you
          authorise us to use the token for the actions you confirm, and to
          read what those actions require (for example listing upcoming events
          when you ask).
        </p>
        <p>
          We do not train models on your documents, conversations, or meetings.
          Generated files belong to you, subject to any third-party rights in
          the underlying models or templates.
        </p>
      </LegalSection>

      <LegalSection title="5. Acceptable use">
        <p>You agree not to:</p>
        <LegalList
          items={[
            "Use the service to break the law, infringe anyone’s rights, or send spam or malware.",
            "Probe, overload, or interfere with the service, or attempt to access another person’s data.",
            "Reverse engineer the product except where the law says you may.",
            "Use outputs to impersonate a person, or present generated content as a human professional opinion (legal, medical, financial) that it is not.",
            "Resell or sublicense the service except under a written agreement with us.",
          ]}
        />
      </LegalSection>

      <LegalSection title="6. AI outputs">
        <p>
          Replies, drafts, summaries, and similar outputs can be wrong,
          incomplete, or out of date. They are not legal, medical, or
          financial advice. You must review anything before you rely on it or
          send it. We are not responsible for decisions you make on the basis
          of an output.
        </p>
      </LegalSection>

      <LegalSection title="7. Plans and payment">
        <p>
          Free and paid plans are described on the pricing page. Paid plans
          are billed by Stripe. Prices include applicable VAT where we are
          required to charge it. By starting a paid plan you authorise Stripe
          to charge the payment method you provide on the stated cadence until
          you cancel.
        </p>
        <p>
          You can cancel from Profile or by writing to us. Cancellation stops
          future renewal; it does not refund the current period unless the law
          requires it or we agree in writing. If a payment fails we may downgrade
          or suspend the paid features until it succeeds.
        </p>
        <p>
          Team and Enterprise terms, seats, and organisational controls are
          agreed separately. The public pricing cards are not a Team contract.
        </p>
      </LegalSection>

      <LegalSection title="8. Intellectual property">
        <p>
          AllTheWay, the mark, and the software are owned by {LEGAL.company} or
          its licensors. These terms do not transfer that ownership. You may
          not copy, modify, or create derivative works of the product except as
          needed to use it.
        </p>
      </LegalSection>

      <LegalSection title="9. Privacy">
        <p>
          How we handle personal data is described in the{" "}
          <Link
            href="/privacy"
            className="text-blue-deep underline underline-offset-2 dark:text-blue-bright"
          >
            Privacy Policy
          </Link>
          , which forms part of this agreement.
        </p>
      </LegalSection>

      <LegalSection title="10. Suspension and termination">
        <p>
          You may close your account at any time by writing to <MailLink />.
          We may suspend or close an account for breach, non-payment, legal
          risk, or if we discontinue the service. After closure we delete or
          anonymise your data as described in the Privacy Policy, except what
          we must keep.
        </p>
      </LegalSection>

      <LegalSection title="11. Disclaimers">
        <p>
          The service is provided “as is” and “as available”. To the fullest
          extent permitted by law we disclaim implied warranties of
          merchantability, fitness for a particular purpose, and
          non-infringement. We do not warrant that outputs will meet your
          requirements or that connected third-party services will remain
          available on the same terms.
        </p>
      </LegalSection>

      <LegalSection title="12. Limitation of liability">
        <p>
          Nothing in these terms limits liability for death or personal injury
          caused by negligence, fraud, or any liability that English law does
          not allow to be limited.
        </p>
        <p>
          Subject to that, we are not liable for indirect, incidental, special,
          consequential, or punitive loss, or for lost profits, revenue, data,
          or goodwill, whether in contract, tort, or otherwise, even if we were
          told they were possible.
        </p>
        <p>
          Our total liability arising out of or in connection with the service
          in any twelve-month period is limited to the greater of (a) the
          amounts you paid us for the service in that period and (b) one
          hundred pounds sterling (£100).
        </p>
      </LegalSection>

      <LegalSection title="13. Indemnity">
        <p>
          You will indemnify us against claims, damages, and reasonable costs
          arising from your content, your use of the service in breach of these
          terms, or your connected accounts, except to the extent caused by our
          own negligence or wilful misconduct.
        </p>
      </LegalSection>

      <LegalSection title="14. Changes">
        <p>
          We may update these terms. The date at the top is the last change.
          Continued use after a change is acceptance of the new terms. If you
          do not agree, stop using the service and ask us to close the account.
        </p>
      </LegalSection>

      <LegalSection title="15. General">
        <p>
          These terms are the entire agreement for the service and replace
          prior discussions about it. If a court finds a clause unenforceable,
          the rest remains. You may not assign these terms without our consent;
          we may assign them to an affiliate or a successor. Failure to enforce
          a term is not a waiver.
        </p>
        <p>
          These terms are governed by the laws of England and Wales. The
          courts of England and Wales have exclusive jurisdiction, except that
          we may seek injunctive relief anywhere.
        </p>
        <p>
          Notices to us: <MailLink />, or {LEGAL.address}. Notices to you: the
          email on the account.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
