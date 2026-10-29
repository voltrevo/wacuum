// wacuum and geth on one devnet, over devp2p. Each has its own consensus client — this script, playing one
// for each — and they must agree:
//
//   1. geth makes blocks; wacuum, told of geth's head, syncs them from geth over the network.
//   2. A transaction sent to wacuum reaches geth's pool, and one sent to geth reaches wacuum's.
//   3. wacuum makes blocks; geth, told of wacuum's head, syncs them from wacuum, and both end on the same
//      state root.
//
//     GETH=path/to/geth ETHERS=path/to/node_modules/ethers WAC=path/to/native/wac node tools/devnet-e2e.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ethers = await import(join(process.env.ETHERS ?? "node_modules/ethers", "lib.esm/index.js"));
const GETH = process.env.GETH ?? "geth";
const dir = mkdtempSync(join(tmpdir(), "wacuum-devnet-"));
const key = "0x" + "11".repeat(32);
const kit = readFileSync(new URL("../test/chainkit.wac", import.meta.url), "utf8");
const code = (name) => kit.match(new RegExp(`static string ${name} = "(0x[0-9a-f]+)"`))[1];
const genesis = {
  config: { chainId: 1337, homesteadBlock: 0, eip150Block: 0, eip155Block: 0, eip158Block: 0, byzantiumBlock: 0,
            constantinopleBlock: 0, petersburgBlock: 0, istanbulBlock: 0, berlinBlock: 0, londonBlock: 0, mergeNetsplitBlock: 0,
            terminalTotalDifficulty: 0, shanghaiTime: 0, cancunTime: 0, pragueTime: 0,
            depositContractAddress: "0x" + "00".repeat(20),
            blobSchedule: { cancun: { target: 3, max: 6, baseFeeUpdateFraction: 3338477 },
                            prague: { target: 6, max: 9, baseFeeUpdateFraction: 5007716 } } },
  nonce: "0x0", timestamp: "0x0", extraData: "0x", gasLimit: "0x1c9c380", difficulty: "0x0", mixHash: "0x" + "00".repeat(32),
  coinbase: "0x" + "00".repeat(20), number: "0x0", gasUsed: "0x0", parentHash: "0x" + "00".repeat(32), baseFeePerGas: "0x3b9aca00",
  excessBlobGas: "0x0", blobGasUsed: "0x0",
  alloc: {
    [new ethers.Wallet(key).address]: { balance: "0x56bc75e2d63100000" },
    "0x00000961ef480eb55e80d19ad83579a64c007002": { nonce: "0x1", code: code("WITHDRAWALS"), balance: "0x0" },
    "0x0000bbddc7ce488642fb579f8b00f3a590007251": { nonce: "0x1", code: code("CONSOLIDATIONS"), balance: "0x0" },
    "0x0000f90827f1c53a10cb7a02335b175320002935": { nonce: "0x1", code: code("HISTORY"), balance: "0x0" },
    "0x000f3df6d732807ef1319fb7b8bb8522d0beac02": { nonce: "0x1", code: code("BEACON_ROOTS"), balance: "0x0" },
  },
};
writeFileSync(join(dir, "genesis.json"), JSON.stringify(genesis));
const secret = randomBytes(32);
writeFileSync(join(dir, "jwt.hex"), secret.toString("hex"));
const base = 20000 + Math.floor(Math.random() * 20000);
const ports = { gethP2p: base, gethAuth: base + 1, gethRpc: base + 2, wacP2p: base + 3, wac: base + 4 };

const procs = [];
const start = (name, cmd, args) => {
  const p = spawn(cmd, args);
  let out = "";
  p.stdout.on("data", (d) => { out += d; });
  p.stderr.on("data", (d) => { out += d; });
  procs.push(p);
  return { p, log: () => out };
};
const until = async (f, ms = 60000) => {
  for (let t = 0; t < ms; t += 200) { if (await f()) return true; await new Promise((r) => setTimeout(r, 200)); }
  return false;
};

