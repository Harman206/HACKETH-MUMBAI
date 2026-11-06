/**
 * "Build proof" card data for the extension pages: asks the worker to hash the installed files and compare them
 * with the followed protocol's org.copeybara.extension record. Rendering is up to the page.
 */
import type { BuildProof } from '../shared/buildproof';

export type { BuildProof, BuildProofVerdict } from '../shared/buildproof';

declare const chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } };

export type BuildProofResult = BuildProof | { error: string };

export const getBuildProof = () => chrome.runtime.sendMessage({ t: 'buildProof' }) as Promise<BuildProofResult>;

export interface BuildProofView {
  tone: 'ok' | 'warn' | 'bad' | 'grey';
  title: string;
  detail: string;
  /** label/value rows for a details list; hashes are full 64-char hex (shorten for display if needed) */
  rows: { label: string; value: string }[];
}

export function formatBuildProof(r: BuildProofResult): BuildProofView {
  if ('error' in r) return { tone: 'warn', title: 'Could not check this build', detail: r.error, rows: [] };
  const rows = [
    { label: 'Version', value: r.version },
    { label: 'Files hashed', value: String(r.files) },
    { label: 'Tree hash', value: r.treeHash },
  ];
  if (r.ens) {
    rows.push({ label: 'ENS record', value: `${r.ens.name} v${r.ens.version}` });
    if (r.ens.tree) rows.push({ label: 'Published tree', value: r.ens.tree });
    rows.push({ label: 'Published zip', value: r.ens.zip });
  }
  switch (r.verdict) {
    case 'match':
      return { tone: 'ok', title: 'Matches the published build', detail: `Every installed file hashes to the tree ${r.ens!.name} published on ENS (v${r.ens!.version}).`, rows };
    case 'mismatch':
      return { tone: 'bad', title: 'Does not match the published build', detail: `The installed files differ from the build ${r.ens!.name} published (v${r.ens!.version}). Reinstall from the published zip and check it with scripts/verify-extension.sh.`, rows };
    case 'old-record':
      return { tone: 'grey', title: 'Published record has no tree hash', detail: `${r.ens!.name} published only the zip hash (v${r.ens!.version}). Check the zip with scripts/verify-extension.sh.`, rows };
    case 'local-audio':
      return { tone: 'grey', title: 'Local build with your own audio', detail: `Apart from your own song under audio/, every installed file hashes to the tree ${r.ens!.name} published on ENS (v${r.ens!.version}). Published builds never include audio.`, rows };
    case 'no-record':
      return { tone: 'grey', title: 'No ENS record to compare', detail: 'None of the protocols you follow publishes an extension build.', rows };
  }
}
