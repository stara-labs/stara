import { createServer } from '../../dist/server.js';
import { startMain } from '../../dist/main.js';

process.on('message', (signal) => {
  process.emit(signal);
  process.disconnect();
});

const server = createServer();
server.addHook('onRequest', (_request, _reply, done) => {
  if (process.connected) process.send({ event: 'request_started' });
  done();
});
const running = await startMain({ server });
if (running) {
  process.send({
    event: 'ready',
    primary: server.server.address(),
    addresses: server.addresses(),
  });
} else {
  process.disconnect();
}
