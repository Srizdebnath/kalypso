// Public runtime config for the browser client (no secrets). Read at request time.
import { connection } from "next/server";

export async function GET() {
  await connection();
  const guardians = (process.env.GUARDIAN_URLS ?? "http://127.0.0.1:7101,http://127.0.0.1:7102").split(",").map((s) => s.trim()).filter(Boolean);
  return Response.json({
    guardians,
    swarm: Boolean(process.env.BEE_URL && process.env.SWARM_POSTAGE_BATCH_ID),
    explorer: "https://rabdi.explorer.arkiv.network",
  });
}
