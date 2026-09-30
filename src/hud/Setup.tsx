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
import type { SetupTool, ToolSource } from '../../core/setup.ts'
import { useGrove } from '../store/grove'

interface Row {
  tool: SetupTool
  name: string
  company: string
  Mark: Icon
  ready: boolean
  /** The maker's desktop app is here even though the command-line tool is not. */
  appOnly: boolean
  /** Where the command was found, so "Ready" can say which copy the Grove will use. */
  source?: ToolSource
}

/** Which copy the Grove found, in words. */
const FOUND: Record<ToolSource, (app: string) => string> = {
  installed: () => 'Ready. Found installed on this Mac.',
  shell: () => 'Ready. Found where your Terminal finds it.',
  app: (app) => `Ready. Using the copy inside the ${app} app.`,
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
      source: setup?.['claude-code'].source,
    },
    {
      tool: 'codex',
      name: 'Codex',
      company: 'ChatGPT account',
      Mark: OpenAiLogo,
      ready: Boolean(setup?.codex.cli),
      appOnly: Boolean(!setup?.codex.cli && setup?.codex.app),
      source: setup?.codex.source,
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

  // The desktop apps: where most people use Claude and ChatGPT, and where Cowork and Dots live.
  const apps = [
    { app: 'claude' as const, name: 'Claude app', Mark: Asterisk, ready: Boolean(setup?.['claude-code'].app), line: 'Chat, Cowork, and Claude Code in a window.' },
    { app: 'chatgpt' as const, name: 'ChatGPT app', Mark: OpenAiLogo, ready: Boolean(setup?.codex.app), line: 'Chat, Dots, and Codex in a window.' },
  ]

  return (
    <ul className={`tool-setup${compact ? ' is-compact' : ''}`}>
      {apps.map((row) => (
        <li key={row.app} className={row.ready ? 'is-ready' : ''}>
          <span className="tool-mark" aria-hidden="true">
            <row.Mark size={15} weight="regular" />
          </span>
          <span className="tool-text">
            {row.name}
            <small>{row.ready ? 'Installed.' : row.line}</small>
          </span>
          {row.ready ? (
            <Check size={16} weight="regular" className="tool-ready" aria-label="Installed" />
          ) : (
            <button type="button" className="setting-button" onClick={() => void window.grove?.getApp(row.app)}>
              Get app
            </button>
          )}
        </li>
      ))}
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
                  ? row.source
                    ? FOUND[row.source](row.tool === 'claude-code' ? 'Claude' : 'ChatGPT')
                    : 'Ready. The Grove can run agents with it.'
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
