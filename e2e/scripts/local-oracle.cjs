#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const crypto = require("crypto");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PATH = "/qa-release/api/v1/swap-rate";
const DEFAULT_SWAP_RATE = 2_000_000_000;

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      continue;
    }
    const key = item.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      args[key] = value;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
};

const args = parseArgs(process.argv.slice(2));

if (!args.keypair || !args.port) {
  console.error(
    "Usage: local-oracle.cjs --keypair <path> --port <port> [--host <host>] [--path <path>] [--swap-rate <int>]",
  );
  process.exit(1);
}

const keypairRaw = JSON.parse(fs.readFileSync(args.keypair, "utf8"));
if (!Array.isArray(keypairRaw) || keypairRaw.length < 64) {
  console.error(`Invalid keypair file: ${args.keypair}`);
  process.exit(1);
}

const host = String(args.host || DEFAULT_HOST);
const pathName = String(args.path || DEFAULT_PATH);
const port = Number(args.port);
const swapRate = Number(args["swap-rate"] || DEFAULT_SWAP_RATE);

if (!Number.isInteger(port) || port <= 0) {
  console.error(`Invalid port: ${args.port}`);
  process.exit(1);
}

if (!Number.isInteger(swapRate) || swapRate <= 0) {
  console.error(`Invalid swap rate: ${args["swap-rate"]}`);
  process.exit(1);
}

const privateKeySeed = Buffer.from(keypairRaw.slice(0, 32));
const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
const privateKeyDer = Buffer.concat([pkcs8Prefix, privateKeySeed]);
const privateKey = crypto.createPrivateKey({
  key: privateKeyDer,
  format: "der",
  type: "pkcs8",
});

const createPayload = () => {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = Buffer.from(`${swapRate}|${timestamp}`);
  const signature = crypto.sign(null, message, privateKey).toString("base64");
  return {
    swapRate,
    timestamp,
    signature,
  };
};

const server = http.createServer((req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  const requestPath = req.url ? req.url.split("?")[0] : "/";
  if (requestPath !== pathName) {
    if (requestPath === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const payload = createPayload();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
});

server.listen(port, host, () => {
  console.log(`Local oracle started on http://${host}:${port}${pathName}`);
});
