/**
 * The conversation with PM, as the Grove keeps it.
 *
 * Messages you type wait in an inbox until PM's channel helper collects them; PM's replies, and
 * Claude Code's permission prompts, come back the other way and are shown in the chat panel. The
 * last few hundred messages are kept in `pm-chat.json` so the conversation is still there after a
 * restart. PM's own memory of it lives in its Claude Code session, which the Grove resumes.
 *
 * Plain node, no Electron: `test/verify-pm-channel.ts` drives it directly.
 */
import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { CONNECTED_WITHIN_MS, POLL_WAIT_MS, isRequestId, pmHome, type PermissionRequest, type PmInbound } from './protocol.ts'

export type ChatFrom = 'you' | 'pm' | 'grove'

export interface ChatMessage {
  id: string
  from: ChatFrom
  text: string
  at: number
  /** PM flagged this reply as needing you: it shows amber until you answer. */
  needsYou?: boolean
  /** PM's steps on the way to this reply ("Read core/scan.ts"), kept with it as Claude Code keeps them. */
  steps?: string[]
  /** A permission prompt relayed from PM's session, answered with Allow or Deny. */
  permission?: PermissionRequest & { state: 'open' | 'allowed' | 'denied' | 'closed' }
}

/** What the chat panel is sent with every snapshot. */
export interface PmChatState {
  /** PM's helper asked for messages recently: the session is open and listening. */
  connected: boolean
  /** A message of yours has gone to PM and no reply has come back yet. */
  working: boolean
  /** Something in the conversation is waiting on you: an open permission prompt or a flagged reply. */
  needsYou: boolean
  messages: ChatMessage[]
}

/** How many messages are kept on disk and sent to the window. History, not an archive. */
const KEEP_MESSAGES = 300
const SEND_MESSAGES = 80
/** Longest message either way; a limit so a pasted file cannot fill the chat file. */
export const MAX_CHAT_CHARS = 20_000

export const chatPath = (): string => path.join(pmHome(), 'pm-chat.json')

export class PmChat {
  private messages: ChatMessage[] = []
  private inbox: PmInbound[] = []
  private pollers: ((items: PmInbound[]) => void)[] = []
  private lastPollAt = 0
  private working = false
  private listeners = new Set<() => void>()
  private saving: Promise<void> = Promise.resolve()

  constructor(private now: () => number = Date.now) {}

