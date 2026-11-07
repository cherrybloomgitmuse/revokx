import { once } from "node:events";
import { createApp } from "./app.js";
import { checkRevocation } from "./check.js";
import { saveReport } from "../src/report.js";

const mode = process.argv[2] ?? "fixed";
let server;
let stage = "startup";

try {
  server = createApp({ mode }).listen(0, "127.0.0.1");

  await once(server, "listening");

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  stage = "checking";

  // Application mode is not passed to the checker.
  const report = await checkRevocation(baseUrl);

  console.log(JSON.stringify(report, null, 2));

  stage = "saving";

  // Mode is recorded as experiment metadata only.
  const filePath = await saveReport(report, { mode });

  console.log(`Report saved: ${filePath}`);

  const exitCodes = {
    PASS: 0,
    FAIL: 1,
    INCONCLUSIVE: 2
  };

  process.exitCode = exitCodes[report.verdict];
} catch {
  if (stage === "saving") {
    console.error(
      "Report could not be saved. See the checker result printed above."
    );
  } else {
    console.error(`Demo failed during ${stage}.`);
  }

  process.exitCode = 2;
} finally {
  if (server?.listening) {
    await new Promise((resolve) => {
      server.close((error) => {
        if (error) {
          console.error("Demo server cleanup failed.");
          process.exitCode = 2;
        }

        resolve();
      });

      server.closeAllConnections();
    });
  }
}