import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@css/api";

export type Out = inferRouterOutputs<AppRouter>;
export type BookingDetail = Out["admin"]["bookings"]["get"];
