import { motionResponse } from "./motion";
export const motionConfigured = () =>
  Boolean(process.env.KIMODO_URL && process.env.KIMODO_API_TOKEN);
export async function worker(path: string, body?: unknown) {
  if (!motionConfigured())
    return Response.json(
      { error: "The Kimodo worker is not connected yet." },
      { status: 503 },
    );
  try {
    const response = await fetch(
      process.env.KIMODO_URL!.replace(/\/$/, "") + path,
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + process.env.KIMODO_API_TOKEN,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      },
    );
    if (!response.ok)
      return Response.json(
        {
          error:
            "The motion worker could not accept this request. Check its availability.",
        },
        { status: response.status === 429 ? 429 : 502 },
      );
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_500_000) {
        await reader.cancel();
        throw new Error("Oversize response");
      }
      chunks.push(value);
    }
    const data = motionResponse.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      {
        error:
          "The motion worker is unavailable or returned an invalid result. Your workout review is unchanged.",
      },
      { status: 502 },
    );
  }
}
