/**
 * Builds the org.copeybara.manifest record from the core codec, so selectors are exact.
 *   pnpm tsx tools/manifest/build.ts > config/manifest.json
 * Addresses: Uniswap v3 NPM and Uniswap v4 PositionManager + StateView (Sepolia + mainnet), Aave v3 Pool, Curve 3pool + 3CRV (mainnet).
 * v4 addresses checked on chain 2026-11-06: PositionManager.name() = "Uniswap v4 Positions NFT", and
 * PositionManager.poolManager() == StateView.poolManager() (Sepolia 0xE03A…3543, mainnet 0x0000…4444…8A90).
 * Verified on Etherscan / on chain before publishing (see docs/addresses.md).
 */
import { encodeManifest, EXIT_SELECTORS, type Manifest } from '../../packages/core/src/index';

const u = EXIT_SELECTORS['uniswap-v3'].positionManager;
const v4 = (positionManager: `0x${string}`, stateView: `0x${string}`) => ({
  positionManager: { address: positionManager, selectors: [...EXIT_SELECTORS['uniswap-v4'].positionManager] },
  stateView: { address: stateView, selectors: [] },
});
const manifest: Manifest = {
  v: 1,
  chains: {
    '11155111': {
      'uniswap-v3': { positionManager: { address: '0x1238536071E1c677A632429e3655c799b22cDA52', selectors: [...u] } },
      'uniswap-v4': v4('0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4', '0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C'),
    },
    '1': {
      'uniswap-v3': { positionManager: { address: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', selectors: [...u] } },
      'uniswap-v4': v4('0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e', '0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227'),
      'aave-v3': { pool: { address: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', selectors: [...EXIT_SELECTORS['aave-v3'].pool] } },
      'curve-3pool': {
        pool: { address: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7', selectors: [...EXIT_SELECTORS['curve-3pool'].pool] },
        lpToken: { address: '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490', selectors: [] },
      },
    },
  },
};

process.stdout.write(encodeManifest(manifest));
