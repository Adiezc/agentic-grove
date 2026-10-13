# Distribution notices

`npm run build` records modules from the three production bundles and generates
`dist/attribution/`. It includes package-root licence/NOTICE files, original licence and
copyright headers from bundled source, the vendored bot-crossing notice, Grove's licence and
the human account in `CREDITS.md`. The inventory uses lockfile versions, not a guessed list
of direct dependencies. No licence is downloaded during a build.

`scripts/package.mjs` also copies the installed Electron version's original Chromium HTML
notices. It verifies every generated document byte for byte inside the packaged app before
signing and after copying an installed/review app. Electron remains a runtime dependency even
though its built-in imports do not appear in the JavaScript bundle inventory.

To save a review app without replacing the installed one:

```sh
npm run app -- --output /absolute/path/to/a/new-review-directory
```

The destination app must not already exist. Normal `npm run app` and `npm run dmg` retain
their installation/disk-image behaviour. `npm run verify:attribution` exercises missing
licences, stale versions, source notices and packaged-file loss/corruption with temporary
fixtures. It does not use the user's Grove or provider data.

## Adding or upgrading upstream work

1. Review the exact release's code, asset scope, licence and NOTICE files before adopting it.
2. Add copied/ported source to `attribution.json` with upstream URL, exact revision, local
   destinations and original notice file. Retain source headers and explain modifications
   in `CREDITS.md`. The historical bot-crossing port predates revision tracking; its missing
   original revision is stated honestly rather than guessed.
3. Installed package notices normally come from the package itself. Only reviewed exceptions
   belong in `packageNotices`, keyed by exact `name@version` with a local notice and immutable
   upstream URL. An upgrade cannot automatically inherit an earlier exception. These records
   cover Fiber's omitted original licence and maath's incomplete upstream notice provenance.
4. Use `packageLicenceNotes` for a reviewed metadata/text mismatch, again keyed by exact
   version. A package's metadata does not supersede its actual licence text.
5. Run the build, attribution verification and packaging check. Inspect the app's Credits,
   Licences and Electron notices menu actions. Font and third-party assets need notices too.

This ledger records adopted work. The separate private research list is not a list of shipped
dependencies. A future new licence family or ambiguous grant still requires a review; finding
a file named LICENSE is not an automated legal compatibility decision.
