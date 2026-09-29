/**
 * The AI tools the Grove works with, each with a one-button setup when it is missing.
 *
 * Shown twice: as a step in Researcher's first-launch walkthrough, and in Settings for later. Each
 * row says whether the tool is ready; a missing one gets a Set up button that opens Terminal running
 * the maker's own installer, then its sign-in (see `core/setup.ts` for why it is done that way).
 *
 * Someone who already has both sees two ticks and moves on. Someone who has neither can be running
 * in two clicks and two sign-ins, without having to know what a terminal command is.
 */
import { useState } from 'react'
import { Asterisk, Check, OpenAiLogo, type Icon } from '@phosphor-icons/react'
import type { SetupTool } from '../../core/setup.ts'
import { useGrove } from '../store/grove'

interface Row {
  tool: SetupTool
  name: string
  company: string
  Mark: Icon
  ready: boolean
  /** The maker's desktop app is here even though the command-line tool is not. */
  appOnly: boolean
}

export function ToolSetup({ compact = false }: { compact?: boolean }) {
  const setup = useGrove((state) => state.snapshot?.setup)
  const [message, setMessage] = useState<Partial<Record<SetupTool, string>>>({})

  const rows: Row[] = [
    {
      tool: 'claude-code',
      name: 'Claude Code',
      company: 'Claude account',
      Mark: Asterisk,
      ready: Boolean(setup?.['claude-code'].cli),
      appOnly: Boolean(!setup?.['claude-code'].cli && setup?.['claude-code'].app),
    },
    {
      tool: 'codex',
      name: 'Codex',
      company: 'ChatGPT account',
      Mark: OpenAiLogo,
      ready: Boolean(setup?.codex.cli),
      appOnly: Boolean(!setup?.codex.cli && setup?.codex.app),
    },
  ]

  const run = async (tool: SetupTool) => {
    const result = await window.grove?.setUpTool(tool)
    const text = !result
      ? 'Setup needs the Grove app, not a browser tab.'
      : !result.ok
        ? (result.error ?? 'Could not start setup.')
        : result.opened === 'page'
          ? 'Opened the install page in your browser.'
          : 'Terminal is open. Follow it, then sign in when your browser asks.'
    setMessage((current) => ({ ...current, [tool]: text }))
  }

  return (
    <ul className={`tool-setup${compact ? ' is-compact' : ''}`}>
      {rows.map((row) => (
        <li key={row.tool} className={row.ready ? 'is-ready' : ''}>
          <span className="tool-mark" aria-hidden="true">
            <row.Mark size={15} weight="regular" />
          </span>
          <span className="tool-text">
            {row.name}
            <small>
              {message[row.tool] ??
                (row.ready
                  ? 'Ready. The Grove can run agents with it.'
                  : row.appOnly
                    ? 'The app is here. Add the command-line tool so agents can work in your folders.'
                    : `Signs in with your ${row.company}.`)}
            </small>
          </span>
          {row.ready ? (
            <Check size={16} weight="regular" className="tool-ready" aria-label="Ready" />
          ) : (
            <button type="button" className="setting-button is-primary" onClick={() => void run(row.tool)}>
              Set up
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
