/**
 * The rail's two list panels: Projects and Saved tasks.
 *
 * The scene is the grove at a glance; these are the same things as lists, for when you want to find
 * one by name, see them all at once, or act on something the scene has no room to say. They open
 * beside the rail, on the same glass as Settings, and never cover the tree.
 *
 * **Projects** lists every stone, sub-stones under their parent, with its state. Choosing one flies
 * there. A project whose work has spread across two or three big parts offers to give each part a
 * sub-stone of its own; nothing is split unless you press the button.
 *
 * **Saved tasks** lists the runes carved on every stone: jobs you repeat on one project, like "run
 * the tests" or "write the weekly summary". Running one needs agent spawning (roadmap step 9), so
 * the button is there and honest about not working yet.
 */
import { useState } from 'react'
import { ArrowBendDownRight, CaretRight, FolderPlus, GitBranch, Play, Plus, X } from '@phosphor-icons/react'
import type { Runestone } from '../../core/state/stones.ts'
import type { StoneSpec } from '../scene/Runestone'
import { useFlow } from '../store/flow'
import { STATE_LABEL } from './Flow'

function PanelShell({
  open,
  title,
  label,
  onClose,
  children,
}: {
  open: boolean
  title: string
  label: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <aside className={`flow-panel settings-panel rail-panel${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open} aria-label={label}>
      <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
        <X size={16} weight="thin" />
      </button>
      <h2 className="panel-title">{title}</h2>
      {children}
    </aside>
  )
}

export function ProjectsPanel({
  open,
  onClose,
  stones,
  real,
}: {
  open: boolean
  onClose: () => void
  stones: StoneSpec[]
  real: Runestone[]
}) {
  const selectStone = useFlow((state) => state.selectStone)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const canWrite = Boolean(window.grove)

  const act = async (run: () => Promise<{ ok: boolean; cancelled?: boolean; error?: string } | undefined>) => {
    setError(null)
    const result = await run()
    if (result && !result.ok && !result.cancelled) setError(result.error ?? 'That did not work')
  }

  // Parents first, each followed by its sub-stones, so the list reads the way the grove branches.
  const tops = stones.filter((stone) => !stone.parent)
  const childrenOf = (id: string) => stones.filter((stone) => stone.parent === id)
  const all = tops.flatMap((stone) => [stone, ...childrenOf(stone.id)])
  // A search box only once the list is long enough to need one (review item 8). Matching any
  // part of the name, ignoring case; a sub-stone that matches brings no parent along with it.
  const searchable = all.length > 6
  const wanted = query.trim().toLowerCase()
  const rows = searchable && wanted ? all.filter((stone) => stone.name.toLowerCase().includes(wanted)) : all

  return (
    <PanelShell open={open} title="Projects" label="Projects" onClose={onClose}>
      {searchable ? (
        <input
          className="rail-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a project"
          aria-label="Find a project"
          spellCheck={false}
        />
      ) : null}
      {searchable && wanted && !rows.length ? <p className="setting-line">No project called that.</p> : null}
      {rows.length ? (
        <ul className="rail-list">
          {rows.map((stone) => {
            const derived = real.find((each) => each.id === stone.id)
            const splits = derived?.splits ?? []
            return (
              <li key={stone.id} className={stone.parent ? 'is-child' : ''}>
                <button
                  type="button"
                  className="rail-row"
                  onClick={() => {
                    onClose()
                    selectStone(stone.id)
                  }}
                >
                  {stone.parent ? <ArrowBendDownRight size={13} weight="thin" className="row-branch" aria-hidden="true" /> : null}
                  <span className={`state-dot tone-${stone.status}`} aria-hidden="true" />
                  <span className="rail-row-text">
                    {stone.name}
                    <small>
                      {STATE_LABEL[stone.status]}
                      {derived?.runningCount ? `, ${derived.runningCount} running` : ''}
                      {derived?.runes.length ? `, ${derived.runes.length} saved ${derived.runes.length === 1 ? 'task' : 'tasks'}` : ''}
                    </small>
                  </span>
                  <CaretRight size={13} weight="thin" className="row-caret" />
                </button>
                {splits.length ? (
                  <div className="split-offer">
                    <p>Work here has spread over {splits.length} big parts. Give each its own stone?</p>
                    <div className="split-choices">
                      {splits.map((split) => (
                        <button
                          key={split.path}
                          type="button"
                          className="setting-button"
                          disabled={!canWrite}
                          onClick={() => void act(() => window.grove!.connectSuggested(split.path))}
                          title={`${split.sessionCount} sessions in ${split.path}`}
                        >
                          {split.kind === 'worktree' ? <GitBranch size={12} weight="thin" /> : null} {split.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : all.length ? null : (
        <p className="setting-line">No projects yet. Connect a folder you already have, or start a new one.</p>
      )}
      <div className="setting-actions rail-actions">
        <button type="button" className="setting-button is-primary" disabled={!canWrite} onClick={() => void act(() => window.grove!.browseProject())}>
          <FolderPlus size={13} weight="thin" /> Connect a folder
        </button>
        <button type="button" className="setting-button" disabled={!canWrite} onClick={() => void act(() => window.grove!.createProject())}>
          <Plus size={13} weight="thin" /> New project
        </button>
      </div>
      <p className="setting-fine">
        A sub-stone is a big part of a project, a subfolder or a git worktree, standing as its own stone and joined to its
        parent. Open a stone and choose “Split off a part” to make one by hand.
      </p>
      {error ? <p className="panel-error">{error}</p> : null}
    </PanelShell>
  )
}

export function RunesPanel({
  open,
  onClose,
  real,
}: {
  open: boolean
  onClose: () => void
  real: Runestone[]
}) {
  const carved = real.filter((stone) => stone.runes.length)
  return (
    <PanelShell open={open} title="Saved tasks" label="Saved tasks" onClose={onClose}>
      <p className="setting-line">
        Jobs you repeat on one project, like “run the tests” or “write the weekly summary”. Each is carved on its stone as a
        rune.
      </p>
      {carved.length ? (
        carved.map((stone) => (
          <section key={stone.id} className="setting">
            <p className="setting-name">{stone.name}</p>
            <ul className="rail-list">
              {stone.runes.map((rune) => (
                <li key={rune.id} className="rune-row">
                  <span className="rail-row-text">
                    {rune.name}
                    <small>{rune.prompt.length > 80 ? `${rune.prompt.slice(0, 79)}…` : rune.prompt}</small>
                  </span>
                  <button type="button" className="setting-button" disabled title="Running saved tasks arrives with agent spawning">
                    <Play size={12} weight="thin" /> Run
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <>
          <p className="setting-line">
            None yet. Soon you will save one from the console with a click; for now they are written into grove.json by hand.
          </p>
          <div className="setting-actions">
            <button type="button" className="setting-button" disabled={!window.grove} onClick={() => void window.grove?.revealGroveFile()}>
              Show grove.json
            </button>
          </div>
        </>
      )}
    </PanelShell>
  )
}
