/**
 * PM's channel helper: the small program Claude Code starts beside PM's session.
 *
 * Claude Code runs this as an MCP server over stdin and stdout and, because PM is started with
 * `--dangerously-load-development-channels server:grove`, lets it push messages into the session
 * (Claude Code's *channels*, a research preview). It does three things and nothing else:
 *
 *   1. Collects what you type in the Grove and hands it to PM as a `<channel source="grove">` event.
 *   2. Offers PM the `reply` tool and the Grove's own tools, and passes each call to the Grove.
 *   3. Relays Claude Code's permission prompts to the Grove, and your Allow or Deny back.
 *
 * It holds no state and makes no decisions: the Grove app does (`core/pm/`). It speaks MCP by hand
 * rather than pulling in the SDK, because the protocol it needs is five messages long and a
 * dependency for that would cost more than it saves. Stdout carries the protocol only; anything
 * worth saying for debugging goes to stderr, which Claude Code keeps in its debug log.
 *
 * Run by Electron's own binary in node mode (`ELECTRON_RUN_AS_NODE=1`), so nothing else needs to
 * be installed. Built to `dist-electron/grove-channel.js` beside the main process.
 */
import fsp from 'node:fs/promises'
import readline from 'node:readline'
import { CHANNEL_INSTRUCTIONS, POLL_WAIT_MS, TOKEN_HEADER, bridgeFile, type BridgeAddress, type PmInbound, type PmTool } from '../core/pm/protocol.ts'

/**
 * Protocol revisions this helper answers with. Claude Code does not register a channel that
 * negotiates revision 2026-07-28 (channels reference, checked 17 October 2026), so that one is
 * never offered; anything else unknown gets the newest one here.
 */
const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

const REPLY_TOOL: PmTool = {
  name: 'reply',
  description:
    'Send a message to the person in the Agentic Grove window. This is the only way they see what you say. ' +
    'Set needs_you when the message asks them to decide or do something, so it shows amber until they answer.',
  inputSchema: {
    type: 'object',
    properties: {
      chat_id: { type: 'string', description: 'The chat_id from the message you are answering, if any.' },
      text: { type: 'string', description: 'What to say. Short and plain.' },
      needs_you: { type: 'boolean', description: 'True when the person must decide or act.' },
    },
    required: ['text'],
  },
}

const log = (...parts: unknown[]) => process.stderr.write(`[grove-channel] ${parts.join(' ')}\n`)

function send(message: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
}

/* ---- Talking to the Grove ------------------------------------------------------------------ */

/** Read fresh every time: the Grove writes a new token whenever it starts. */
async function address(): Promise<BridgeAddress | null> {
  try {
    const parsed = JSON.parse(await fsp.readFile(bridgeFile(), 'utf8')) as Partial<BridgeAddress>
    return typeof parsed.port === 'number' && typeof parsed.token === 'string' ? (parsed as BridgeAddress) : null
  } catch {
    return null
  }
}

async function grove(route: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  const at = await address()
  if (!at) return null
  try {
    const response = await fetch(`http://127.0.0.1:${at.port}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [TOKEN_HEADER]: at.token },
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) return null
    const text = await response.text()
    return text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    return null
  }
}

const GROVE_CLOSED = 'The Agentic Grove app is not open, so this could not reach it. Ask the person to open the Grove.'

/* ---- Handling Claude Code's requests ------------------------------------------------------- */

async function handle(message: { id?: string | number; method?: string; params?: Record<string, unknown> }): Promise<void> {
  const { id, method, params = {} } = message
  const respond = (result: unknown) => id !== undefined && send({ id, result })
  const fail = (code: number, text: string) => id !== undefined && send({ id, error: { code, message: text } })

  switch (method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      return void respond({
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: {
          experimental: { 'claude/channel': {}, 'claude/channel/permission': {} },
          tools: {},
        },
        serverInfo: { name: 'grove', version: '0.1.0' },
        instructions: CHANNEL_INSTRUCTIONS,
      })
    }
    case 'notifications/initialized':
      return void startPolling()
    case 'ping':
      return void respond({})
    case 'tools/list': {
      const answer = await grove('/pm/tools', {})
      const tools = Array.isArray(answer?.tools) ? (answer.tools as PmTool[]) : []
      return void respond({ tools: [REPLY_TOOL, ...tools] })
    }
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : ''
      const args = (params.arguments ?? {}) as Record<string, unknown>
      let ok = false
      let text = GROVE_CLOSED
      if (name === 'reply') {
        const answer = await grove('/pm/reply', { text: args.text, needsYou: args.needs_you === true })
        if (answer) {
          ok = answer.ok === true
          text = ok ? 'sent' : 'Not sent: the message was empty.'
        }
      } else {
        const answer = await grove('/pm/tool', { name, args })
        if (answer) {
          ok = answer.ok === true
          text = typeof answer.text === 'string' ? answer.text : ok ? 'done' : 'failed'
        }
      }
      return void respond({ content: [{ type: 'text', text }], isError: !ok })
    }
    case 'notifications/claude/channel/permission_request': {
      const answer = await grove('/pm/permission', params)
      if (!answer) log('permission prompt not relayed: Grove not reachable')
      return
    }
    default:
      // Notifications need no answer; an unknown request gets the standard "no such method".
      if (id !== undefined && method && !method.startsWith('notifications/')) fail(-32601, `Unknown method ${method}`)
  }
}

/* ---- Bringing your messages to PM ---------------------------------------------------------- */

let polling = false

function deliver(item: PmInbound): void {
  if (item.kind === 'chat') {
    send({ method: 'notifications/claude/channel', params: { content: item.text, meta: { chat_id: item.id } } })
  } else {
    send({ method: 'notifications/claude/channel/permission', params: { request_id: item.requestId, behavior: item.behavior } })
  }
}

async function startPolling(): Promise<void> {
  if (polling) return
  polling = true
  while (polling) {
    const answer = await grove('/pm/next', { waitMs: POLL_WAIT_MS }, AbortSignal.timeout(POLL_WAIT_MS + 10_000))
    if (answer && Array.isArray(answer.items)) {
      for (const item of answer.items as PmInbound[]) deliver(item)
    } else {
      // The Grove is closed or restarting. Try again shortly; PM keeps working meanwhile.
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }
}

const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  if (!line.trim()) return
  let message: unknown
  try {
    message = JSON.parse(line)
  } catch {
    return log('unreadable message from Claude Code')
  }
  handle(message as Parameters<typeof handle>[0]).catch((error) => log('error', error instanceof Error ? error.message : String(error)))
})
input.on('close', () => process.exit(0))
