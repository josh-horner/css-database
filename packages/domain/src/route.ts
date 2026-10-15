/**
 * Customer queue view and ETAs (docs/domain-model.md#appointment-job-dispatch).
 * Deliberately simple: straight-line distance at an urban driving speed plus a per-stop service time.
 * A routing provider can replace `travelMinutes` later without changing callers.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

export type StopStatus = "pending" | "en_route" | "arrived" | "completed" | "skipped";

export interface RouteStopState {
  jobId: string;
  sequence: number;
  status: StopStatus;
  location: LatLng;
  serviceMinutes: number;
}

const EARTH_RADIUS_KM = 6371;

export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Road distance is roughly 1.3x straight-line in town; average 30 km/h with stops and parking. */
export function travelMinutes(a: LatLng, b: LatLng): number {
  return Math.max(2, Math.round(((distanceKm(a, b) * 1.3) / 30) * 60));
}

export interface QueueView {
  position: number;
  totalStops: number;
  stopsAhead: number;
  etaMinutes: number;
  /** The crew is driving to this stop right now (show the live map only then). */
  crewHeadingHere: boolean;
  status: StopStatus;
}

const isOpen = (s: RouteStopState) => s.status === "pending" || s.status === "en_route" || s.status === "arrived";

/**
 * Where a stop sits in the crew's day, and when they'll get there, given the crew's current position.
 * Remaining time for a stop in progress is approximated as half its service time.
 */
export function queueView(stops: readonly RouteStopState[], jobId: string, crewAt: LatLng | null): QueueView | null {
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
  const index = ordered.findIndex((s) => s.jobId === jobId);
  if (index === -1) return null;
  const target = ordered[index]!;
  const totalStops = ordered.filter((s) => s.status !== "skipped").length;
  const position = ordered.slice(0, index + 1).filter((s) => s.status !== "skipped").length;
  const ahead = ordered.slice(0, index).filter(isOpen);

  if (!isOpen(target)) {
    return { position, totalStops, stopsAhead: 0, etaMinutes: 0, crewHeadingHere: false, status: target.status };
  }

  let minutes = 0;
  let from: LatLng | null = crewAt;
  for (const stop of ahead) {
    if (stop.status === "arrived") {
      minutes += Math.ceil(stop.serviceMinutes / 2);
    } else {
      if (from) minutes += travelMinutes(from, stop.location);
      minutes += stop.serviceMinutes;
    }
    from = stop.location;
  }
  if (target.status !== "arrived" && from) minutes += travelMinutes(from, target.location);

  return {
    position,
    totalStops,
    stopsAhead: ahead.length,
    etaMinutes: target.status === "arrived" ? 0 : minutes,
    crewHeadingHere: target.status === "en_route",
    status: target.status,
  };
}

/** The next thing the crew should do: the first open stop in sequence. */
export function nextStop(stops: readonly RouteStopState[]): RouteStopState | null {
  return [...stops].sort((a, b) => a.sequence - b.sequence).find(isOpen) ?? null;
}
