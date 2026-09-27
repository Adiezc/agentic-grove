/**
 * The listener: a tiny HTTP server that receives hook calls from Claude Code.
 *
 * Three things keep it from being a door anyone can walk through:
 *
 *   - **Loopback only.** Bound to 127.0.0.1, so nothing off this Mac can connect.
 *   - **A token in the path.** Written into Claude Code's settings at install. Another program on
 *     this Mac could read it, but one running as you could edit the settings anyway; the token is
 *     there so a request that merely guesses the port gets nothing.
 *   - **No browsers.** A web page can fire a request at localhost, and a browser always marks such
 *     a request with an `Origin` header. `curl` never does. So anything with one is refused.
 *
 * It answers every request quickly and with an empty body, because a `PreToolUse` hook's output
 * can be read by Claude Code as an instruction, and the only thing we ever want to say is nothing.
 */
import http from 'node:http'
import { HOOK_HOST, HOOK_PATH_MARK, HOOK_PORT, parseHookCall, type HookCall } from './protocol.ts'

/** Tool payloads can carry whole files. The Grove reads a few fields, so a cap costs nothing. */
const MAX_BODY_BYTES = 4 * 1024 * 1024

export interface HookServer {
  /** False when the port was taken, usually by a second copy of the Grove. */
  listening: boolean
  error?: string
  close(): void
}

export function startHookServer(token: string, onCall: (call: HookCall) => void): Promise<HookServer> {
  const expectedPath = `${HOOK_PATH_MARK}${token}/hook`

  const server = http.createServer((request, response) => {
    const refuse = (code: number) => {
      response.writeHead(code).end()
      request.resume()
    }
    if (request.method !== 'POST' || request.url !== expectedPath) return refuse(404)
    if (request.headers.origin) return refuse(403)

    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_BODY_BYTES) chunks.push(chunk)
    })
    request.on('end', () => {
      // Answer first: Claude Code is waiting on this, and nothing below should make it wait longer.
      response.writeHead(204).end()
      if (size > MAX_BODY_BYTES) return
      let raw: unknown
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return
      }
      const call = parseHookCall(raw)
      if (call) onCall(call)
    })
  })

  return new Promise((resolve) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve({
        listening: false,
        error:
          error.code === 'EADDRINUSE'
            ? `Port ${HOOK_PORT} is in use. Is another copy of the Grove open?`
            : error.message,
        close: () => {},
      })
    })
    server.listen(HOOK_PORT, HOOK_HOST, () => {
      resolve({ listening: true, close: () => server.close() })
    })
  })
}
