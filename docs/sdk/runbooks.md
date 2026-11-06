# Runbooks

## Release a new kit

1. **Build reproducibly:** `SOURCE_DATE_EPOCH=0 pnpm --filter @copeybara/kit build`. Copy `apps/kit/dist/copeybara-kit.html` to `kit.file` and raise `kit.version`.
2. **Check it:** `pnpm copeybara release`. It refuses a kit with more than one script, no CSP hash or any remote resource.
3. **Prove it:** `pnpm copeybara drill`.
4. **Propose:** `pnpm copeybara propose`. Owners review `release` in the Transaction Builder and sign.
5. **Host it** next to the widget on your site, then confirm: `pnpm copeybara verify` and `scripts/verify-kit.sh <kit.html> <name>`.

Until the Safe signs, the hosted kit and the record disagree, and users who check will (correctly) refuse the new file. Host the file only after the record is live, or keep the previous file up until then.

## Change exit contracts

1. Edit `chains` (and `exits`) in the config.
2. `pnpm copeybara manifest --onchain` to check selectors against deployed bytecode.
3. `pnpm copeybara drill`, then `pnpm copeybara propose`.

Removing a contract from the manifest stops new kit sessions from exiting it. Keep old contracts listed while users still hold positions there.

## Website deploy

1. Build with the [fingerprint plugin](site-fingerprint.md); fix any unpinned third-party script.
2. Deploy.
3. `pnpm copeybara fingerprint --dist dist && pnpm copeybara propose`, and the Safe signs `org.copeybara.site`.

## Incident: your website is hijacked

1. **Tell users:** "Do not use the website. Open the exit kit you saved and check it against `<name>`."
2. **Raise the status** (the watcher may already have):

   ```bash
   pnpm copeybara incident --state compromised --note "Website hijacked: use the exit kit" --block app-yourprotocol.xyz
   ```

   Owners sign `.copeybara/incident-batch.json`. Extensions that follow your name block the site before it loads.
3. **Do not change `url`, the release or the manifest in a panic.** Exits keep working from the records already published, and the batch above cannot touch them.
4. **Recover the website,** redeploy, re-fingerprint and propose `org.copeybara.site`.
5. **Clear:** `pnpm copeybara incident --state ok`. The watcher never clears a status your Safe set.

## Incident: a key leaks

- **Website key:** it can only change `url`, which extensions check against your site fingerprint. Revoke its role through the Safe and grant a new key.
- **Watcher key:** it can only raise or clear warnings. Revoke it with `contracts/script/watcher-role.sh revoke`, rotate `WATCHER_KEY`, update `watcher.key`, and run `pnpm copeybara propose` to grant the new key.
- **A Safe owner key:** rotate the owner through the Safe immediately. Below the threshold, a single key can't publish anything.

## Incident: an RPC lies or goes down

Nothing to do. The kit needs 2 of 3 RPCs to answer and agree, and stops rather than guessing. Users can add their own RPCs in the kit's settings.
