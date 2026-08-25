# AllTheWay — infrastructure

One GCP project, two environments (`dev`, `prod`), separated by Terraform
**workspace** and by resource naming rather than by project.

```
infra/
├─ main.tf variables.tf outputs.tf versions.tf   the root, applied per workspace
├─ bootstrap/     applied ONCE by a human: APIs, state bucket, registry, CI identities, triggers
├─ modules/
│  ├─ stack/             one whole environment
│  ├─ backend-service/   one Cloud Run service
│  └─ web-hosting/       one Firebase Hosting site + its Route 53 records
├─ envs/
│  ├─ dev/terraform.tfvars
│  └─ prod/terraform.tfvars
└─ ci/cloudbuild.backend.template.yaml
```

`envs/<env>/` holds **only** a tfvars file. There is one copy of the actual
configuration, so dev and prod cannot drift apart.

## Manual prerequisites

Two things Terraform cannot do for you:

1. **Enable `cloudresourcemanager` and `serviceusage`** on a brand-new project,
   by hand. Terraform needs them on before it can enable anything else.
2. **Connect the GitHub repo to Cloud Build** — Console › Cloud Build › Triggers
   › Connect repository, using the Cloud Build GitHub App. The triggers in
   `bootstrap/triggers.tf` reference that connection; they do not create it.

No long-lived keys are involved. Builds run inside GCP as the service accounts
created in bootstrap, which is why Workload Identity Federation is **not** used
here — WIF exists for runners outside GCP, such as GitHub Actions.

## Apply order

### 1. Bootstrap (once, locally, as project owner)

```bash
cd infra/bootstrap
terraform init
terraform apply -var project_id=<PROJECT> -var state_bucket_name=<BUCKET> \
                -var github_owner=<OWNER> -var github_repo=<REPO>
```

Then uncomment the `backend "gcs"` block in `bootstrap/versions.tf`, fill in the
bucket, and migrate the state off your laptop:

```bash
terraform init -migrate-state
```

Record `terraform output` — the env roots need `state_bucket`, and CI needs the
service-account emails.

### 2. Environments

```bash
cd infra
terraform init -backend-config="bucket=<BUCKET>"

terraform workspace new dev      # or: terraform workspace select dev
terraform apply -var-file=envs/dev/terraform.tfvars

terraform workspace select prod  # or: terraform workspace new prod
terraform apply -var-file=envs/prod/terraform.tfvars
```

Applying in the `default` workspace fails on purpose, with instructions.

### 3. Domain verification — deliberately two-phase

Firebase issues the TXT value only after the custom domain exists, so:

```bash
terraform apply -var-file=envs/prod/terraform.tfvars   # creates site + domain + A records
terraform output required_dns_updates                  # read the TXT value
# put it in envs/prod/terraform.tfvars as domain_verification_txt
terraform apply -var-file=envs/prod/terraform.tfvars   # writes the TXT record
```

The A records are Firebase Hosting's published addresses, held in
`modules/web-hosting/variables.tf`. **Verify them against the Firebase console
before the first apply** — a stale value there breaks the domain silently.

## Things that must stay in sync

- **Region.** `var.region` and the `region` in `web/firebase.json`'s `/api/**`
  rewrite must match, or Hosting cannot resolve the gateway service.
- **Firestore location** is fixed at creation and cannot be changed afterwards.
- **Image tags.** Terraform owns each Cloud Run service's *shape*; CI owns the
  *image*. `modules/backend-service` ignores image drift, so an apply never
  rolls back a deploy.

## Deploys

| Branch | Environment | Web | Backend |
|---|---|---|---|
| `develop` | dev | `web/cloudbuild.yaml` → `alltheway-dev` | `services/<service>/cloudbuild.yaml` → `<service>-dev` |
| `main` | prod | `web/cloudbuild.yaml` → `alltheway-prod` | `services/<service>/cloudbuild.yaml` → `<service>-prod` |

Triggers are path-filtered, so a copy change in `web/` does not rebuild five
backend services. To add a service: create `services/<service>/cloudbuild.yaml` from
`ci/cloudbuild.backend.template.yaml` (it needs no edits — everything arrives as
a substitution) and add the name to `var.backend_services` in bootstrap.

There is no Cloud Deploy. With one project, two environments, and "push to main
ships prod", its promotion model would add per-pipeline cost for machinery we
would not be using. If an approval gate before prod is ever wanted, it slots in
without changing the builds.
