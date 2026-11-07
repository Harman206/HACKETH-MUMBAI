# Prompts and planning artifacts

ETHGlobal asks teams that use a spec-driven workflow to include their spec files, prompts and planning artifacts. They are listed below. What the team did and where AI was used: [../../ai-use.md](../../ai-use.md).

## Prompts (Claude Code, Harman's laptop)

Exported verbatim from the Claude Code session logs on this machine, in order, with times in IST. Removed: tool output, shell output, background-task notifications, and the automatic context summaries Claude Code writes when a conversation is compacted (those are AI output, not prompts). Screenshots the team pasted appear as `[Image #n]`; the images are not included.

| File | Session | Prompts |
|---|---|---|
| [01-main-build.md](01-main-build.md) | the main build: kit, guard, quorum, ENS, contracts, replays, extension, watcher, site, demo (6 Nov 03:25 → 7 Nov 05:39) | 68 |
| [02-partner-tracks.md](02-partner-tracks.md) | partner-track research (6 Nov) | 3 |
| [03-submission-prep.md](03-submission-prep.md) | README positioning, demo-video script, rules check (7 Nov) | 6 |

## Spec and plans (in the repo)

- PRD: [`docs/spec/BLACKOUT-technical-PRD.txt`](../../spec/BLACKOUT-technical-PRD.txt), drafted with Claude (Claude Docs) from the team's idea, 6 Nov 03:24 IST.
- Implementation plans: [`docs/superpowers/plans/`](../../superpowers/plans/2026-11-06-blackout.md) (core build, product finish, extension, usability and depth).
- Design specs: [`docs/superpowers/specs/`](../../superpowers/specs/2026-11-06-copeybara-extension-design.md) (product finish, extension).
- Standing instructions for the coding assistant: [`CLAUDE.md`](../../../CLAUDE.md).

## Not in this folder yet

- The claude.ai conversation in which the PRD was drafted. The PRD itself lives in Claude Docs ("BLACKOUT — Technical PRD", exported as .docx on 6 Nov 03:24 IST); its exported text is the file above.
- The prompts from the second laptop (Divyam's commits: landing page, protocol SDK and CLI, build plugins, widget, certify directory, integration guide).
