/**
 * Builds the org.blackout.manifest record from the core codec, so selectors are exact.
 *   pnpm tsx tools/manifest/build.ts > config/manifest.json
 * Addresses: Uniswap v3 NPM (Sepolia + mainnet), Aave v3 Pool, Curve 3pool + 3CRV (mainnet).
 * Verified on Etherscan / on chain before publishing (see docs/addresses.md).
 */
import { encodeManifest, EXIT_SELECTORS, type Manifest } from '../../packages/core/src/index';

const u = EXIT_SELECTORS['uniswap-v3'].positionManager;
const manifest: Manifest = {
  v: 1,
  chains: {
    '11155111': {
      'uniswap-v3': { positionManager: { address: '0x1238536071E1c677A632429e3655c799b22cDA52', selectors: [...u] } },
    },
    '1': {
      'uniswap-v3': { positionManager: { address: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', selectors: [...u] } },
      'aave-v3': { pool: { address: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', selectors: [...EXIT_SELECTORS['aave-v3'].pool] } },
      'curve-3pool': {
        pool: { address: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7', selectors: [...EXIT_SELECTORS['curve-3pool'].pool] },
        lpToken: { address: '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490', selectors: [] },
      },
    },
  },
};

process.stdout.write(encodeManifest(manifest));
