# 0005 — No customer mobile app; tracking is a web page

- **Status:** accepted (revised 2026-10-14; the earlier version planned an Expo customer app for 2028)
- **Date:** 2026-10-14

## Context
Live crew tracking, queue position ("you're stop 4 of 9"), and the digital closet were the reasons to consider a
customer app with push notifications. But customers need tracking about twice a year (pickup and delivery day),
half of signups are done by parents, and an install is friction for something used once.

## Decision
- **No customer app** (Josh, 2026-10-14). The web portal is the complete customer experience.
- Day-of tracking works like tracking an Amazon delivery: a mobile web page, linked from every day-of SMS and email
  (signed link, no login), showing queue position, ETA, and the crew on a map once they're heading to you. It
  **polls every 1–2 minutes**; no websockets or push infrastructure needed.
- Notifications go by SMS (with consent) and email.

## Alternatives considered
- **Expo customer app with push** (the original version of this ADR): richer, but an app store presence, two
  listings, and push infrastructure for a once-a-season need.
- **PWA with web push**: iOS requires add-to-home-screen first; few parents would. Not worth it.

## Consequences
- No `apps/customer`, no App Store / Play developer accounts needed for customers.
- Notification preferences per Person cover SMS and email only.
- Revisit only if customers repeatedly ask for an app.
