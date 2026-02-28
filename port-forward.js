const net = require('net');
net.createServer(client => {
  const server = net.connect(3005, '127.0.0.1');
  client.pipe(server);
  server.pipe(client);
  server.on('error', () => client.destroy());
  client.on('error', () => server.destroy());
}).listen(3006, '127.0.0.1', () => console.log('Forwarding :3006 → :3005'));
