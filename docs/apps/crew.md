# Crew (`apps/crew`) — Employee Mobile App

Expo (React Native) app, **Android only, sideloaded** onto **basic company Android tablets with GPS and cellular**,
one per crew, in rugged cases (ADR-0006). The paper crew sheet goes away. Not in any app store; JS updates arrive
over the air. Can also be sideloaded onto an Android phone (leads, warehouse). Seasonal college-age crews, so it must
be fast to learn and work offline.

## Who uses it (Josh, 2026-10-14)

**Employees don't have to install anything.** The app lives on company devices, one per crew.

- **Before work: SMS.** When the owner publishes the day's crews, each employee gets a text: "Tomorrow you're on
  Crew 3 (Blue). Report 8:30 at the Boulder warehouse. Lead: Sam." Changes re-send. Replies land in the inbox. A link
  opens a no-login mobile web page with the same info (signed, expires after the day).
- **At work: the tablet.** The device is assigned to a crew for the day in admin (or the lead signs in with an SMS code).
  Members tap their name on the tablet to clock in and out, so hours come from the device, not personal phones. From
  then on **the app tells the crew what to do next**: the next stop, what to bring, what to capture, and what's after.
- Installing the app on a personal phone stays optional (leads, warehouse staff), with phone number → SMS code login.
- Location comes from the crew's device during the shift, never from employees' personal phones.

## Modes

### Route (field)
- **Jobs**: the dispatcher assigns jobs (pickups, deliveries, moves, service calls) to the crew for the day. Optional pool mode lets the crew claim jobs from the day's pool (filtered to the crew's area, with a max per crew). Changes re-optimize the route.
- **Next up**: one big card for the current task (drive to stop 4, arrive, capture, get signature, photos at delivery), then the next. The full list is one tap away.
- **Today**: crew members, truck, and ordered stops with window, address, room, notes, and services. Each status change (`en_route`, `arrived`, `completed`) updates every customer's queue position and ETA.
- Per stop: navigate (Apple/Google Maps), call/text the customer (masked through Twilio if desired), and **On my way** (sends an ETA text; drives portal tracking).
- **Arrive → Capture → Complete**:
  - Pickup: the **digital contract** (the owner calls the written crew sheet a "contract"; not the legacy `Contract` model, which is a booking). For each line: pick an item from the rate card list (big buttons, search, most common first) or **Other + description**, set a **quantity**, and take photos. Customer reviews the list, the photos, and any pre-existing damage the crew noted, and signs on screen, or the crew takes a photo when nobody is there. No labels.
  - Later (AI assist), the AI pre-fills lines from the photos and the crew only fixes what's wrong (`features/ai-item-pricing.md`).
  - This replaces the paper sheet outright. The completed contract becomes draft invoice lines and Items for the owner to approve, so nothing is retyped.
  - Delivery: the contract's lines with photos. Check off each line's quantity; the app flags any shortfall before completion. **Delivery photos are required** (the items as left at the room/door) before the job can complete; they're the evidence for any later claim. Customer signs, or the photos stand in when nobody's there.
- **Problem** button: no-show, wrong address, extra items, damage observed. This notifies the office inbox.
- Background location only while clocked in, shared only for active routes.

### Warehouse
- Record where a booking's things are stored (warehouse + spot). Look up a customer to find their spot and photos.
- Load-out for a route: pick list by storage spot with each booking's lines and quantities, checked off as staged.

### Crew
- Members tap in/out on the shared device. Personal-phone installs see their own hours this week.

## Offline behavior

Every action works without signal and syncs later. A visible sync indicator shows the count of pending
actions and photos. Actions are idempotent commands (see `architecture.md#offline-sync-crew-app`).

## Rollout

The crew app goes live with everything else at cutover; there is no period where it runs against legacy
(`roadmap.md`). Before cutover, a crew runs a mock pickup day against staging.