execFileSync(GETH, ["--datadir", join(dir, "geth"), "init", join(dir, "genesis.json")], { stdio: "ignore" });
const geth = start("geth", GETH, ["--datadir", join(dir, "geth"), "--networkid", "1337", "--nodiscover", "--port", String(ports.gethP2p),
  "--authrpc.port", String(ports.gethAuth), "--authrpc.jwtsecret", join(dir, "jwt.hex"), "--http", "--http.port", String(ports.gethRpc),
  "--http.api", "eth,admin,net,txpool", "--syncmode", "full"]);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = () => {
  const s = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ iat: Math.floor(Date.now() / 1000) });
  return s + "." + createHmac("sha256", secret).update(s).digest("base64url");
};
const call = async (port, method, params, auth = false) => {
  const r = await (await fetch(`http://127.0.0.1:${port}`, { method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${jwt()}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
  if (r.error) throw new Error(`${method}: ${r.error.message}`);
  return r.result;
};
const zero = "0x" + "00".repeat(32);
const choose = (auth, head) => call(auth, "engine_forkchoiceUpdatedV3",
  [{ headBlockHash: head, safeBlockHash: head, finalizedBlockHash: zero }, null], true);
/** Be the consensus client of the client at (auth, rpc): `n` blocks, a transfer from `wallet` in each. */
const makeBlocks = async (auth, rpc, n) => {
  const wallet = new ethers.Wallet(key, new ethers.JsonRpcProvider(`http://127.0.0.1:${rpc}`, 1337, { staticNetwork: true }));
  let head = await call(rpc, "eth_getBlockByNumber", ["latest", false]);
  for (let i = 0; i < n; i++) {
    await wallet.sendTransaction({ to: "0x" + "22".repeat(20), value: 1000n + BigInt(i) });
    const attrs = { timestamp: "0x" + (parseInt(head.timestamp, 16) + 12).toString(16), prevRandao: zero,
                    suggestedFeeRecipient: "0x" + "00".repeat(19) + "fe", withdrawals: [], parentBeaconBlockRoot: zero };
    const { payloadId } = await call(auth, "engine_forkchoiceUpdatedV3",
      [{ headBlockHash: head.hash, safeBlockHash: head.hash, finalizedBlockHash: zero }, attrs], true);
    await new Promise((r) => setTimeout(r, 300));
    const p = await call(auth, "engine_getPayloadV4", [payloadId], true);
    await call(auth, "engine_newPayloadV4", [p.executionPayload, [], zero, p.executionRequests], true);
    await choose(auth, p.executionPayload.blockHash);
    head = await call(rpc, "eth_getBlockByNumber", ["latest", false]);
  }
  return head;
};

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };
try {
  await until(async () => { try { await call(ports.gethRpc, "eth_chainId", []); return true; } catch { return false; } });
  const enode = (await call(ports.gethRpc, "admin_nodeInfo", [])).enode;
  const gethHead = await makeBlocks(ports.gethAuth, ports.gethRpc, 3);
  check(parseInt(gethHead.number, 16) === 3, "geth made three blocks");

  const wac = start("wacuum", process.env.WAC ?? "wac", ["run", "--allow-read", "--allow-write", "--allow-net", "cmd/wacuum.wac", "--",
    "--genesis", join(dir, "genesis.json"), "--jwt-secret", join(dir, "jwt.hex"), "--datadir", join(dir, "wacuum"), "--public-rpc",
    "--port", String(ports.wac), "--peer", enode, "--p2p-port", String(ports.wacP2p)]);
  check(await until(() => wac.log().includes("serving blocks"), 300000), "wacuum dialled geth and agreed on the chain");

  // 1. geth's chain into wacuum.
  check((await choose(ports.wac, gethHead.hash)).payloadStatus.status === "SYNCING", "wacuum is SYNCING to geth's head");
  check(await until(async () => (await choose(ports.wac, gethHead.hash)).payloadStatus.status === "VALID"), "and then has it");
  check((await call(ports.wac, "eth_getBalance", ["0x" + "22".repeat(20), "latest"])) === "0xbbb", "with geth's state");

  // 2. Transactions, both ways.
  const other = ethers.Wallet.createRandom();
  const w = new ethers.Wallet(key);
  const nonce = 3;
  const tx = (n, value) => w.signTransaction({ type: 2, chainId: 1337, nonce: n, to: other.address, value, gasLimit: 21000,
                                               maxFeePerGas: 10n ** 10n, maxPriorityFeePerGas: 10n ** 9n });
  const toWac = await call(ports.wac, "eth_sendRawTransaction", [await tx(nonce, 7n)]);
  check(await until(async () => (await call(ports.gethRpc, "eth_getTransactionByHash", [toWac])) !== null, 20000),
        "a transaction sent to wacuum reaches geth");
  const toGeth = await call(ports.gethRpc, "eth_sendRawTransaction", [await tx(nonce + 1, 8n)]);
  check(await until(async () => (await call(ports.wac, "eth_getTransactionByHash", [toGeth])) !== null, 20000),
        "and one sent to geth reaches wacuum");

  // 3. wacuum's chain into geth.
  const wacHead = await makeBlocks(ports.wac, ports.wac, 2);
  check(parseInt(wacHead.number, 16) === 5, "wacuum made two blocks on geth's three");
  const wacBlock4 = await call(ports.wac, "eth_getBlockByNumber", ["0x4", true]);
  check(wacBlock4.transactions.length === 3, "the first holds both gossiped transactions and its own");
  await choose(ports.gethAuth, wacHead.hash);
  check(await until(async () => (await choose(ports.gethAuth, wacHead.hash)).payloadStatus.status === "VALID"),
        "geth syncs wacuum's blocks from wacuum");
  const g5 = await call(ports.gethRpc, "eth_getBlockByNumber", ["0x5", false]);
  check(g5.hash === wacHead.hash && g5.stateRoot === wacHead.stateRoot, "and ends on the same block and state root");
} catch (err) {
  console.log(`FAIL ${err.stack}`);
  failed++;
}
for (const p of procs) p.kill();
console.log(failed ? `${failed} failed` : "all ok");
process.exit(failed ? 1 : 0);
