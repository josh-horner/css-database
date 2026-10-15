/** Builds real or fake adapters from environment variables. Missing credentials fall back to fakes. */
import { resolve } from "node:path";
import { createClaudeAssistant, createFakeAssistant, type CustomerAssistant } from "./ai/assistant";
import { createConsoleEmail, createSesEmail, type EmailProvider } from "./email";
import { createLocalFileStore, createS3FileStore, type FileStore } from "./files";
import { createFakeGateway } from "./payments/fake";
import { createStripeGateway } from "./payments/stripe";
import type { PaymentGateway } from "./payments/types";
import { createConsoleSms, createTwilioSms, type SmsProvider } from "./sms";

export interface Integrations {
  payments: PaymentGateway;
  sms: SmsProvider;
  email: EmailProvider;
  assistant: CustomerAssistant;
  files: FileStore;
}

export function createIntegrations(env: NodeJS.ProcessEnv = process.env, repoRoot = process.cwd()): Integrations {
  const payments =
    env.PAYMENTS_PROVIDER === "stripe"
      ? createStripeGateway(required(env, "STRIPE_SECRET_KEY"))
      : createFakeGateway();
  const sms =
    env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER
      ? createTwilioSms(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM_NUMBER)
      : createConsoleSms();
  const email = env.SES_REGION ? createSesEmail(env.SES_REGION, env.EMAIL_FROM ?? "CSS <hello@example.com>") : createConsoleEmail();
  const assistant = env.ANTHROPIC_API_KEY
    ? createClaudeAssistant(env.ANTHROPIC_API_KEY, env.AI_MODEL || "claude-opus-5-5")
    : createFakeAssistant();
  const files =
    env.S3_BUCKET && env.S3_REGION
      ? createS3FileStore(env.S3_BUCKET, env.S3_REGION)
      : createLocalFileStore(resolve(repoRoot, ".uploads"));
  return { payments, sms, email, assistant, files };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} is required`);
  return v;
}
