/**
 * The Grove's side of PM's channel: a small loopback HTTP server the channel helper talks to.
 *
 * The same three walls as the hooks listener (`core/hooks/server.ts`): bound to 127.0.0.1 only, a
 * random token every request must carry, and anything with a browser's `Origin` header refused,
 * so a web page cannot reach it. The port and token are written to `pm-bridge.json`, readable by
 * you only, where the helper finds them. A new token is made each time the Grove starts.
 *
 * Four requests, all POST with a JSON body:
 *
 *   /pm/next        anything for PM? Waits up to 25 seconds, then answers with what arrived.
 *   /pm/reply       PM's answer to you.
 *   /pm/permission  Claude Code opened a permission prompt in PM's window.
 *   /pm/tools       the Grove tools PM may call, and /pm/tool to call one.
 */
import { randomBytes } from 'node:crypto'
import fsp from 'node:fs/promises'
import http from 'node:http'
import type { PmChat } from './chat.ts'
import { POLL_WAIT_MS, TOKEN_HEADER, bridgeFile, pmHome, type PermissionRequest, type PmTool } from './protocol.ts'

/** Tool calls carry a task or a brief at most; a cap keeps a runaway body from filling memory. */
const MAX_BODY_BYTES = 256 * 1024

export interface ToolAnswer {
  ok: boolean
  text: string
}

export interface PmBridgeOptions {
  chat: PmChat
  tools(): PmTool[] | Promise<PmTool[]>
  callTool(name: string, args: unknown): Promise<ToolAnswer>
  /**
   * Agents talking to each other (`core/team/`): every `/team/...` request is handed here with its
   * body, and what comes back is the answer. Optional; without it those requests get a 404.
   */
  team?(route: string, body: Record<string, unknown>): Promise<unknown>
  /** PM's steps since your last message, kept with its reply. Optional; the checks leave it out. */
  stepsForReply?(): Promise<string[]>
  /** Port 0 picks a free one, the normal case. */
  port?: number
}

export interface PmBridge {
  port: number
  close(): Promise<void>
}

export async function startPmBridge(options: PmBridgeOptions): Promise<PmBridge> {
  const token = randomBytes(24).toString('hex')

  const server = http.createServer(async (request, response) => {
    const answer = (code: number, body?: unknown) => {
      response.writeHead(code, { 'Content-Type': 'application/json' }).end(body === undefined ? '' : JSON.stringify(body))
    }
    if (request.method !== 'POST' || request.headers[TOKEN_HEADER] !== token) {
      request.resume()
      return answer(404)
    }
    if (request.headers.origin) {
      request.resume()
      return answer(403)
    }

    let body: Record<string, unknown>
    try {
      body = await readJson(request)
    } catch {
      return answer(400)
    }

    try {
      switch (request.url) {
        case '/pm/next': {
          const wait = typeof body.waitMs === 'number' ? Math.min(Math.max(body.waitMs, 0), POLL_WAIT_MS) : POLL_WAIT_MS
          // A helper that hangs up while waiting must not take a message with it.
          let gone = false
          response.on('close', () => (gone = true))
          const items = await options.chat.poll(wait)
          if (gone && items.length) {
            for (const item of items) if (item.kind === 'chat') options.chat.tellPm(item.text, false)
            return
          }
          return answer(200, { items })
        }
        case '/pm/reply': {
          const text = typeof body.text === 'string' ? body.text : ''
          const steps = (await options.stepsForReply?.().catch(() => [])) ?? []
          const shown = options.chat.reply(text, body.needsYou === true, steps)
          return answer(shown ? 200 : 400, { ok: Boolean(shown) })
        }
        case '/pm/permission': {
          const fields = ['request_id', 'tool_name', 'description', 'input_preview'] as const
          if (!fields.every((field) => typeof body[field] === 'string')) return answer(400)
          options.chat.permissionRequest(body as unknown as PermissionRequest)
          return answer(200, { ok: true })
        }
        case '/pm/tools':
          return answer(200, { tools: await options.tools() })
        case '/pm/tool': {
          if (typeof body.name !== 'string') return answer(400)
          return answer(200, await options.callTool(body.name, body.args ?? {}))
        }
        default:
          if (options.team && request.url?.startsWith('/team/')) return answer(200, await options.team(request.url, body))
          return answer(404)
      }
    } catch (error) {
      return answer(500, { ok: false, text: error instanceof Error ? error.message : String(error) })
    }
  })
  // Long polls sit idle by design; the default timeouts would cut them off.
  server.requestTimeout = 0
  server.headersTimeout = 10_000

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })

  await fsp.mkdir(pmHome(), { recursive: true })
  await fsp.writeFile(bridgeFile(), JSON.stringify({ port, token }), { mode: 0o600 })
  // An older file may have been made with looser rights; the token is only for you.
  await fsp.chmod(bridgeFile(), 0o600)

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too big'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        const parsed = text ? (JSON.parse(text) as unknown) : {}
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object')
        resolve(parsed as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}
