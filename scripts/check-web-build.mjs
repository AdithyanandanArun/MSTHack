// Gate G4: typecheck, lint and production build of the web app.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const web = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "web");
const step = (label, cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: web, encoding: "utf8", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  const out = `${r.stdout}\n${r.stderr}`;
  if (r.status !== 0) {
    console.error(out.slice(-6000));
    console.error(`web build check failed at: ${label}`);
    process.exit(1);
  }
  return out;
};
step("typecheck", "npx", ["tsc", "--noEmit", "-p", "."]);
step("lint", "npx", ["eslint", "src", "test", "--max-warnings=0"]);
const build = step("next build", "npx", ["next", "build"]);
for (const route of ["/rooms/[id]", "/rooms/[id]/findings/[fid]", "/api/rooms/[id]/findings", "/admin"]) {
  if (!build.includes(route)) {
    console.error(`route ${route} missing from build output`);
    process.exit(1);
  }
}
console.log(build.split("\n").filter((l) => /Compiled|Route|First Load/.test(l)).join("\n"));
console.log("WEB BUILD VERIFIED");
