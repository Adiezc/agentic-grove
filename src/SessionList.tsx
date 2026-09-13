/**
 * The ugly list. Real data, no grove.
 *
 * This is a milestone rather than a screen: it proves the whole chain works — scan, derive
 * stones, cross into the renderer, render — using the sessions actually on this machine. It is
 * meant to be replaced entirely by the scene in session three, so **nothing here is designed**,
 * on purpose. Time spent styling it is time spent on something that gets deleted, and a
 * half-styled list is also the easiest way to start quietly accepting a look nobody chose.
 *
 * What it *is* careful about is being honest: every status carries how much it can be trusted,
 * and anything the Grove could not read is shown rather than swallowed.
 */
import { useEffect } from 'react'
import { useGrove } from './store/grove'
import type { Runestone } from '../core/state/stones.ts'
import type { Session } from '../core/harnesses/types.ts'

/** `3m`, `4h`, `12d`. Absolute timestamps are unreadable in a list this long. */
function ago(timestamp: number): string {
  if (!timestamp) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}

function size(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`
  return `${(bytes / 1024 / 1024).toFixed(1)}M`
}

/** What each provenance means, spelled out on hover rather than explained in prose. */
const PROVENANCE_TITLE: Record<string, string> = {
  official: 'Official: the provider told us outright.',
  measured: 'Measured: we tested something real, such as signalling a live process.',
  inferred: 'Inferred: a reading of files and timestamps on disk. Usually right.',
  unknown: 'Unknown: this tool records nothing that answers the question.',
}

const MARK: Record<string, string> = { official: '=', measured: '=', inferred: '~', unknown: '?' }

function SessionRow({ session }: { session: Session }) {
  const openIt = () => {
    void window.grove?.openSession(session.harness, session.ref).then((result) => {
      // A harness with no per-session deep link says why, and the honest thing is to pass that
      // sentence on rather than let the click look like it worked.
      if (!result.ok && result.error) window.alert(result.error)
    })
  }

  return (
    <tr className={`session status-${session.status}`}>
      <td className="status">
        {session.status}
        <span className="mark" title={PROVENANCE_TITLE[session.statusProvenance]}>
          {MARK[session.statusProvenance]}
        </span>
      </td>
      <td>{session.harnessName}</td>
      <td className="model">{session.model || '—'}</td>
      <td className="number">{ago(session.lastActivityAt)}</td>
      <td className="number">{size(session.sizeBytes)}</td>
      <td className="title">
        {session.title}
        {session.gitBranch ? <span className="branch"> {session.gitBranch}</span> : null}
        {session.worktree ? <span className="branch"> +{session.worktree}</span> : null}
      </td>
      <td>
        {session.canOpen ? (
          <button type="button" onClick={openIt}>
            open
          </button>
        ) : null}
      </td>
    </tr>
  )
}

function Stone({ stone }: { stone: Runestone }) {
  return (
    <section className={`stone status-${stone.status}`}>
      <h2>
        {stone.name}
        {stone.role === 'wildwood' ? <span className="role"> the unbound stone</span> : null}
        <span className="counts">
          {stone.sessions.length} session{stone.sessions.length === 1 ? '' : 's'}
          {stone.runningCount ? ` · ${stone.runningCount} running` : ''}
          {stone.attentionCount ? ` · ${stone.attentionCount} want you` : ''}
        </span>
      </h2>
      <p className="path">{stone.path || 'no folder of its own'}</p>
      {stone.wildwoodReasons.length ? (
        <p className="why">Here because: {stone.wildwoodReasons.join('; ')}.</p>
      ) : null}
      {stone.sessions.length ? (
        <table>
          <tbody>
            {stone.sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="why">Nothing here yet.</p>
      )}
    </section>
  )
}

export function SessionList() {
  const { snapshot, loading, bridgeMissing, connect, refresh } = useGrove()

  // The store owns the subscription; this just ties its lifetime to the component's. The
  // returned unsubscribe matters more than it looks — React StrictMode mounts twice on purpose,
  // and without it the snapshot would be handled twice per tick from the first second.
  useEffect(() => connect(), [connect])

  if (bridgeMissing) {
    return (
      <main>
        <h1>agentic grove</h1>
        <p className="why">
          No bridge to the node side, which means this page is open in a plain browser. Run{' '}
          <code>npm run dev</code> and use the Electron window that opens.
        </p>
      </main>
    )
  }

  if (loading || !snapshot) {
    return (
      <main>
        <h1>agentic grove</h1>
        <p className="why">Scanning…</p>
      </main>
    )
  }

  const { grove, harnesses, problems, groveProblems, grovePath, scanMs } = snapshot

  return (
    <main>
      <h1>
        agentic grove
        <span className="counts">
          {grove.stones.length} stones · {grove.totalSessions} sessions ·{' '}
          {grove.runningSessions} running · {grove.attentionSessions} want you · scanned in{' '}
          {scanMs}ms
        </span>
        <button type="button" onClick={refresh}>
          rescan
        </button>
      </h1>

      <p className="harnesses">
        {harnesses.map((harness) => (
          <span key={harness.id} className={harness.detected ? 'on' : 'off'}>
            {harness.name}
            {harness.detected ? '' : ' (not installed)'}
          </span>
        ))}
      </p>

      {harnesses
        .filter((harness) => harness.diagnostic)
        .map((harness) => (
          <p key={harness.id} className="problem">
            {harness.name}: {harness.diagnostic}
          </p>
        ))}

      {problems.map((problem) => (
        <p key={problem.harness} className="problem">
          {problem.harness} failed to scan: {problem.message}
        </p>
      ))}

      {groveProblems.map((problem) => (
        <p key={problem.where} className="problem">
          grove.json · {problem.where}: {problem.message}
        </p>
      ))}

      {grove.hidden.length ? (
        <p className="why">
          Hidden by grove.json:{' '}
          {grove.hidden.map((entry) => `${entry.name} (${entry.sessionCount})`).join(', ')}.
        </p>
      ) : null}

      {grove.stones.map((stone) => (
        <Stone key={stone.id} stone={stone} />
      ))}

      <p className="why">
        Configuration lives in <code>{grovePath}</code>.{' '}
        <button type="button" onClick={() => void window.grove?.revealGroveFile()}>
          show in Finder
        </button>
      </p>
    </main>
  )
}
