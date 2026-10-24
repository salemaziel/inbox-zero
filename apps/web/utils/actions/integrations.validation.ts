import { z } from "zod";

// The name ends up in a cookie name, so it must match the registry's name
// format before anything looks it up.
const integrationName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Invalid integration");

export const connectIntegrationWithTokenBody = z.object({
  integrationName,
  token: z.string().trim().min(1, "Token is required").max(4096),
});

export const startIntegrationTokenRedirectBody = z.object({
  integrationName,
});

export const completeIntegrationTokenRedirectBody = z.object({
  integrationName,
  state: z.string().min(1).max(4096),
  token: z.string().trim().min(1, "Token is required").max(4096),
});
