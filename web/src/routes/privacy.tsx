import { useEffect } from "react";

import { SiteHeader } from "@/components/blocks/site-header";
import { SiteFooter } from "@/components/blocks/site-footer";
import { Link } from "@/components/primitives/app-link";

const MAILTO = "mailto:alltheway@rinegansolutions.com";

/**
 * What we do with what you give us.
 *
 * Every claim here is one the code actually keeps, and each was checked against
 * the thing that enforces it rather than written from a template:
 *
 *   - per-user paths and no collection-group queries — `scripts/check-tenant-isolation.py`
 *   - transcripts off by default — `keepsTranscripts` in the gateway
 *   - deleting a document removes its chunks — the librarian's delete path
 *   - meetings off until switched on, and the scribe cannot speak
 *
 * Deliberately not claimed: a compliance certification, a retention schedule we
 * do not enforce in code, or a lawful-basis table copied from a template. A
 * privacy page that overstates is worse than a short one that does not, because
 * the overstatement is the part a reader would rely on.
 */
export default function PrivacyPage() {
  useEffect(() => {
    document.title = "Privacy · AllTheWay";
  }, []);

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <section className="mx-auto w-full max-w-[44rem] px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
          <p className="text-[12px] font-semibold tracking-[0.12em] text-blue-deep uppercase dark:text-blue-bright">
            Privacy
          </p>
          <h1 className="mt-3 text-[32px] leading-tight font-semibold tracking-[-0.015em] sm:text-[40px]">
            What we do with what you give us
          </h1>
          <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
            Short, and true. If something below is not accurate, tell us and we
            will fix the product or the page.
          </p>

          <div className="mt-12 flex flex-col gap-9 text-[15.5px] leading-relaxed">
            <section>
              <h2 className="text-[19px] font-semibold">Your work is yours alone</h2>
              <p className="mt-2 text-muted-foreground">
                Everything you create is stored under your own user path. Nothing
                in the system queries across users, and a check in our build
                fails if anyone adds a query that could. We do not train any
                model on your documents, conversations, or meetings.
              </p>
            </section>

            <section>
              <h2 className="text-[19px] font-semibold">Spoken conversations are not recorded by default</h2>
              <p className="mt-2 text-muted-foreground">
                Keeping a record of what is said is off until you turn it on, in
                Profile. When it is on, both sides of the conversation are saved
                to that session and you can delete any session's record
                afterwards.
              </p>
            </section>

            <section>
              <h2 className="text-[19px] font-semibold">Meetings are off until you switch them on</h2>
              <p className="mt-2 text-muted-foreground">
                The companion never joins a meeting unless you have enabled it,
                and everyone in the room is asked before it connects. It listens
                and takes notes. It cannot speak in a meeting — that is a
                property of how it is built, not a setting.
              </p>
            </section>

            <section>
              <h2 className="text-[19px] font-semibold">Deleting means deleting</h2>
              <p className="mt-2 text-muted-foreground">
                Removing a document removes what was learned from it: the text we
                extracted and the pieces used to answer questions go with it.
                Corrections you have made are kept as a record you can see and
                reverse, because a companion that quietly forgets why it changed
                its mind is not one you can check.
              </p>
            </section>

            <section>
              <h2 className="text-[19px] font-semibold">Who else is involved</h2>
              <p className="mt-2 text-muted-foreground">
                We run on Google Cloud, and Google's models process what you say
                and write in order to answer. Sign-in is handled by Firebase
                Authentication. If you connect an account such as Google
                Calendar, we hold the token needed to act on your behalf and use
                it only for what you have confirmed. Payments are handled by
                Stripe; we never see your card details.
              </p>
            </section>

            <section>
              <h2 className="text-[19px] font-semibold">Asking us anything</h2>
              <p className="mt-2 text-muted-foreground">
                Write to{" "}
                <Link
                  href={MAILTO}
                  className="text-blue-deep underline underline-offset-2 dark:text-blue-bright"
                >
                  alltheway@rinegansolutions.com
                </Link>{" "}
                and a person will answer — including if you want your account and
                everything in it removed.
              </p>
            </section>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
