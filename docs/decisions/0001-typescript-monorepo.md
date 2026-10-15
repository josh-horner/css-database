# 0001 — TypeScript monorepo: Next.js, Expo, Hono + tRPC, Drizzle/Postgres

- **Status:** accepted
- **Date:** 2026-10-14

## Context
Three clients (customer web, admin web, employee mobile) share one domain and one database. The work
will be done mostly by one developer directing coding agents, so shared types and fast feedback
loops matter more than framework familiarity. The mobile app must work offline and update quickly during peak season.

## Decision
- pnpm workspaces + Turborepo.
- Next.js for `portal` and `admin`; Expo (React Native) for `crew`. Android only, sideloaded (ADR-0006).
- A standalone API (`apps/api`, Hono) serving tRPC routers from `packages/api`, used by all three clients. Jobs in `apps/worker` use pg-boss.
- Postgres with Drizzle ORM; business rules in a pure `packages/domain`.

## Alternatives considered
- **Rails 8 API + React/Expo clients.** Josh knows Rails well and the legacy rules port easily, but types aren't shared with the mobile app, so the work splits across two languages and two toolchains.
- **Upgrade the legacy app in place.** Every dependency is EOL and the data model is the core problem; this still wouldn't provide the mobile app.
- **Next.js API routes / server actions as the only backend.** Simpler at first, but the mobile client, webhooks, and jobs push toward a standalone API anyway.
- **Supabase / Firebase BaaS.** Fast start, but the ledger, capacity locking, and audit rules want to live in our own code with real transactions.
- **GraphQL / OpenAPI instead of tRPC.** More ceremony. Every client is TypeScript, so tRPC's inferred types are the win. Add an OpenAPI surface later if WordPress or partners need it.

## Consequences
- One `pnpm typecheck` catches cross-app breakage.
- tRPC couples clients to the server version, so the mobile app must tolerate an older API during store review. Use additive changes only, and deprecate procedures before removing them.
- Need discipline to keep `packages/domain` free of I/O.
