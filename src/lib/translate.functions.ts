import { createServerFn } from "@tanstack/react-start";
import { TranslateInputSchema } from "./translate.schema";

export const translateText = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => TranslateInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { translateTextServer } = await import("./server/translate.server");
    return translateTextServer(data);
  });