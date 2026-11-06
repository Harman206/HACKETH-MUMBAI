#!/usr/bin/env node
import { register as registerHooks } from 'node:module';
import { register } from 'tsx/esm/api';

register();
// After tsx, so these run first: a config outside the workspace can still import @copeybara/protocol-cli and core.
registerHooks(new URL('../src/resolve-hooks.mjs', import.meta.url));
await import('../src/main.ts');
