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
 * What we do with what you give us.
 *
 * Claims below were checked against the product, not copied from a template:
 * per-user paths and no collection-group queries; transcripts off by default;
 * deleting a document removes its chunks; meetings off until switched on;
 * time zone rather than GPS. We do not claim a certification, a retention
 * schedule the code does not enforce, or a lawful-basis table we have not
 * applied.
 */
export default function PrivacyPage() {
  useEffect(() => {
    document.title = "Privacy Policy · AllTheWay";
  }, []);

  return (
    <LegalPage
      eyebrow="Privacy Policy"
      title="What we do with what you give us"
      lede={
        <>
          This policy explains how {LEGAL.company} (“we”, “us”) collects, uses,
          stores, and shares personal data when you use {LEGAL.product} at{" "}
          {LEGAL.site}. If something here is not accurate, write to us and we
          will fix the product or this page.
        </>
      }
    >
      <LegalSection title="1. Who is responsible">
        <p>
          The data controller is {LEGAL.company}, a private limited company
          registered in England and Wales (company number {LEGAL.number}),
          registered office {LEGAL.address}.
        </p>
        <p>
          For questions, access requests, or deletion, write to <MailLink />.
          A person will answer. You may also complain to the Information
          Commissioner’s Office (ICO) in the United Kingdom.
        </p>
      </LegalSection>

      <LegalSection title="2. The data we collect">
        <p>Depending on how you use the product, we may process:</p>
        <LegalList
          items={[
            "Account data: email address, display name, hashed authentication identifiers from Firebase Authentication, and the plan you are on.",
            "Work you create: messages, documents you upload, generated files, watcher instructions, and meeting notes you have enabled.",
            "Connected-account tokens: if you connect Google Calendar, Gmail, Drive, or similar, we hold the token needed to act on your behalf and use it only for actions you have confirmed.",
            "Usage and diagnostics: timestamps, session identifiers, error reports, and approximate product usage needed to operate the service and your plan limits.",
            "Payment data: Stripe handles card details. We receive subscription status, customer identifiers, and invoices — never your full card number.",
            "Device context: the IANA time zone this device reports, the zone on a connected calendar, and any override you set. We do not use GPS and we do not guess a city from your IP address.",
          ]}
        />
      </LegalSection>

      <LegalSection title="3. How we use it">
        <p>We use this data to:</p>
        <LegalList
          items={[
            "Provide, maintain, and improve AllTheWay — including answering you, drafting, putting things on a calendar after you confirm, and running watchers you created.",
            "Authenticate you, keep the service secure, and prevent abuse.",
            "Bill paid plans through Stripe and send transactional mail (verification, receipts, security notices).",
            "Comply with law and enforce the Terms of Service.",
          ]}
        />
        <p>
          We do not sell your personal data. We do not train any model on your
          documents, conversations, or meetings.
        </p>
      </LegalSection>

      <LegalSection title="4. Legal bases (UK GDPR)">
        <p>
          Where UK GDPR applies, we rely on: performing a contract with you
          (providing the service you signed up for); legitimate interests in
          operating, securing, and improving the product in ways that do not
          override your rights; consent where we ask for it (for example
          connecting a third-party account, or turning meeting notes on); and
          legal obligation where we must retain or disclose information.
        </p>
      </LegalSection>

      <LegalSection title="5. Your work is yours alone">
        <p>
          Everything you create is stored under your own user path. Nothing
          in the system queries across users, and a check in our build fails if
          anyone adds a query that could.
        </p>
      </LegalSection>

      <LegalSection title="6. Spoken conversations and meetings">
        <p>
          Keeping a record of what is said is off until you turn it on, in
          Profile. When it is on, both sides of the conversation are saved to
          that session and you can delete any session’s record afterwards.
        </p>
        <p>
          The companion never joins a meeting unless you have enabled it, and
          everyone in the room is asked before it connects. It listens and
          takes notes. It cannot speak in a meeting — that is a property of
          how it is built, not a setting.
        </p>
      </LegalSection>

      <LegalSection title="7. Deleting means deleting">
        <p>
          Removing a document removes what was learned from it: the text we
          extracted and the pieces used to answer questions go with it.
          Corrections you have made are kept as a record you can see and
          reverse, because a companion that quietly forgets why it changed its
          mind is not one you can check.
        </p>
        <p>
          Closing your account: write to <MailLink /> and we will delete the
          account and the data stored under it, except what we must keep for
          legal, tax, or security reasons (for example a ledger of a confirmed
          payment).
        </p>
      </LegalSection>

      <LegalSection title="8. Who else is involved">
        <p>
          We run on Google Cloud (including Firebase Authentication and Google’s
          models, which process what you say and write in order to answer). If
          you connect an account such as Google Calendar, we hold the token
          needed to act on your behalf and use it only for what you have
          confirmed. Payments are handled by Stripe.
        </p>
        <p>
          Those processors act on our instructions. Some processing takes place
          outside the United Kingdom. Where that happens we use appropriate
          safeguards, such as the mechanisms Google Cloud and Stripe publish
          for international transfers.
        </p>
      </LegalSection>

      <LegalSection title="9. How long we keep it">
        <p>
          Account and work data last as long as the account is open. Watcher
          runs, session traces, and generated files stay until you delete them
          or close the account. Billing records are kept as long as tax law
          requires. Backups expire on a rolling window; deletion from the live
          system is not instant in every replica.
        </p>
      </LegalSection>

      <LegalSection title="10. Cookies and local storage">
        <p>
          We use storage required to sign you in, keep you signed in, remember
          language and similar preferences, and operate the product. We do
          not use third-party advertising cookies, and we do not run a
          marketing pixel on these pages.
        </p>
      </LegalSection>

      <LegalSection title="11. Your rights">
        <p>
          Subject to UK data protection law, you can ask us to access, correct,
          delete, or export your personal data, to restrict or object to certain
          processing, and to withdraw consent where we relied on it. Write to{" "}
          <MailLink />. We will respond within one month, or tell you if we
          need longer.
        </p>
      </LegalSection>

      <LegalSection title="12. Children">
        <p>
          AllTheWay is not directed at children under 16. We do not knowingly
          collect personal data from them. If you believe a child has created
          an account, write to us and we will delete it.
        </p>
      </LegalSection>

      <LegalSection title="13. Changes">
        <p>
          We will update this page when the product or the law changes. The
          date at the top is the last change. Continued use after a change
          means you are using the product under the updated policy. Material
          changes that affect your rights will be posted here; we may also
          email the address on the account.
        </p>
      </LegalSection>

      <LegalSection title="14. Related terms">
        <p>
          Use of the product is also governed by our{" "}
          <Link
            href="/terms"
            className="text-blue-deep underline underline-offset-2 dark:text-blue-bright"
          >
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
