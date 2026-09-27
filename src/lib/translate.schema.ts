import { z } from "zod";

export const TranslateInputSchema = z.object({
  text: z.string().min(1).max(8000),
  sourceLanguage: z.string().min(2).max(10),
  targetLanguage: z.string().min(2).max(10),
});
