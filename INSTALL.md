# Installing Agentic Grove

Written for two readers: you, and the AI coding agent you might hand this to. If you already use
Claude Code or Codex, the quickest way to install the Grove is to ask it to:

> Install Agentic Grove for me by following https://github.com/Adiezc/agentic-grove/blob/main/INSTALL.md

It will read this page and do the steps below. Nothing here needs your password, and nothing
here signs you in to anything.

## For the agent doing the install

Follow these steps in order. Stop and tell the person if any check fails; do not work around it.

1. **Check the Mac.** `uname -sm` must print `Darwin arm64`. The Grove runs on Apple Silicon Macs
   only for now.
2. **Check Node.** `node -v` must be 22 or newer. If Node is missing or older, tell the person
   and suggest `brew install node` (if `brew` exists) or https://nodejs.org. Do not install it
   without asking.
3. **Get the code.** Into `~/Developer/agentic-grove`, unless the person names another place:
   `git clone https://github.com/Adiezc/agentic-grove.git ~/Developer/agentic-grove`. If that
   folder already exists and is this repository, run `git pull` in it instead.
4. **Install and build.** In that folder: `npm ci`, then `npm run app`. The second command builds
   the app and puts it in `~/Applications/Agentic Grove.app`. It takes a minute or two and
   downloads Electron once.
5. **Open it.** `open ~/Applications/"Agentic Grove.app"`. Because it was built on this Mac, macOS
   opens it without the "Open Anyway" step a downloaded copy needs.
6. **Hand over.** Tell the person the Grove is open and that its first card has one button,
   **Get ready**, which finds Claude Code and Codex, signs them in if needed, and turns on live
   updates. That part is theirs: signing in happens in their browser.

Do **not** edit `~/.claude/settings.json`, `~/.codex`, or `~/.agentic-grove` yourself. The Grove
changes Claude Code's settings only when the person presses its button, and keeps a backup.

## Updating

Run step 3's `git pull` and step 4 again. Projects, agents and settings live in `~/.agentic-grove`,
outside the app, so they are kept.

## By hand, from a download

See "Installing a download" in the [README](README.md#installing-a-download).
