// The live Sepolia demo (demoswap-blackout.eth) described as a protocol team would describe theirs.
//   pnpm copeybara verify --config examples/demoswap/copeybara.config.ts
// The kit file is the released one: curl -o examples/demoswap/copeybara-kit.html https://blackout-red.vercel.app/copeybara-kit.html
import { defineConfig } from '@copeybara/protocol-cli';

export default defineConfig({
  name: 'demoswap-blackout.eth',
  safe: '0x3ae03951044Ced07F7fa12072CfE7F95827A057F',
  resolver: '0x642cD108b4EA8cb1e7617213533FfE1AcE8BDE82',
  websiteKey: '0xA2f199fEd2Fecf201422C71e1E53C76Fd6f4d182',
  watcher: { key: '0xeBbcD4fC4265dbb7Fc7b2df00f1fD7B89FA1EfF8', candidates: [] },

  kit: { file: 'copeybara-kit.html', version: 8 },

  chains: {
    '1': {
      'aave-v3': { pool: { address: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', functions: ['withdraw(address,uint256,address)'] } },
      'curve-3pool': {
        lpToken: { address: '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490' },
        pool: { address: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7', functions: ['remove_liquidity(uint256,uint256[3])'] },
      },
      'uniswap-v3': {
        positionManager: {
          address: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
          functions: ['multicall(bytes[])', 'decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))', 'collect((uint256,address,uint128,uint128))'],
        },
      },
      'uniswap-v4': {
        positionManager: { address: '0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e', functions: ['modifyLiquidities(bytes,uint256)'] },
        stateView: { address: '0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227' },
      },
    },
    '11155111': {
      'uniswap-v3': {
        positionManager: {
          address: '0x1238536071E1c677A632429e3655c799b22cDA52',
          functions: ['multicall(bytes[])', 'decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))', 'collect((uint256,address,uint128,uint128))'],
        },
      },
      'uniswap-v4': {
        positionManager: { address: '0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4', functions: ['modifyLiquidities(bytes,uint256)'] },
        stateView: { address: '0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C' },
      },
    },
  },
});
