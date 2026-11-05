import { startRpcProxy } from './rpc-proxy';
await startRpcProxy({ upstream: process.env.PRIMARY_RPC! });
console.log('rpc-proxy up');
