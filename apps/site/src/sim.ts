/**
 * Data for the product simulations on the landing and extension pages (the exit kit and the extension's side panel).
 * The kit's numbers are the last recorded Sepolia rescue (demo-runs/latest.json) and the published release
 * (contracts/deployments/sepolia.json). The panel's positions are a demo Sepolia wallet's Uniswap positions as the real
 * side panel listed them; its counters are illustrative.
 */
import run from '../../../demo-runs/latest.json';
import deployment from '../../../contracts/deployments/sepolia.json';
import { ENS_NAME } from './content';

export { ENS_NAME };
export const KIT_VERSION = (deployment as { kitReleaseVersion: number }).kitReleaseVersion;
export const KIT_SHA = (deployment as { kitRelease: string }).kitRelease;

/** "999.99 DETH + 999.99 DUSD" → [{ amount: '999.99', symbol: 'DETH' }, …] */
export function parseAmounts(s: string): { amount: string; symbol: string }[] {
  return s.split('+').map((p) => p.trim()).filter(Boolean).map((p) => {
    const [amount = '', symbol = ''] = p.split(/\s+/);
    return { amount, symbol };
  });
}

export const RESCUE = {
  recovered: run.recovered,
  amounts: parseAmounts(run.recovered),
  wallet: run.victim,
  tx: run.rescueTx,
};

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The hijacked-site story the panel tells; host is the demo protocol site. */
export const SITE_HOST = 'app.demoswap.xyz';
export const DRAINER_HOST = 'demoswap-rewards.xyz';

/** Wording from apps/extension/src/pages/api.ts siteText(). */
export const SITE_VERDICT = {
  ok: { title: `Verified ${ENS_NAME} site`, detail: 'Every script on this page is one the protocol published on ENS.' },
  bad: { title: 'Code does not match', detail: `1 script was not published by ${ENS_NAME}. Copeybara stopped the page.` },
} as const;

export const PANEL_POSITIONS = [
  { id: 'v3-234134', label: 'Uniswap v3 #234134 DETH/DUSD 0.3%', amounts: '1,000 DETH' },
  { id: 'v3-234135', label: 'Uniswap v3 #234135 DETH/DUSD 0.3%', amounts: '1,000 DETH + 1,000 DUSD' },
  { id: 'v4-41449', label: 'Uniswap v4 #41449 DETH/DUSD 0.3%', amounts: '54.8416 DETH' },
  { id: 'v4-41448', label: 'Uniswap v4 #41448 DETH/DUSD 0.3%', amounts: '29.553 DETH + 29.553 DUSD' },
];

/** The side panel's "What Copeybara did" tiles (labels from sidepanel.tsx), with illustrative counts. */
export type TileKey = 'verified' | 'mismatched' | 'pagesBlocked' | 'requestsChecked' | 'requestsBlocked';
export const TILES: { key: TileKey; label: string; tone: 'ok' | 'bad' | 'grey'; base: number }[] = [
  { key: 'verified', label: 'sites verified', tone: 'ok', base: 14 },
  { key: 'mismatched', label: 'hijacked pages stopped', tone: 'bad', base: 0 },
  { key: 'pagesBlocked', label: 'fake sites blocked', tone: 'bad', base: 2 },
  { key: 'requestsChecked', label: 'wallet requests checked', tone: 'grey', base: 37 },
  { key: 'requestsBlocked', label: 'drainer requests stopped', tone: 'bad', base: 1 },
];
