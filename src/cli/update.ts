import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

/**
 * Self-update (FR-8): compare the running version against the npm registry and
 * upgrade in place.
 *
 * The upgrade has to run through whichever manager installed LLMTab — npm, pnpm,
 * yarn and bun all place global binaries differently, and calling the wrong one
 * either fails or silently installs a second copy that never shadows the first.
 * So the manager is inferred from the install path rather than assumed, and when
 * the path says nothing useful we print the command instead of guessing.
 */

const REGISTRY = "https://registry.npmjs.org";
const PKG = "llmtab";
const DESKTOP_PKG = "llmtab-desktop";

export type Manager = "npm" | "pnpm" | "yarn" | "bun";

/**
 * Where this code actually lives. `process.argv[1]` is the bin **symlink** for a
 * global install (`<prefix>/bin/llmtab`), which carries no `/node_modules/`
 * segment and so made every global install look like a local checkout. The
 * module URL always points at the real file, and realpath resolves the rest.
 */
export function modulePath(): string {
  const here = fileURLToPath(import.meta.url);
  try {
    return fs.realpathSync(here);
  } catch {
    return here;
  }
}

export interface UpdatePlan {
  current: string;
  latest: string | null;
  /** true when `latest` is a higher semver than `current`. */
  outdated: boolean;
  manager: Manager | null;
  /** Absolute path this binary was resolved from, for diagnostics. */
  installDir: string;
  /** Set when the installation is not one we should upgrade automatically. */
  blocked: string | null;
}

/** The version of the package this process is running from. */
export function currentVersion(): string {
  // dist/cli/update.js → dist/cli → dist → package root
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const dir of [
    path.resolve(here, "../.."),
    path.resolve(here, "../../.."),
    path.resolve(here, ".."),
  ]) {
    const file = path.join(dir, "package.json");
    try {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name === PKG && typeof parsed.version === "string") return parsed.version;
    } catch {
      // keep walking up
    }
  }
  return "0.0.0";
}

/**
 * Which manager owns this installation, inferred from the path the binary sits
 * in. Returns null when the path gives no signal.
 */
export function detectManager(installDir: string = modulePath()): Manager | null {
  const p = installDir.replace(/\\/g, "/");
  if (p.includes("/pnpm/") || p.includes("/.pnpm/")) return "pnpm";
  if (p.includes("/.bun/") || p.includes("/bun/install/")) return "bun";
  if (p.includes("/yarn/") || p.includes("/.yarn/")) return "yarn";
  if (p.includes("/node_modules/")) return "npm";
  return null;
}

/**
 * A local checkout, an npx cache or a linked package must not be "upgraded" —
 * doing so would either fail or replace the user's working tree with a registry
 * copy. Returns the reason to refuse, or null when the install is upgradable.
 */
export function blockReason(installDir: string = modulePath()): string | null {
  const p = installDir.replace(/\\/g, "/");
  if (p.includes("/_npx/")) {
    return "Running through npx, which fetches a fresh copy each time — there is nothing to update.";
  }
  if (!p.includes("/node_modules/")) {
    return "Running from a local checkout, not an installed package. Use git to update this copy.";
  }
  return null;
}

/** Compares dotted numeric versions. Pre-release suffixes sort below a release. */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const [core = "", ...rest] = v.split("-");
    return {
      nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0),
      pre: rest.join("-"),
    };
  };
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i += 1) {
    const x = a.nums[i] ?? 0;
    const y = b.nums[i] ?? 0;
    if (x !== y) return x > y;
  }
  // Equal cores: a release beats a pre-release, and neither beats itself.
  if (a.pre === b.pre) return false;
  if (a.pre === "") return true;
  if (b.pre === "") return false;
  return a.pre > b.pre;
}

/**
 * Latest published version from the registry, or null when unreachable.
 *
 * Two endpoints are tried. `/<pkg>/latest` is the small one, but the registry
 * edge has been observed answering it with 406 for a request it accepts moments
 * later, so a failure there falls back to the abbreviated packument rather than
 * being reported as "no update" — silently telling someone they are current
 * when the check simply failed is worse than saying the check failed.
 */
export async function fetchLatest(pkg: string = PKG): Promise<string | null> {
  const attempts: Array<{ url: string; pick: (b: unknown) => string | null }> = [
    {
      url: `${REGISTRY}/${pkg}/latest`,
      pick: (b) => {
        const o = b as { version?: unknown };
        return typeof o.version === "string" ? o.version : null;
      },
    },
    {
      url: `${REGISTRY}/${pkg}`,
      pick: (b) => {
        const o = b as { "dist-tags"?: { latest?: unknown } };
        const v = o["dist-tags"]?.latest;
        return typeof v === "string" ? v : null;
      },
    },
  ];

  for (const { url, pick } of attempts) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/vnd.npm.install-v1+json, application/json;q=0.9" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const version = pick(await res.json());
      if (version !== null) return version;
    } catch {
      // try the next endpoint
    }
  }
  return null;
}

export async function buildPlan(): Promise<UpdatePlan> {
  const installDir = modulePath();
  const current = currentVersion();
  const latest = await fetchLatest();
  return {
    current,
    latest,
    outdated: latest !== null && isNewer(latest, current),
    manager: detectManager(installDir),
    installDir,
    blocked: blockReason(installDir),
  };
}

/** The command that upgrades a global install for a given manager. */
export function installCommand(manager: Manager, pkg: string = PKG): string {
  switch (manager) {
    case "pnpm":
      return `pnpm add -g ${pkg}@latest`;
    case "yarn":
      return `yarn global add ${pkg}@latest`;
    case "bun":
      return `bun add -g ${pkg}@latest`;
    case "npm":
    default:
      return `npm install -g ${pkg}@latest`;
  }
}

/** True when llmtab-desktop is installed alongside, so it can be upgraded too. */
export function desktopInstalled(): boolean {
  const p = modulePath().replace(/\\/g, "/");
  const idx = p.lastIndexOf("/node_modules/");
  if (idx === -1) return false;
  return fs.existsSync(path.join(p.slice(0, idx), "node_modules", DESKTOP_PKG, "package.json"));
}

/** Confirms before changing an installation the user did not ask to modify. */
export function confirmUpdate(
  current: string,
  latest: string,
  packages: string[],
): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`Update ${packages.join(" and ")} from ${current} to ${latest}? [y/N] `, (a) => {
      rl.close();
      resolve(a.trim().toLowerCase() === "y");
    });
  });
}

function run(command: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    exec(command, { timeout: 300_000 }, (err, stdout, stderr) => {
      resolve({
        ok: err === null,
        output: `${stdout}${stderr}`.trim(),
      });
    });
  });
}

/**
 * Runs the upgrade. `packages` is every package to bring forward — the desktop
 * shell pins `llmtab`, so updating it alone would leave the two out of step.
 */
export async function applyUpdate(
  manager: Manager,
  packages: string[],
): Promise<{ ok: boolean; output: string; command: string }> {
  const command = packages.map((p) => installCommand(manager, p)).join(" && ");
  const { ok, output } = await run(command);
  return { ok, output, command };
}
