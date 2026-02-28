#!/bin/bash
# Placeholder entrypoint — will be replaced with `openfang start`
echo "AgentSquads tenant container starting..."
echo "TENANT_ID: ${TENANT_ID}"

# Start simple health server using Node.js
node -e "
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'healthy', tenant: process.env.TENANT_ID, uptime: process.uptime()}));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});
server.listen(4200, () => console.log('Health endpoint on :4200'));
" &

# Keep container alive
exec tail -f /dev/null
