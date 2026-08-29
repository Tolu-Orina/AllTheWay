/**
 * Must be the first import of any gateway test file. env.ts reads process.env
 * at module load, and npm scripts on Windows run through cmd.exe, which cannot
 * set VAR=value prefixes.
 */
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8081";
process.env.DOCUMENT_CELL_URL ??= "";
process.env.ALLOW_ANONYMOUS ??= "true";
process.env.GOOGLE_CLOUD_PROJECT ??= "alltheway-local";
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_test_secret";
process.env.STRIPE_SECRET_KEY ??= "sk_test_not_used";
