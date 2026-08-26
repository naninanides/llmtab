import { createHash } from "node:crypto";

/** Composite dedup key per PRD §7 rule 3: hash(tool, session_id, msg_id|req_id, ts). */
export function dedupKey(
  tool: string,
  sessionId: string,
  messageId: string,
  timestamp: string,
): string {
  return createHash("sha256")
    .update(`${tool}\u0000${sessionId}\u0000${messageId}\u0000${timestamp}`)
    .digest("hex")
    .slice(0, 32);
}
