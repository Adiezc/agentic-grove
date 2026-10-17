/**
 * The words the Grove and PM's channel use with each other.
 *
 * PM is a real Claude Code session in a Terminal window, on your own plan (DECISIONS.md, 30
 * September 2026: the app never runs the subscription itself). Claude Code starts a small helper,
 * `electron/grove-channel.ts`, as a *channel*: an MCP server that may push messages into the
 * session. The helper is a go-between only. It asks the Grove for your chat messages, hands PM's
 * replies and tool calls back, and relays Claude Code's permission prompts so you can answer them
 * from the Grove's window. Decided 17 October 2026 with Adrian; see DECISIONS.md.
 *
 * The helper reaches the Grove over loopback HTTP, the same way the hooks do: 127.0.0.1 only, a
 * random token in a file only you can read, and anything carrying a browser's `Origin` refused.
 *
 * Types and plain functions only, so the helper can be bundled without the rest of `core/`.
 */
import os from 'node:os'
import path from 'node:path'

/** Mirrors `groveHome()` in `core/state/grove.ts` without importing it, so the helper stays small. */
export const pmHome = (): string => process.env.AGENTIC_GROVE_HOME || path.join(os.homedir(), '.agentic-grove')

/** Where the Grove writes the port and token for the helper. Mode 0600. */
export const bridgeFile = (): string => path.join(pmHome(), 'pm-bridge.json')

export interface BridgeAddress {
  port: number
  token: string
}

/** The header the helper sends the token in. */
export const TOKEN_HEADER = 'x-grove-token'

/** How long the helper's "anything for PM?" request waits before coming back empty. */
export const POLL_WAIT_MS = 25_000

/** Without a poll for this long, PM counts as not connected (the session ended or the window closed). */
export const CONNECTED_WITHIN_MS = 40_000

/** Something for PM, as the helper turns it into a channel event or a verdict. */
export type PmInbound =
  | { kind: 'chat'; id: string; text: string }
  | { kind: 'verdict'; requestId: string; behavior: 'allow' | 'deny' }

/** A tool the helper offers PM, as MCP lists it. */
export interface PmTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** What Claude Code sends when a permission prompt opens (`notifications/claude/channel/permission_request`). */
export interface PermissionRequest {
  request_id: string
  tool_name: string
  description: string
  input_preview: string
}

/** Claude Code's request ids: five lowercase letters, never `l`. Anything else is not one of its ids. */
export const isRequestId = (text: unknown): text is string => typeof text === 'string' && /^[a-km-z]{5}$/.test(text)

/** Told to PM when its channel connects. Short: the full brief arrives with `--append-system-prompt`. */
export const CHANNEL_INSTRUCTIONS =
  'Messages from the person arrive as <channel source="grove" chat_id="...">: they typed them in the ' +
  'Agentic Grove window. Answer with the reply tool (pass the chat_id); the person reads replies in the ' +
  'Grove, not in this terminal. Use the Grove tools (grove_status, send_agent, create_agent, make_clearing ' +
  'and the rest) to act on the grove; the ones that need the person\'s yes become a card in the Grove and ' +
  'you hear the answer as a channel message.'
