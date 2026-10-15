# 0006 — Crew app: Expo (React Native), Android-only, sideloaded onto company tablets

- **Status:** accepted
- **Date:** 2026-10-14

## Context
The crew app is specialized, runs on company devices (one per crew), and doesn't belong in the public app
stores. Employees don't install anything on their own phones (`apps/crew.md`). It needs camera photos, offline
work with a queue of actions and photos, signatures, location for customer ETAs and the map, and an always-on
"next up" screen.

## Decision (Josh, 2026-10-14)
- Build `apps/crew` with **Expo (React Native)**, as in ADR-0001, **targeting Android only**.
- **Distribute by sideloading** a signed APK onto company tablets. No App Store or Play listing. JS updates ship over the
  air (`expo-updates`, EAS Update or self-hosted) so fixes reach every tablet during peak season without reinstalling.
  A lightweight MDM can be added later if the fleet grows.
- **Hardware: basic Android tablets with GPS and cellular** (roughly $150–250), a SIM data plan each (no separate truck
  hotspots), and rugged cases, since these devices will have a hard life.
- A native app was chosen over a PWA for future headroom: true background location, native camera control,
  device-level kiosk options, and hardware integrations (printers, scanners) if they're ever needed.

## Alternatives considered
- **PWA** (same web stack as portal/admin): would likely cover today's needs and is simpler to ship, but it limits
  background location and device integration later.
- **Amazon Fire tablets**: attractive on price and durability, but **no GPS**, which breaks crew position, ETAs, and the
  customer map. Also weak cameras and no Google Play services. Rejected.
- **iOS**: unnecessary for company-owned devices; adds signing and distribution cost.

## Consequences
- One Android build pipeline (EAS Build or local Gradle) and an APK signing key the client owns.
- Testing: Maestro for crew flows on an Android emulator and one physical tablet model.
- Shared React Native components live inside `apps/crew` (there's no second mobile app, so no shared mobile package).
