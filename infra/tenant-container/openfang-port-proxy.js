const http = require("http");

const TARGET_HOST = "127.0.0.1";
const TARGET_PORT = 4201;
const LISTEN_PORT = 4200;

const server = http.createServer((req, res) => {
  const upstreamPath = req.url === "/healthz" ? "/api/health" : req.url;
  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: upstreamPath,
    method: req.method,
    headers: { ...req.headers, host: `${TARGET_HOST}:${TARGET_PORT}` },
  };

  const upstream = http.request(options, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on("error", () => {
    res.statusCode = 502;
    res.end("Bad Gateway");
  });

  req.pipe(upstream);
});

server.listen(LISTEN_PORT, "0.0.0.0");
