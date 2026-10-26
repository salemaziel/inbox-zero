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
    .regex(/^\S+$/, "The code can't contain spaces"),
});
export type SubmitAiSubscriptionCodeBody = z.infer<
  typeof submitAiSubscriptionCodeBody
>;
