import { createIntegrations } from "@css/integrations";
import { createDb } from "./client";
import { loadEnv } from "./env";
import { seed } from "./seed";

loadEnv();
const db = createDb();
try {
  await seed(db, {
    payments: createIntegrations(process.env).payments,
    deviceToken: process.env.DEMO_DEVICE_TOKEN,
    demoPhone: process.env.DEMO_CUSTOMER_PHONE,
  });
} finally {
  await db.$sql.end();
}
