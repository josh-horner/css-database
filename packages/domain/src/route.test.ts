import { describe, expect, it } from "vitest";
import { distanceKm, nextStop, queueView, travelMinutes, type RouteStopState } from "./route";

const warehouse = { lat: 40.0, lng: -105.25 };
const stop = (jobId: string, sequence: number, status: RouteStopState["status"], lat: number): RouteStopState => ({
  jobId,
  sequence,
  status,
  location: { lat, lng: -105.25 },
  serviceMinutes: 20,
});

describe("route queue view", () => {
  it("measures distance sensibly", () => {
    expect(distanceKm({ lat: 40, lng: -105 }, { lat: 40.01, lng: -105 })).toBeCloseTo(1.11, 1);
    expect(travelMinutes(warehouse, warehouse)).toBe(2);
  });

  it("counts position and stops ahead, skipping finished ones", () => {
    const stops = [stop("a", 1, "completed", 40.01), stop("b", 2, "arrived", 40.02), stop("c", 3, "pending", 40.03)];
    const view = queueView(stops, "c", { lat: 40.02, lng: -105.25 })!;
    expect(view).toMatchObject({ position: 3, totalStops: 3, stopsAhead: 1, crewHeadingHere: false });
    // half of b's service time + travel b -> c
    expect(view.etaMinutes).toBe(10 + travelMinutes(stops[1]!.location, stops[2]!.location));
  });

  it("flags when the crew is heading to this stop", () => {
    const stops = [stop("a", 1, "completed", 40.01), stop("b", 2, "en_route", 40.02)];
    expect(queueView(stops, "b", warehouse)).toMatchObject({ crewHeadingHere: true, stopsAhead: 0 });
  });

  it("finds the next open stop", () => {
    const stops = [stop("a", 2, "pending", 40.01), stop("b", 1, "completed", 40.02)];
    expect(nextStop(stops)?.jobId).toBe("a");
    expect(queueView(stops, "missing", null)).toBeNull();
  });
});
