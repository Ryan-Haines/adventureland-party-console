import path from 'node:path';
import { startProdServer } from '../../dashboard/node_modules/vinext/dist/server/prod-server.js';

// Packaged deployments need no Cloudflare bindings. Native Node also supports
// Pi kernels whose virtual address space cannot run workerd's allocator.
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535 || !process.argv[3])
  throw new Error('Usage: node node-server.mts <port> <build-directory>');
await startProdServer({ port, host: '127.0.0.1', outDir: path.resolve(process.argv[3]) });
