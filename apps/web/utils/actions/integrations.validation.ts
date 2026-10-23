import { z } from "zod";

export const connectIntegrationWithTokenBody = z.object({
  integrationName: z.string().min(1),
  token: z.string().trim().min(1, "Token is required").max(4096),
});
export type ConnectIntegrationWithTokenBody = z.infer<
  typeof connectIntegrationWithTokenBody
>;

export const startIntegrationTokenRedirectBody = z.object({
  integrationName: z.string().min(1),
});
export type StartIntegrationTokenRedirectBody = z.infer<
  typeof startIntegrationTokenRedirectBody
>;

export const completeIntegrationTokenRedirectBody = z.object({
  integrationName: z.string().min(1),
  state: z.string().min(1).max(4096),
  token: z.string().trim().min(1, "Token is required").max(4096),
});
export type CompleteIntegrationTokenRedirectBody = z.infer<
  typeof completeIntegrationTokenRedirectBody
>;
