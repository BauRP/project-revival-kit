import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const transcribeAudio = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ audioUrl: z.string().url() }).parse(data))
  .handler(async ({ data }) => {
    const { transcribeAudioServer } = await import("./server/transcribe.server");
    return transcribeAudioServer(data);
  });