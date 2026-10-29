// Optional PostgreSQL for machines without Docker. Data stays inside ignored work/.
import EmbeddedPostgres from "embedded-postgres";
import { mkdir, access } from "node:fs/promises";
const dir = new URL("../work/postgres", import.meta.url).pathname;
await mkdir(dir, { recursive: true });
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "dixon",
  password: "local-only-change-me",
  port: 55432,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: console.log,
  onError: console.error,
});
try {
  await access(dir + "/PG_VERSION");
} catch {
  await pg.initialise();
}
await pg.start();
for (const name of ["dixon", "dixon_test"])
  try {
    await pg.createDatabase(name);
  } catch {}
console.log(
  "Local PostgreSQL listening on 127.0.0.1:55432. Databases: dixon, dixon_test.",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await pg.stop();
    process.exit(0);
  });
setInterval(() => {}, 60000);
