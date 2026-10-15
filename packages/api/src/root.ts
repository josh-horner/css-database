import { adminRouter } from "./routers/admin";
import { crewRouter } from "./routers/crew";
import { portalRouter } from "./routers/portal";
import { router } from "./trpc";

export const appRouter = router({
  admin: adminRouter,
  crew: crewRouter,
  portal: portalRouter,
});

export type AppRouter = typeof appRouter;
