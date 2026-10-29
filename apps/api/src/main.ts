import { createApp } from "./bootstrap";
void createApp()
  .then(async (app) => {
    await app.listen(Number(process.env.PORT) || 3001, "0.0.0.0");
    console.log(
      JSON.stringify({
        level: "info",
        event: "startup",
        port: Number(process.env.PORT) || 3001,
      }),
    );
  })
  .catch(() => {
    console.error(JSON.stringify({ level: "fatal", event: "startup_failed" }));
    process.exit(1);
  });
