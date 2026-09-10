// IPC delivers the signal event on Windows, where kill() forcibly terminates Node.
process.on('message', (signal) => {
  process.emit(signal);
  process.disconnect();
});

if (process.argv[2] === 'stall-close') {
  const { createServer } = await import('../../dist/server.js');
  const { startMain } = await import('../../dist/main.js');
  const server = createServer();
  server.addHook('onClose', () => new Promise(() => {}));
  await startMain({ server });
} else {
  await import('../../dist/index.js');
}
if (process.exitCode) {
  process.disconnect();
} else {
  process.send('ready');
}
