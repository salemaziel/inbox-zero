import { z } from "zod";
import { Provider } from "@/utils/llms/config";

export const aiSubscriptionProviderBody = z.object({
  provider: z.enum([Provider.CLAUDE_CODE, Provider.CODEX_CLI]),
});
export type AiSubscriptionProviderBody = z.infer<
  typeof aiSubscriptionProviderBody
>;

export const submitAiSubscriptionCodeBody = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    // The code Claude shows is URL-safe characters plus "#"; nothing else is
    // ever written to the sign-in terminal.
    .regex(
      /^[A-Za-z0-9#_.~-]+$/,
      "That doesn't look like the code Claude showed",
    ),
});
export type SubmitAiSubscriptionCodeBody = z.infer<
  typeof submitAiSubscriptionCodeBody
>;
