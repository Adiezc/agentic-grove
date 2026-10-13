/** Evidence only while the user has a stone/run panel open. No scene state is changed here. */
import { useEffect, useState } from 'react'
import type { Session } from '../../core/harnesses/types.ts'
import type { ActivityResult } from '../../core/activity-access.ts'
import { ago } from '../../core/usage/format.ts'
import { pollActivity } from './activity-poll'

const STATUS = { requested: 'Tool call recorded', returned: 'Result recorded', errored: 'Tool reported an error' } as const

function EvidenceTime({ at }: { at: number }) {
  return at ? <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>{ago(at, Date.now())}</time> : <>event time unrecorded</>
}

function Evidence({ stoneId, session }: { stoneId: string; session: Session }) {
  const [result, setResult] = useState<ActivityResult | null>(null)
  useEffect(() => {
    setResult(null)
    if (!window.grove) return
    return pollActivity(() => window.grove!.readActivity(stoneId, session.id), setResult)
  }, [stoneId, session.id])

  if (!window.grove) return <p className="panel-aside">Activity details are available in the Mac app.</p>
  if (!result) return <p className="panel-aside" role="status">Reading recorded activity…</p>
  if (!result.ok) return <p className="panel-aside" role="status">{result.error}</p>
  const detail = result.detail
  if (!detail) return <p className="panel-aside">{result.unavailable}</p>
  const tool = detail.lastTool
  const eventAt = tool ? tool.resultAt || tool.at : 0
  const stale = eventAt > 0 && Date.now() - eventAt > 60_000
  return (
    <div className="activity-evidence">
      <p className="activity-label">Last recorded tool</p>
      <p className="activity-tool">{tool?.label ?? 'No tool call in the recent transcript.'}</p>
      {tool ? <p className="setting-fine">{STATUS[tool.outcome]} · <EvidenceTime at={eventAt} />{stale ? ' · older evidence' : ''}</p> : null}
      {detail.tasks ? (
        <div className="activity-tasks">
          <p className="activity-label">Reported task list</p>
          <p>{detail.tasks.total ? `${detail.tasks.completed}/${detail.tasks.total} marked complete` : 'Reported list is empty'}</p>
          {detail.tasks.current ? <p className="setting-fine">{detail.tasks.current}</p> : null}
          <p className="setting-fine">Provider-reported, not verified · <EvidenceTime at={detail.tasks.at} /></p>
        </div>
      ) : <p className="setting-fine">No reported task list in this transcript window.</p>}
      {detail.delegations.length ? (
        <div>
          <p className="activity-label">Worker requests</p>
          <ul className="activity-workers">{detail.delegations.map((worker, index) => <li key={index}>{worker.name} <span className="tell-when">· <EvidenceTime at={worker.at} /></span></li>)}</ul>
          <p className="setting-fine">Requests recorded here; worker completion is not established.</p>
        </div>
      ) : null}
      <p className="setting-fine">Recent transcript evidence only. Tool calls do not prove tests passed or work was accepted.</p>
    </div>
  )
}

export function SessionActivity({ stoneId, sessions, open, sessionId }: { stoneId: string; sessions: Session[]; open: boolean; sessionId?: string }) {
  const [chosen, setChosen] = useState('')
  useEffect(() => { setChosen('') }, [stoneId])
  if (!open) return null
  const eligible = sessions.filter((session) => !session.archived)
  const session = sessionId ? eligible.find((session) => session.id === sessionId) : eligible.find((session) => session.id === chosen) ?? eligible[0]
  return (
    <section className="session-activity" aria-label="Recorded activity">
      <h3 className="activity-heading">Recorded activity</h3>
      {!session ? <p className="panel-aside">No observable session on this stone yet.</p> : (
        <>
          {!sessionId ? <label className="activity-session-label">Session
            <select className="activity-session" value={session.id} onChange={(event) => setChosen(event.target.value)}>
              {eligible.map((item) => <option key={item.id} value={item.id}>{item.harnessName} · {item.title.slice(0, 90)}</option>)}
            </select>
          </label> : <p className="setting-fine">{session.harnessName} · {session.title}</p>}
          <Evidence key={`${stoneId}:${session.id}`} stoneId={stoneId} session={session} />
        </>
      )}
    </section>
  )
}
