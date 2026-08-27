/**
 * `prepare` hook.
 *
 * npm runs `prepare` before packing, on a bare local `npm install`, and when a
 * consumer installs this package as a git dependency — but NOT for installs
 * from a registry tarball, which already contain a built `dist/`.
 *
 * That "but not" is load-bearing, and we do not want to bet a user's install on
 * it: if the hook ever fires somewhere without our devDependencies, `tsc` is
 * missing and the whole install fails. So probe for the toolchain first and
 * no-op when it is absent, which is exactly the case where a build is neither
 * possible nor needed.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);

function toolchainPresent() {
  if (!existsSync(new URL("../src", import.meta.url))) return false;
  try {
    require.resolve("typescript");
    return true;
  } catch {
    return false;
  }
}

if (!toolchainPresent()) {
  // A consumer install of a prebuilt package. Nothing to do.
  process.exit(0);
}

const res = spawnSync("npm", ["run", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(res.status ?? 1);
