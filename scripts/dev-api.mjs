import { spawnSync, spawn } from "node:child_process";
const build = spawnSync("npm", ["run", "build"], { stdio: "inherit" });
if (build.status) process.exit(build.status || 1);
const compiler = spawn("npx", ["tsc", "--watch", "-p", "tsconfig.json"], {
  stdio: "inherit",
});
const server = spawn(
  process.execPath,
  ["--watch", "dist/apps/api/src/main.js"],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    compiler.kill();
    server.kill();
    process.exit();
  });
