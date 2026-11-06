/**
 * Print the org.copeybara.site record for a running site: every script it loads, hashed.
 *   pnpm tsx tools/site/fingerprint.ts http://demoswap.localhost:8080/
 * Publish the printed value with the Safe (contracts/script/WriteRecords.s.sol, SITE=…).
 */
import { formatSiteRecord } from '@copeybara/core';
import { fetchCodeItems } from '@copeybara/sitecheck';

const url = process.argv[2];
if (!url) {
  console.error('usage: tsx tools/site/fingerprint.ts <page url>');
  process.exit(2);
}
const items = await fetchCodeItems(url, (u) => fetch(u));
const bad = items.filter((i) => i.hash === null);
if (bad.length) {
  console.error(`could not read: ${bad.map((b) => b.label).join(', ')}`);
  process.exit(1);
}
for (const i of items) console.error(`${i.hash}  ${i.label}`);
console.log(formatSiteRecord(items.map((i) => i.hash!)));
