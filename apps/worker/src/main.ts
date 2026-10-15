/** Background jobs: AI first responses to inbound messages, declined-payment retries, and signup reminders. */
import { resolve } from "node:path";
import { aiReply, createServices, processAbandonedDrafts, retryDueCollections } from "@css/api";

const services = await createServices(resolve(import.meta.dirname, "../../.."));
const { boss } = services;

await boss.work<{ messageId: string }>("ai.reply", async ([job]) => {
  if (job) await aiReply(services, job.data.messageId);
});

await boss.createQueue("collections.retry");
await boss.schedule("collections.retry", "* * * * *");
await boss.work("collections.retry", async () => {
  const results = await retryDueCollections(services);
  if (results.length) console.log(`[collections] retried ${results.length} invoice(s)`);
});

// Stalled signups: mark abandoned and send the one "finish your signup" reminder.
await boss.createQueue("signup.abandoned");
await boss.schedule("signup.abandoned", "*/10 * * * *");
await boss.work("signup.abandoned", async () => {
  const { reminded } = await processAbandonedDrafts(services);
  if (reminded) console.log(`[signup] sent ${reminded} reminder(s)`);
});

console.log("worker running");
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await services.close();
    process.exit(0);
  });
}
