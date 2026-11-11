import { createServer } from "vite";
import path from "node:path";
import { access } from "node:fs/promises";

// Use a separate local port to test a candidate without altering npm dependencies.
if (!process.argv[2])
  throw new Error(
    "Usage: node scripts/compare-vite.mjs <candidate-csp-esm-file>",
  );
const candidate = path.resolve(process.argv[2]);
await access(candidate);
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: {
    host: "127.0.0.1",
    port: 4198,
    strictPort: true,
    open: false,
    fs: { allow: [process.cwd(), path.dirname(candidate)] },
  },
  resolve: { alias: [{ find: /^gyosjs\/csp$/, replacement: candidate }] },
});
await server.listen();
server.printUrls();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
