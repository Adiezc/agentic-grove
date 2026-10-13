/** Read-only provider observation can use a disposable home without changing OS/tool homes. */
import os from 'node:os'
import path from 'node:path'

export function observationPaths(env: NodeJS.ProcessEnv = process.env, userHome = os.homedir()) {
  const fixture = env.AGENTIC_GROVE_PROVIDER_HOME
  if (fixture !== undefined) {
    // A typo must not fall back to the user's sessions. Keep Grove's own writes separate too.
    if (!path.isAbsolute(fixture) || !env.AGENTIC_GROVE_HOME || !path.isAbsolute(env.AGENTIC_GROVE_HOME)) {
      throw new Error('AGENTIC_GROVE_PROVIDER_HOME requires absolute provider and AGENTIC_GROVE_HOME paths')
    }
    const home = path.resolve(fixture)
    if (home === path.resolve(userHome)) throw new Error('The provider fixture home must differ from the real user home')
    const grove = path.resolve(env.AGENTIC_GROVE_HOME)
    if (grove === home || grove.startsWith(`${home}${path.sep}`) || home.startsWith(`${grove}${path.sep}`)) {
      throw new Error('Provider fixtures and Grove storage must be separate folders')
    }
    return { home, codex: path.join(home, '.codex') }
  }
  return { home: userHome, codex: env.CODEX_HOME || path.join(userHome, '.codex') }
}
