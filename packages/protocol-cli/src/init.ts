export const INIT_TEMPLATE = `import { defineConfig } from '@copeybara/protocol-cli';
import { erc4626Kind } from '@copeybara/core';

export default defineConfig({
  name: 'yourprotocol.eth',
  // The Safe that owns the name. Every record write is a batch proposed to it; the CLI never signs.
  safe: '0x0000000000000000000000000000000000000000',
  resolver: '0x0000000000000000000000000000000000000000', // the name's PermissionedResolver
  websiteKey: '0x0000000000000000000000000000000000000000', // may write \`url\` only
  watcher: { key: '0x0000000000000000000000000000000000000000', candidates: [] }, // status + blocklist only

  kit: { file: 'copeybara-kit.html', version: 1 }, // SOURCE_DATE_EPOCH=0 pnpm --filter @copeybara/kit build
  site: { url: 'https://app.yourprotocol.xyz', dist: 'dist' },

  // Exit contracts per chain. Built-in adapters: uniswap-v3, uniswap-v4, aave-v3, curve-3pool.
  // Your own contracts: adapter "spec", one role per entry in \`exits\` below.
  chains: {
    '1': {
      spec: {
        vault: { address: '0x0000000000000000000000000000000000000000', functions: ['redeem(uint256,address,address)'], abi: 'out/Vault.sol/Vault.json' },
      },
    },
  },
  // Declarative exits (org.copeybara.exits): how the kit finds a user's position and exits it, with no adapter code.
  exits: { vault: erc4626Kind('Your vault') },
});
`;
