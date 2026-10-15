import { describe, expect, it } from "vitest";
import { createFakeGateway } from "./fake";

describe("fake gateway", () => {
  it("succeeds or declines by test card", async () => {
    const gw = createFakeGateway();
    const ok = await gw.createTestSavedCard({ email: "a@example.com", name: "A", behavior: "succeeds" });
    const bad = await gw.createTestSavedCard({ email: "b@example.com", name: "B", behavior: "declines" });
    const base = { amountCents: 100, idempotencyKey: "k", description: "t", merchantInitiated: true };
    expect((await gw.charge({ ...base, ...ok })).status).toBe("succeeded");
    expect(await gw.charge({ ...base, ...bad })).toMatchObject({ status: "failed", code: "card_declined", retryable: true });
  });
});
