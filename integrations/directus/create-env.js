import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const content = [
  `DIRECTUS_SECRET=${randomBytes(32).toString("hex")}`,
  `DIRECTUS_ADMIN_PASSWORD=${randomBytes(24).toString("hex")}`,
  ""
].join("\n");

try {
  writeFileSync(new URL("./.env", import.meta.url), content, {
    flag: "wx"
  });
  console.log("Created local .env credentials.");
} catch (error) {
  if (error.code === "EEXIST") {
    console.error(".env already exists; nothing was overwritten.");
  } else {
    console.error(`Could not create .env: ${error.code}`);
  }
  process.exitCode = 1;
}