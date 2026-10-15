# 0003 — Authentication

- **Status:** proposed (stack accepted; auth library still open to review)
- **Date:** 2026-10-14

## Context
Three audiences with different needs:
- Customers sign in a few times a year and forget passwords. Legacy used an email magic link + a PIN cookie, which worked.
- Employees are seasonal, on phones, sometimes without email.
- Staff hold access to PII and refunds.

## Decision
Self-hosted **Better Auth** on our Postgres, with:
- Customers: email magic link or 6-digit email code (the code works when the link opens in a different browser than the app). Optional SMS code.
- Employees: SMS one-time code to the phone on their Employee record. Long-lived device session, revocable by admin.
- Staff: email + password with mandatory TOTP 2FA, or Google Workspace SSO if CSS uses it.
- Sessions are scoped per app; an employee or customer session can never call `admin.*` procedures.

## Alternatives considered
- Clerk / Auth0: fast and polished, but per-MAU cost grows with ~10 years of customers, and the data lives with the vendor.
- Hand-rolled (as legacy): no.

## Consequences
- We own session and security hygiene: rate limits, token expiry, device revocation.

## Interim implementation (2026-10-15)
Until Better Auth is wired in, the pitch build implements the same *model* with our own tables:
- Customers: 6-digit code to an email or phone (`verification_codes`, hashed, 15 min, 5 tries), then an opaque session
  token in an httpOnly cookie (`customer_sessions`, hashed, 60 days, revocable). Verifying marks matching contact points
  verified; access is derived from the persons who own them (ADR-0004). In demo mode with no email/SMS provider the
  code is shown on screen.
- Staff: email + password with a signed cookie (no 2FA yet). Roles enforced per procedure (owner, office, dispatcher,
  warehouse, readonly).
- Crew tablets: per-device bearer tokens (hashed), revocable from Staff & crew.
Swapping in Better Auth replaces `services/customer-auth.ts` and the staff login route; the access rules stay.
