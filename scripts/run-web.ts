import { startServer } from "../src/server.ts";

const port = Number(process.env.TRACKER_PORT ?? 8787);
const host = process.env.TRACKER_HOST ?? "127.0.0.1";
const server = await startServer({ host, port });
console.log(`gi-tcg-tracker listening on http://${host}:${port}`);
const shutdown = () => server.close(() => process.exit(0));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
