import { FieldValue } from "firebase-admin/firestore";
import {
  LifeContextSchema,
  OnboardingJobSchema,
  OnboardingSchema,
  type Onboarding,
} from "@alltheway/contracts";

import { userDoc } from "../firestore.js";

const ref = (uid: string) => userDoc(uid).collection("settings").doc("onboarding");

/**
 * First-run choice. Stored like locale: against the person, not the browser.
 *
 * Absent is a real state — it means show the job screen. A 404 here would make
 * a network blip look like a first visit.
 */
export async function getOnboarding(uid: string): Promise<Onboarding> {
  const doc = await ref(uid).get();
  if (!doc.exists) return { job: null, lifeContext: null };
  return OnboardingSchema.parse({
    job: OnboardingJobSchema.nullable().catch(null).parse(doc.get("job") ?? null),
    lifeContext: LifeContextSchema.nullable().catch(null).parse(doc.get("lifeContext") ?? null),
  });
}

export async function setOnboarding(
  uid: string,
  input: { job: string; lifeContext?: string | null },
): Promise<Onboarding> {
  const job = OnboardingJobSchema.parse(input.job);
  const lifeContext =
    input.lifeContext == null || input.lifeContext === ""
      ? null
      : LifeContextSchema.parse(input.lifeContext);

  await ref(uid).set(
    {
      job,
      lifeContext,
      at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { job, lifeContext };
}
