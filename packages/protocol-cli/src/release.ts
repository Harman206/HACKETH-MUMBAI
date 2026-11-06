import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { formatRelease } from '@copeybara/core';

export const sha256File = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');

/**
 * What a published kit must be: one self-contained HTML file with exactly one inline script, pinned by hash in a CSP
 * meta tag, and nothing loaded from anywhere else.
 */
export function kitProblems(html: string): string[] {
  const p: string[] = [];
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];
  if (scripts.length !== 1) p.push(`expected exactly one <script>, found ${scripts.length}`);
  if (scripts.some((s) => /\bsrc\s*=/i.test(s[1] ?? ''))) p.push('a <script> loads code from a URL');
  const m = /<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*content=(?:"([^"]*)"|'([^']*)')/i.exec(html);
  const csp = m?.[1] ?? m?.[2];
  if (!csp) p.push('no Content-Security-Policy meta tag');
  else if (!/script-src[^;]*'sha256-/.test(csp)) p.push('the CSP does not pin the script by hash');
  if (/<link\b[^>]*\bhref\s*=\s*["']?https?:/i.test(html)) p.push('a <link> loads a remote resource');
  if (/<(img|iframe|audio|video|source)\b[^>]*\bsrc\s*=\s*["']?https?:/i.test(html)) p.push('an element loads a remote resource');
  return p;
}

export async function kitRelease(file: string, version: number): Promise<{ sha256: string; record: string; problems: string[] }> {
  const html = await readFile(file, 'utf8');
  const sha256 = await sha256File(file);
  return { sha256, record: formatRelease({ sha256, version }), problems: kitProblems(html) };
}

export async function extensionRelease(file: string, version: number, tree?: string): Promise<{ sha256: string; record: string }> {
  const sha256 = await sha256File(file);
  return { sha256, record: formatRelease(tree ? { sha256, version, tree } : { sha256, version }) };
}
