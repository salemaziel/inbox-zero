import { z } from "zod";

export const renderHtmlBody = z.object({
  // Generous for real mail; bounds the server-side parse and rewrite work.
  html: z.string().max(5 * 1024 * 1024),
});
