import fs from "node:fs";
import readline from "node:readline";
import { llmtabHome } from "../shared/paths.js";

/**
 * Removes all LLMTab state (FR-7). Only ever touches `~/.llmtab` —
 * never the user's AI tool data.
 */
export function confirmUninstall(home: string = llmtabHome(), force = false): Promise<boolean> {
  if (force) return Promise.resolve(true);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`Remove all LLMTab data at ${home}? [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export function uninstall(home: string = llmtabHome()): { removed: boolean; path: string } {
  if (!fs.existsSync(home)) {
    return { removed: false, path: home };
  }
  fs.rmSync(home, { recursive: true, force: true });
  return { removed: true, path: home };
}
