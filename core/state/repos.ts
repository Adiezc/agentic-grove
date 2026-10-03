/**
 * Which connected folders are checkouts of the same git repository.
 *
 * Twin stones (roadmap idea 8): when two stones are the same repo on different branches, because
 * one of them is a git worktree of the other, they stand side by side and share a base instead of
 * looking like two unrelated projects. Claude Code makes worktrees under `<repo>/.claude/worktrees/`,
 * Codex under `~/.codex/worktrees/`, and people make their own with `git worktree add`; all three
 * are told apart the same way, by what git itself wrote.
 *
 * How git records it, and so what is read here (and nothing else):
 *
 *   - A normal checkout has a `.git` **folder**. That folder is the repository.
 *   - A worktree has a `.git` **file** saying `gitdir: <repo>/.git/worktrees/<name>`, and that
 *     folder holds a `commondir` file pointing back at the shared repository.
 *   - Either way, `HEAD` in the git folder names the branch: `ref: refs/heads/<branch>`, or a bare
 *     commit hash when nothing is checked out by name.
 *
 * Only the `.git` entry directly in the folder is read. A stone for a subfolder of a repo is a part
 * of that project (a sub-stone), not another checkout of it, so it is left alone on purpose.
 *
 * Read-only, like everything the Grove does to folders it did not make. A folder that is not a repo,
 * or whose files cannot be read, is simply not a twin.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'

export interface RepoInfo {
  /** The shared repository folder (`<repo>/.git`). Two checkouts with the same one are twins. */
  common: string
  /** True for a worktree, false for the repository's main checkout. */
  worktree: boolean
  /** The checked-out branch, or undefined when HEAD is a bare commit or unreadable. */
  branch?: string
}

const readText = (file: string) => fsp.readFile(file, 'utf8').then((text) => text.trim()).catch(() => null)

async function branchIn(gitDir: string): Promise<string | undefined> {
  const head = await readText(path.join(gitDir, 'HEAD'))
  const match = head ? /^ref:\s*refs\/heads\/(.+)$/.exec(head) : null
  return match?.[1]
}

/** What git says about one folder, or null when it is not the top of a checkout. */
export async function readRepo(folder: string): Promise<RepoInfo | null> {
  const dotGit = path.join(folder, '.git')
  const stat = await fsp.stat(dotGit).catch(() => null)
  if (!stat) return null
  if (stat.isDirectory()) return { common: dotGit, worktree: false, branch: await branchIn(dotGit) }

  const pointer = await readText(dotGit)
  const match = pointer ? /^gitdir:\s*(.+)$/m.exec(pointer) : null
  if (!match) return null
  const gitDir = path.resolve(folder, match[1]!.trim())
  // No `commondir` means this is not a worktree but something else that uses a `.git` file, a
  // submodule for one. Its repository is its own, so it twins with nothing.
  const common = await readText(path.join(gitDir, 'commondir'))
  if (common === null) return { common: gitDir, worktree: false, branch: await branchIn(gitDir) }
  return { common: path.resolve(gitDir, common), worktree: true, branch: await branchIn(gitDir) }
}

/** `readRepo` for every folder given, all at once. Folders that are not checkouts are left out. */
export async function readRepos(folders: string[]): Promise<Map<string, RepoInfo>> {
  const found = await Promise.all(folders.map(async (folder) => [folder, await readRepo(folder)] as const))
  return new Map(found.filter((entry): entry is [string, RepoInfo] => entry[1] !== null))
}

/**
 * Each twin and the stone it stands beside.
 *
 * Shown stones are grouped by repository. A group of one is an ordinary stone. In a bigger group
 * the main checkout is the anchor, standing on its own place in the grove; every other checkout is
 * its twin and stands beside it. When the main checkout is not connected (only two worktrees are),
 * the first one connected anchors instead, so the stone you have had longest never moves.
 *
 * Pure, and shared by the node side (a twin takes no numbered place) and stone derivation.
 */
export function twinsOf(stones: { path: string; hidden?: boolean }[], repos: Map<string, RepoInfo>): Map<string, string> {
  const groups = new Map<string, string[]>()
  for (const stone of stones) {
    const repo = stone.hidden ? undefined : repos.get(stone.path)
    if (!repo) continue
    const group = groups.get(repo.common) ?? []
    group.push(stone.path)
    groups.set(repo.common, group)
  }
  const twins = new Map<string, string>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const anchor = group.find((folder) => !repos.get(folder)!.worktree) ?? group[0]!
    for (const folder of group) if (folder !== anchor) twins.set(folder, anchor)
  }
  return twins
}
