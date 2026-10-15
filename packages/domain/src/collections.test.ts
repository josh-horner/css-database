import { describe, expect, it } from "vitest";
import { nextCollectionsStep } from "./collections";

describe("collections schedule", () => {
  const first = new Date("2027-05-10T15:00:00Z");
  it("retries on day 3 and day 7, then moves to collections", () => {
    expect(nextCollectionsStep(first, 1)).toEqual({ action: "retry_and_remind", attempt: 2, at: new Date("2027-05-13T15:00:00Z") });
    expect(nextCollectionsStep(first, 2)).toEqual({ action: "retry_and_remind", attempt: 3, at: new Date("2027-05-17T15:00:00Z") });
    expect(nextCollectionsStep(first, 3)).toEqual({ action: "move_to_collections" });
  });
});
