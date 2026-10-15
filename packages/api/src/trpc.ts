import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

export const staffProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.staff) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required" });
  return next({ ctx: { ...ctx, staff: ctx.staff } });
});

/** Staff roles (docs/apps/admin.md#roles). Owner can do everything. */
export function roleProcedure(...roles: string[]) {
  return staffProcedure.use(({ ctx, next }) => {
    if (ctx.staff.role !== "owner" && !roles.includes(ctx.staff.role))
      throw new TRPCError({ code: "FORBIDDEN", message: "Your role can't do that" });
    return next();
  });
}

export const ownerProcedure = roleProcedure();
export const officeProcedure = roleProcedure("office");

export const customerProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.customer) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue" });
  return next({ ctx: { ...ctx, customer: ctx.customer } });
});

export const crewProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.device) throw new TRPCError({ code: "UNAUTHORIZED", message: "This device isn't paired" });
  if (!ctx.device.crewId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This device isn't assigned to a crew today" });
  return next({ ctx: { ...ctx, device: { id: ctx.device.id, crewId: ctx.device.crewId } } });
});
