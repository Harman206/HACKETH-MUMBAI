/**
 * Optional: Claude writes the incident note users see in the extension's warning page. It is given structured
 * facts only (protocol, kind, script URLs/labels), never page content, so a hijacked page cannot inject text into
 * the on-chain record. The watcher caps the result at 200 characters and falls back to a fixed note on any error.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { NoteFacts } from './watcher';

const client = new Anthropic();

export async function claudeNote(f: NoteFacts): Promise<string> {
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system:
      'You write one short warning for people who use a DeFi protocol, shown inside a browser-extension warning page and stored in an ENS text record. Plain words, no jargon, no markdown, under 180 characters. Say what is wrong and what to do: do not sign anything on the site; withdraw with the Copeybara exit kit.',
    messages: [{ role: 'user', content: `Facts (JSON):\n${JSON.stringify(f)}` }],
  });
  if (response.stop_reason === 'refusal') throw new Error('refused');
  const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(' ').trim();
  if (!text) throw new Error('empty note');
  return text;
}
