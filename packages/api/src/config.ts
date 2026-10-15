export interface AppConfig {
  apiUrl: string;
  portalUrl: string;
  adminUrl: string;
  appSecret: string;
  /** Enables demo-only helpers (simulated inbound texts, test-card payment on the pay page). Never in production. */
  demoMode: boolean;
  timeZone: string;
  /** Stripe Payment Element in the browser; empty with the fake gateway. */
  stripePublishableKey: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appSecret = env.APP_SECRET ?? "";
  if (appSecret.length < 16) throw new Error("APP_SECRET must be set to a long random string");
  return {
    apiUrl: env.API_URL ?? "http://localhost:4100",
    portalUrl: env.PORTAL_URL ?? "http://localhost:4102",
    adminUrl: env.ADMIN_URL ?? "http://localhost:4101",
    appSecret,
    demoMode: env.DEMO_MODE !== "false" && env.NODE_ENV !== "production",
    timeZone: "America/Denver",
    stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY ?? "",
  };
}