  /** Read the saved conversation. A missing or broken file is an empty conversation, never an error. */
  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fsp.readFile(chatPath(), 'utf8')) as unknown
      if (Array.isArray(raw)) {
        this.messages = raw.filter((m): m is ChatMessage => typeof m === 'object' && m !== null && typeof (m as ChatMessage).text === 'string').slice(-KEEP_MESSAGES)
        // A prompt left open by a session that has since gone cannot be answered any more.
        for (const m of this.messages) if (m.permission?.state === 'open') m.permission.state = 'closed'
      }
    } catch {
      this.messages = []
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  state(): PmChatState {
    const recent = this.messages.slice(-SEND_MESSAGES)
    return {
      connected: this.connected(),
      working: this.working && this.connected(),
      needsYou: recent.some((m) => m.permission?.state === 'open') || this.lastIsFlagged(),
      messages: recent,
    }
  }

  connected(): boolean {
    return this.pollers.length > 0 || this.now() - this.lastPollAt < CONNECTED_WITHIN_MS
  }

  /**
   * You typed something. It waits in the inbox until PM's helper collects it. `context` goes to PM
   * with it but is not shown back to you: which stone you had selected, the model you chose.
   */
  say(text: string, context = ''): ChatMessage | null {
    const clean = text.trim().slice(0, MAX_CHAT_CHARS)
    if (!clean) return null
    const message = this.add({ from: 'you', text: clean })
    this.working = true
    const extra = context.trim().slice(0, 2000)
    this.push({ kind: 'chat', id: message.id, text: extra ? `${clean}\n\n${extra}` : clean })
    return message
  }

  /** Word from the Grove itself to PM, such as your answer to one of its proposals. Shown small in the chat too. */
  tellPm(text: string, show = true): void {
    if (show) this.add({ from: 'grove', text })
    this.push({ kind: 'chat', id: randomUUID(), text: `[Grove] ${text}` })
  }

  /** A note for you only, never sent to PM: PM is starting, the window closed. */
  note(text: string): void {
    this.add({ from: 'grove', text })
  }

  /** PM answered through its reply tool. */
  reply(text: string, needsYou = false, steps: string[] = []): ChatMessage | null {
    const clean = text.trim().slice(0, MAX_CHAT_CHARS)
    if (!clean) return null
    this.working = false
    return this.add({ from: 'pm', text: clean, needsYou: needsYou || undefined, steps: steps.length ? steps.slice(-20) : undefined })
  }

  /** Claude Code opened a permission prompt in PM's window; it shows as a card you can answer here. */
  permissionRequest(request: PermissionRequest): void {
    if (!isRequestId(request.request_id)) return
    this.add({ from: 'pm', text: request.description, permission: { ...request, state: 'open' } })
  }

  /** Allow or Deny on a permission card. Only an open prompt with a real id can be answered. */
  answerPermission(requestId: unknown, allow: boolean): boolean {
    if (!isRequestId(requestId)) return false
    const message = this.messages.find((m) => m.permission?.request_id === requestId && m.permission.state === 'open')
    if (!message?.permission) return false
    message.permission.state = allow ? 'allowed' : 'denied'
    this.push({ kind: 'verdict', requestId, behavior: allow ? 'allow' : 'deny' })
    this.changed()
    return true
  }

  /**
   * PM's helper asking for anything new. Answers at once when the inbox has something, otherwise
   * waits up to `waitMs` so a message you type reaches PM straight away rather than on the next poll.
   */
  poll(waitMs: number): Promise<PmInbound[]> {
    // Capped here as well as in the bridge, so no caller can hold a timer open for long.
    const wait = Math.min(Math.max(Number.isFinite(waitMs) ? waitMs : 0, 0), POLL_WAIT_MS)
    const wasConnected = this.connected()
    this.lastPollAt = this.now()
    if (!wasConnected) this.changed()
    if (this.inbox.length) return Promise.resolve(this.inbox.splice(0))
    return new Promise((resolve) => {
      const deliver = (items: PmInbound[]) => {
        clearTimeout(timer)
        this.lastPollAt = this.now()
        resolve(items)
      }
      const timer = setTimeout(() => {
        this.pollers = this.pollers.filter((p) => p !== deliver)
        this.lastPollAt = this.now()
        resolve([])
      }, wait)
      this.pollers.push(deliver)
    })
  }

  /** Called on a timer by the app so the panel notices a session that stopped polling. */
  tick(): void {
    if (this.working && !this.connected()) {
      this.working = false
      this.changed()
    }
  }

  private lastIsFlagged(): boolean {
    for (const m of [...this.messages].reverse()) {
      if (m.from === 'you') return false
      if (m.from === 'pm') return Boolean(m.needsYou)
    }
    return false
  }

  private push(item: PmInbound): void {
    const poller = this.pollers.shift()
    if (poller) poller([item])
    else this.inbox.push(item)
    this.changed()
  }

  private add(fields: Omit<ChatMessage, 'id' | 'at'>): ChatMessage {
    const message: ChatMessage = { id: randomUUID(), at: this.now(), ...fields }
    this.messages.push(message)
    if (this.messages.length > KEEP_MESSAGES) this.messages.splice(0, this.messages.length - KEEP_MESSAGES)
    this.save()
    this.changed()
    return message
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  /** Saves one after another, each to a unique temporary file then renamed, so no write is half-seen. */
  private save(): void {
    const snapshot = JSON.stringify(this.messages)
    this.saving = this.saving.then(async () => {
      try {
        await fsp.mkdir(pmHome(), { recursive: true })
        const temp = `${chatPath()}.${randomUUID()}.tmp`
        await fsp.writeFile(temp, snapshot, { mode: 0o600 })
        await fsp.rename(temp, chatPath())
      } catch {
        // Losing the saved copy costs history after a restart, never the conversation now.
      }
    })
  }

  /** For the checks: wait until every save has landed. */
  settled(): Promise<void> {
    return this.saving
  }
}
