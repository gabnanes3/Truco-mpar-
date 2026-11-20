// A local PeerJS broker, run as a child process by servidores.js: the `peer` package keeps timers alive for
// as long as its process lives, so it gets a process of its own that is simply killed at the end.
//   node servidores-peer.mjs <port> <path>   → prints {"port": N} once it is listening (port 0 = any free one)
// (.mjs keeps this file out of `npm run typecheck`: the typings of `peer` pull untyped JavaScript from
// node_modules into the program.)

import { PeerServer } from 'peer';

const port = Number(process.argv[2] ?? 0);
const path = process.argv[3] ?? '/';

// The broker tells a caller that a peer does not exist only after `expire_timeout`: one second keeps "room
// not found" quick in tests (the public broker takes about five).
PeerServer({ host: '127.0.0.1', port, path, expire_timeout: 1000, cleanup_out_msgs: 250 }, (server) => {
  const address = server.address();
  process.stdout.write(`${JSON.stringify({ port: typeof address === 'object' && address !== null ? address.port : port })}\n`);
});

// The parent holds our stdin: when it goes away, whatever the reason, so do we.
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
