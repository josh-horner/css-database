import { z } from "zod";
import { arrive, completeJob, contractPicker, crewToday, onMyWay, recordLocations, removeItem, saveItem } from "../services/crew";
import { crewProcedure, router } from "../trpc";

const jobInput = z.object({ jobId: z.uuid() });

export const crewRouter = router({
  today: crewProcedure.query(({ ctx }) => crewToday(ctx, ctx.device.crewId)),
  rateCard: crewProcedure.query(({ ctx }) => contractPicker(ctx, ctx.device.crewId)),
  onMyWay: crewProcedure.input(jobInput).mutation(({ ctx, input }) => onMyWay(ctx, ctx.device.crewId, input.jobId, ctx.device.id)),
  arrive: crewProcedure.input(jobInput).mutation(({ ctx, input }) => arrive(ctx, ctx.device.crewId, input.jobId, ctx.device.id)),
  saveItem: crewProcedure
    .input(
      z.object({
        jobId: z.uuid(),
        clientId: z.string().min(8).max(64),
        rateCardItemId: z.uuid().nullable(),
        description: z.string().max(200).nullable(),
        quantity: z.number().int().min(1).max(500),
        preExistingDamage: z.string().max(500).nullable(),
      }),
    )
    .mutation(({ ctx, input }) => saveItem(ctx, ctx.device.crewId, input)),
  removeItem: crewProcedure.input(z.object({ itemId: z.uuid() })).mutation(({ ctx, input }) => removeItem(ctx, ctx.device.crewId, input.itemId)),
  complete: crewProcedure
    .input(z.object({ jobId: z.uuid(), signedByName: z.string().max(120).nullable() }))
    .mutation(({ ctx, input }) => completeJob(ctx, ctx.device.crewId, input.jobId, input.signedByName, ctx.device.id)),
  location: crewProcedure
    .input(
      z.object({
        points: z
          .array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().nullable(), recordedAt: z.coerce.date() }))
          .max(500),
      }),
    )
    .mutation(({ ctx, input }) => recordLocations(ctx, ctx.device.crewId, ctx.device.id, input.points)),
});
