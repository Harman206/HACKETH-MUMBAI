import { startHijack } from './hijack';
await startHijack({ kitFile: process.env.KIT_FILE!, token: process.env.HIJACK_TOKEN as `0x${string}` });
console.log('hijack up');
