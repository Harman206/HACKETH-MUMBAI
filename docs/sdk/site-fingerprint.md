# Site fingerprint

`org.copeybara.site` lists the sha256 of every script your official website may run. The Copeybara extension hashes the scripts a page actually runs and compares them with this list. Code you never published, such as a hijacked bundle or a swapped third-party script, makes the page fail the check and blocks its wallet requests. The watcher runs the same check from outside.

## Build plugins

The plugins fingerprint your production build. They never publish: the record is updated later by your Safe through `copeybara propose`.

**Vite**

```ts
// vite.config.ts
import { copeybara } from '@copeybara/vite-plugin';
export default defineConfig({ plugins: [copeybara({ ens: 'yourprotocol.eth' })] });
```

**Next.js**

```js
// next.config.mjs
import { withCopeybara } from '@copeybara/next-plugin';
export default withCopeybara({ /* your config */ }, { ens: 'yourprotocol.eth' });
```

The Next plugin hooks the client production compiler. App Router pages also run inline scripts that the compiler doesn't see: use `output: 'export'` and run `copeybara fingerprint --dist out` on the exported site.

**webpack**

```js
// webpack.config.js
import { CopeybaraWebpackPlugin } from '@copeybara/webpack-plugin';
export default { plugins: [new CopeybaraWebpackPlugin({ ens: 'yourprotocol.eth' })] };
```

### Options

| Option | Default | Meaning |
|---|---|---|
| `ens` | none | your ENS name: adds a diff against the live `org.copeybara.site` to the summary |
| `rpcs` | the kit's 3 Sepolia RPCs | RPCs for the ENS read |
| `failOnProblems` | `true` | an unpinned third-party script (or any other problem) fails the build |
| `writeWellKnown` | `true` | write `dist/.well-known/copeybara-site.json` |
| `log` | console | where the summary goes |

### What gets hashed

- every `.js` / `.mjs` file in the build output;
- every inline `<script>` and inline event handler in the HTML;
- every third-party `<script src>`: it **must** carry an `integrity` attribute that matches the bytes, otherwise the build fails. Self-host it, or pin it with SRI.

### Outputs

`dist/.well-known/copeybara-site.json` holds the record, every script with its hash and source, and the third-party list. On GitHub Actions the plugin also appends a job summary:

```text
### Copeybara site fingerprint · yourprotocol.eth

✓ 4 script hash(es)

Third-party scripts:
- pinned https://cdn.example/analytics.js

Differs from the published org.copeybara.site: +1 / -1. Run `copeybara propose` after deploying; the Safe signs the new record.
```

## CLI

```bash
pnpm copeybara fingerprint --dist dist                    # a build folder
pnpm copeybara fingerprint --url https://app.yourprotocol.xyz   # a deployed page
```

Both write `.copeybara/site.txt`, which `copeybara propose` picks up. Both fail on an unpinned third-party script.

## Record format

```text
v=2;sha256=<hash>,<hash>,…
```

The hashes are sorted lowercase hex and deduplicated. The older single-hash form `sha256:<hash>` is still read.

## Deploy flow

1. Build: the plugin fingerprints and, with `ens`, shows the diff in CI.
2. Deploy the site.
3. `pnpm copeybara fingerprint --dist dist && pnpm copeybara propose`; the Safe signs the new `org.copeybara.site`.

Between steps 2 and 3, extensions see code that is not yet published and warn about it. Propose the record as part of every release.
