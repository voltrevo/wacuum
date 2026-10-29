// Drive a running wacuum over HTTP the way a consensus client would, from one engine fixture: write the
// fixture's pre-state as a geth genesis.json, start `wacuum` on it, then send each payload with a fresh
// HS256 JWT and check every answer — and that a request without a token is refused. Then stop it, start it
// again on the same data directory, and check the state it replayed against the fixture's post-state.
//
//     WAC=path/to/native/wac node tools/engine-e2e.mjs FIXTURE.json [TEST-NAME-SUBSTRING]
//
// It needs a `wac` on a native host: on the JavaScript hosts a program is given no network.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [file, filter = ""] = process.argv.slice(2);
const doc = JSON.parse(readFileSync(file, "utf8"));
const name = Object.keys(doc).find((k) => k.includes(filter));
const t = doc[name];
const g = t.genesisBlockHeader;
const fork = t.network;
const dir = mkdtempSync(join(tmpdir(), "wacuum-e2e-"));
const genesis = {
  config: { chainId: parseInt(t.config.chainid, 16), cancunTime: 0, ...(fork !== "Cancun" ? { pragueTime: 0 } : {}),
            ...(fork === "Osaka" ? { osakaTime: 0 } : {}) },
  alloc: t.pre, coinbase: g.coinbase, difficulty: g.difficulty, extraData: g.extraData, gasLimit: g.gasLimit,
  nonce: g.nonce, mixHash: g.mixHash, timestamp: g.timestamp, parentHash: g.parentHash, number: g.number,
  baseFeePerGas: g.baseFeePerGas, excessBlobGas: g.excessBlobGas, blobGasUsed: g.blobGasUsed,
};
const secret = randomBytes(32);
writeFileSync(join(dir, "genesis.json"), JSON.stringify(genesis));
writeFileSync(join(dir, "jwt.hex"), secret.toString("hex") + "\n");
const port = 18551 + Math.floor(Math.random() * 1000);

let node, out;
const until = async (f) => { for (let i = 0; i < 600 && !f(); i++) await new Promise((r) => setTimeout(r, 100)); };
const start = async () => {
  out = "";
  node = spawn(process.env.WAC ?? "wac", ["run", "--allow-read", "--allow-write", "--allow-net", "cmd/wacuum.wac", "--",
    "--genesis", join(dir, "genesis.json"), "--jwt-secret", join(dir, "jwt.hex"), "--datadir", join(dir, "data"),
    "--port", String(port)]);
  node.stdout.on("data", (d) => { out += d; process.stdout.write("  wacuum| " + d); });
  node.stderr.on("data", (d) => process.stdout.write("  wacuum! " + d));
  await until(() => out.includes("Engine API on"));
};
await start();
if (!out.includes(`genesis ${g.hash}`)) { console.log(`FAIL genesis hash: want ${g.hash}`); node.kill(); process.exit(1); }

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = () => {
  const s = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ iat: Math.floor(Date.now() / 1000) });
  return s + "." + createHmac("sha256", secret).update(s).digest("base64url");
};
let id = 0;
const rpc = async (method, params, token = jwt()) => {
  const res = await fetch(`http://127.0.0.1:${port}`, {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  return { http: res.status, body: await res.json() };
};

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };
check((await rpc("eth_chainId", [], null)).http === 401, "a request without a token is refused");
check((await rpc("eth_chainId", [], "a.b.c")).http === 401, "a request with a bad token is refused");
for (const [i, p] of t.engineNewPayloads.entries()) {
  const r = await rpc(`engine_newPayloadV${p.newPayloadVersion}`, p.params);
  const st = r.body.result?.status ?? `error ${r.body.error?.code}`;
  const want = p.errorCode ? `error ${p.errorCode}` : p.validationError ? "INVALID" : "VALID";
  check(st === want, `payload ${i + 1}: ${st}${want !== st ? `, want ${want}` : ""}`);
  if (want === "VALID") {
    const h = p.params[0].blockHash;
    const f = await rpc(`engine_forkchoiceUpdatedV${p.forkchoiceUpdatedVersion}`,
      [{ headBlockHash: h, safeBlockHash: h, finalizedBlockHash: "0x" + "00".repeat(32) }, null]);
    check(f.body.result?.payloadStatus?.status === "VALID", `forkchoice to payload ${i + 1}`);
  }
}
// Stop it, and start it again on what it wrote: everything below is answered from the replayed log.
const exited = new Promise((r) => node.on("exit", r));
node.kill();
await exited;
await start();
check(out.includes("replayed"), "the restarted node replayed its log");
const last = t.engineNewPayloads.filter((p) => !p.validationError && !p.errorCode).at(-1);
const n = (await rpc("eth_blockNumber", [])).body.result;
check(!last || n === last.params[0].blockNumber, `eth_blockNumber is ${n}`);
// The state reads, against the fixture's post-state.
const norm = (h) => "0x" + (BigInt(h || "0x0").toString(16));
for (const [addr, acct] of Object.entries(t.postState ?? {})) {
  const bal = (await rpc("eth_getBalance", [addr, "latest"])).body.result;
  const nonce = (await rpc("eth_getTransactionCount", [addr, "latest"])).body.result;
  const code = (await rpc("eth_getCode", [addr, "latest"])).body.result;
  let ok = norm(bal) === norm(acct.balance) && norm(nonce) === norm(acct.nonce) && code === acct.code;
  for (const [k, v] of Object.entries(acct.storage)) {
    ok &&= norm((await rpc("eth_getStorageAt", [addr, k, "latest"])).body.result) === norm(v);
  }
  check(ok, `state of ${addr}`);
}
node.kill();
console.log(failed ? `${failed} failed` : "all ok");
process.exit(failed ? 1 : 0);
