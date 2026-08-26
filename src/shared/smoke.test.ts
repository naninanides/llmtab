import { describe, expect, it } from "vitest";
import { TOOL_IDS } from "./types.js";

describe("smoke", () => {
  it("tool ids are the v1.1 set", () => {
    expect(TOOL_IDS).toEqual(["claude-code", "codex", "gemini-cli", "zcode", "opencode", "ollama"]);
  });
});
