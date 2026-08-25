# A project-scoped exemption from Domain Restricted Sharing

**Status:** accepted · **Date:** 2026-08-25 · **Phase:** 0 (bootstrap)

## Decision

`alltheway-rinegan` is exempted from the organisation's
`constraints/iam.allowedPolicyMemberDomains` policy, via a project-level
`allow_all` rule declared in `infra/bootstrap/org-policy.tf`.

Every other project in `conquerorfoundation.com` remains restricted.

## Why

The org enforces Domain Restricted Sharing, limiting IAM members to the
Workspace customer (`C03u1ivly`). That forbids `allUsers`, and the first prod
apply failed on exactly that:

```
Error 400: One or more users named in the policy do not belong to a permitted
customer, perhaps due to an organization policy.
```

This is not something to design around. **Firebase Hosting rewrites to Cloud Run
require the target service to allow unauthenticated invocations** — Hosting calls
it as an anonymous caller. Without `allUsers` on the gateway,
`alltheway.rinegansolutions.com` cannot reach the API at all.

## What it permits, and what it does not

It permits *granting* public IAM inside this one project. It makes nothing
public by itself.

The only public grant in the entire configuration is `run.invoker` on the
gateway. The other five services keep `INGRESS_TRAFFIC_INTERNAL_ONLY` and
named-caller-only IAM, and as of Phase 1 item 1.4 every internal call carries a
Google-signed identity token that Cloud Run verifies before the request reaches
the container.

## Why Terraform rather than a console click

A security control loosened by hand, once, by someone who has since forgotten,
is indistinguishable from one that was never set. As Terraform it is a reviewable
diff, it is reproducible, and `terraform plan` reports it if anyone changes it
out of band.

## Alternatives

**Keep the restriction and front the gateway differently.** A global external
load balancer with a serverless NEG can reach an internal-only service. But that
is a second ingress path, a second place to enforce policy, and it does not
remove the need for public access — it moves it. Rejected as more surface for no
less exposure.

**Narrow the exemption further.** Not possible: `iam.allowedPolicyMemberDomains`
is a list constraint, so a per-project `allow_all` rule is the exemption
mechanism. There is no "allow `allUsers` for Cloud Run only" variant.

## Notes for whoever meets this next

- The change takes **up to ~15 minutes to propagate** to IAM enforcement. Two
  applies failed in that window and looked like the fix had not worked; the
  policy was already correct and effective.
- Setting it needs `roles/orgpolicy.policyAdmin` at the organisation.
- The Terraform provider must send a quota project (`billing_project` +
  `user_project_override`) or the `orgpolicy` API call is attributed to Google's
  shared gcloud project and fails as `SERVICE_DISABLED` — which reads like a
  missing API rather than a missing header.
