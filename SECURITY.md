# Security

## Reporting a problem

If you find a security problem in Agentic Grove, please report it privately rather than in a
public issue, so it can be fixed before anyone else knows about it.

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe what you found and, if you can, the steps to reproduce it.

Only the maintainer sees the report. You will get a reply there, and the fix and any public notice
are worked out with you in the same place. You will be credited unless you would rather not be.

This is a one-person project, so please allow a week or so for a first reply.

## Which versions

Only the newest release is fixed. Updates are downloaded from
[Releases](https://github.com/Adiezc/agentic-grove/releases) and replace the app in place; your
grove is kept.

## What counts

Anything that lets a web page, a project folder, a transcript or another program make the Grove:

- read or change files it should not,
- run programs or code it should not,
- send anything over the network beyond the update check and the Claude limits check described in
  the README,
- or write to another tool's session data.

How the app is locked down, and the check that keeps it so (`npm run verify:security`), is in
`electron/security.ts`.
