import { createApp } from "./app.js";

const mode = process.argv[2] ?? "fixed";
const app = createApp({ mode });

const host = "127.0.0.1";
const port = 3000;

const server = app.listen(port, host, () => {
  console.log(`REVOKX demo running at http://${host}:${port}`);
  console.log(`Mode: ${mode}`);

  if (mode === "vulnerable") {
    console.log("Intentional stale-permission bug enabled.");
  }
});

server.on("error", (error) => {
  console.error(`Server could not start: ${error.message}`);
  process.exitCode = 1;
});