import { motionRequest } from "@/lib/motion";
import { motionConfigured, worker } from "@/lib/motion-server";
export async function GET() {
  return Response.json(
    { configured: motionConfigured() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  // Small bounded JSON request: generation receives no private video or image data.
  const reader = request.body?.getReader();
  if (!reader)
    return Response.json({ error: "Missing request" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024) {
      await reader.cancel();
      return Response.json({ error: "Request too large" }, { status: 413 });
    }
    chunks.push(value);
  }
  try {
    const input = motionRequest.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    return await worker("/jobs", input);
  } catch {
    return Response.json(
      {
        error:
          "Choose a squat variation and a duration between 2 and 8 seconds.",
      },
      { status: 400 },
    );
  }
}
