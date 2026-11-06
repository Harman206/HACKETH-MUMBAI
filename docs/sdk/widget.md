# Widget

`<copeybara-exit>` tells your users where the verified exit kit is and how to check it. It is one hand-written, dependency-free file (`packages/widget/copeybara-exit.js`, about 6.6 kB) that you host yourself.

```html
<script src="/copeybara-exit.js"></script>
<copeybara-exit
  ens="yourprotocol.eth"
  kit="/copeybara-kit.html"
  sha256="<kit sha256 from your release record>"
  extension="/copeybara-extension-chrome.zip"
  extension-sha256="<zip sha256>"
  certified></copeybara-exit>
```

## Attributes

| Attribute | Required | Meaning |
|---|---|---|
| `ens` | yes | your ENS name (lowercase `*.eth`); anything else renders an error instead of a card |
| `kit` | no | where you host the kit; default `copeybara-kit.html` next to the page. `http(s)` only |
| `sha256` | no | the kit's sha256 as your site states it, shown for users to compare |
| `extension` | no | the extension zip URL; adds a download button. `http(s)` only |
| `extension-sha256` | no | the zip's sha256 |
| `certified` | no | adds a link to your live check on the Copeybara site (`https://blackout-red.vercel.app/#/certified/<ens>`) |

Attributes can change after the element renders; it re-renders.

## What it shows

- download buttons for the kit (and extension);
- your ENS name and the sha256 values;
- the commands to check a download: `sha256sum`, `shasum -a 256`, and `scripts/verify-kit.sh <file> <ens>`, which reads the release through three RPCs;
- this sentence, always: **"Verify this file against <ens> before you use it. This website cannot vouch for itself."**
- with `certified`: a link to the live check, and the note that a badge on your page proves nothing.

## What it never does

It makes no network request, never touches `window.ethereum` or any wallet, never reads balances or builds transactions, never sets cookies or uses storage, and never inserts HTML: all text is set as text inside a shadow root. A Playwright test loads it under a strict CSP with a recording wallet and checks for 0 third-party requests, 0 wallet calls, no cookies and empty storage.

It also never draws a certified tick itself. A tick drawn by your own page would be worth nothing to a user whose page was hijacked; the link sends them to a check that reads ENS independently.

## Hosting it

- Serve the file from your own origin. It works under `script-src 'self'`; it uses constructable stylesheets and falls back to a `<style>` element in the shadow root.
- Its sha256 is published next to it in `copeybara-exit.js.sha256`. Because it is one of your site's scripts, it is included in your `org.copeybara.site` fingerprint automatically.
- If you edit it, run `pnpm --filter @copeybara/widget hash` to update the sidecar.
