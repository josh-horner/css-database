# 0004 — Person-centric identity with derived booking access

- **Status:** accepted
- **Date:** 2026-10-14

## Context
Every signup collects a student and one parent, and we know who submitted it, but not who will need
access later (a second parent, the student once they're in college, a new email). Legacy has `Account`
→ `User`s plus per-contract copies of student and parent info, and patches access by matching login emails
against those copies (`User#contract_ids`). Returning customers re-enter everything.

Facts from production: 50% of signups are made by a parent, 41% by the student; only 260 of 5,460
accounts with bookings ever had a second user; 216 accounts have siblings; 179 bookings use one email for
both student and parent.

## Decision
- Replace Account/User/StudentInformation/ParentInformation with **Person** + **ContactPoint** + **PersonLink** (guardian → student).
- A Booking belongs to a **student Person** and lists **BookingParty** rows (student, guardian, payer, signer).
- **Access is derived**: signing in = verifying a ContactPoint; you see bookings where any Person you own a verified ContactPoint for is a party. Role determines permissions.
- Additional people get access by being added as a party (invite), not by sharing a login.
- Payment methods belong to the payer Person and are reused across their bookings and seasons.
- Re-signup clones the student's last booking and asks only what changes.

## Alternatives considered
- **Keep Household/Account as the access unit** (what the first draft said): it still requires deciding up front who belongs to the account, and it breaks when a student's parents are separated, when one parent pays for one sibling and another for a different one, and so on.
- **One login per booking with shared credentials**: insecure, and it's the root of today's problem.

## Migration
- Build Persons by normalizing emails (lowercase, trim) and phones (digits) across `users`, `student_informations`, `parent_informations`. Merge on exact email match. Phone-only matches go to a **merge review queue**, not auto-merged.
- Contract → Booking with parties: student info → student; parent info → guardian; `signup_by` user → signer; the account's card owner → payer (default the signer if unknown).
- PersonLinks are inferred from parent/student co-occurrence on contracts.
- Legacy `accounts.notes` become Notes on the student Person.

## Consequences
- Login lookup is by ContactPoint, so ContactPoints must be unique among verified points (an email can't belong to two Persons once verified, except for the shared family-email case, which is modeled as one ContactPoint linked to both Persons).
- Verification is required before revealing any data, so "welcome back" happens after the code or link.
