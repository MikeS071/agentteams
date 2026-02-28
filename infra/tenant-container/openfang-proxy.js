const http = require("http");

const upstreamHost = "127.0.0.1";
const upstreamPort = 4201;

function proxyRequest(req, res, pathOverride) {
  const upstreamReq = http.request(
    {
      hostname: upstreamHost,
      port: upstreamPort,
      method: req.method,
      path: pathOverride || req.url,
      headers: {
        ...req.headers,
        host: `${upstreamHost}:${upstreamPort}`,
      },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on("error", () => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "openfang upstream unavailable" }));
  });

  req.pipe(upstreamReq);
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    proxyRequest(req, res, "/api/health");
    return;
  }

  proxyRequest(req, res);
});

server.listen(4200, "0.0.0.0", () => {
  console.log("OpenFang proxy listening on :4200 (upstream :4201)");
});
