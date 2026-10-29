// The user's JSON-RPC, checked by a library that was not written against it: start wacuum with
// --public-rpc on a fresh chain, make blocks the way a consensus client would (forkchoiceUpdated with
// attributes, getPayload, newPayload, forkchoiceUpdated), and use ethers as a wallet would — send a
// transfer, deploy a contract, call it, estimate gas, wait for receipts, read blocks, logs and fees.
//
//     ETHERS=path/to/node_modules/ethers WAC=path/to/native/wac node tools/rpc-e2e.mjs
//
// Like engine-e2e.mjs, it needs a `wac` on a native host.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ethers = await import(join(process.env.ETHERS ?? "node_modules/ethers", "lib.esm/index.js"));
const dir = mkdtempSync(join(tmpdir(), "wacuum-rpc-"));
const key = "0x" + "11".repeat(32);
const me = new ethers.Wallet(key).address;

// The system contracts a Prague block calls, from the test kit, and one funded account.
const kit = readFileSync(new URL("../test/chainkit.wac", import.meta.url), "utf8");
const code = (name) => kit.match(new RegExp(`static string ${name} = "(0x[0-9a-f]+)"`))[1];
const alloc = {
  [me]: { balance: "0x56bc75e2d63100000" },
  "0x00000961ef480eb55e80d19ad83579a64c007002": { nonce: "0x1", code: code("WITHDRAWALS") },
  "0x0000bbddc7ce488642fb579f8b00f3a590007251": { nonce: "0x1", code: code("CONSOLIDATIONS") },
  "0x0000f90827f1c53a10cb7a02335b175320002935": { nonce: "0x1", code: code("HISTORY") },
  "0x000f3df6d732807ef1319fb7b8bb8522d0beac02": { nonce: "0x1", code: code("BEACON_ROOTS") },
};
const genesis = { config: { chainId: 1337, cancunTime: 0, pragueTime: 0 }, gasLimit: "0x1c9c380",
                  baseFeePerGas: "0x3b9aca00", timestamp: "0x0", alloc };
const secret = randomBytes(32);
writeFileSync(join(dir, "genesis.json"), JSON.stringify(genesis));
writeFileSync(join(dir, "jwt.hex"), secret.toString("hex"));
const port = 19551 + Math.floor(Math.random() * 1000);
const node = spawn(process.env.WAC ?? "wac", ["run", "--allow-read", "--allow-write", "--allow-net", "cmd/wacuum.wac", "--",
  "--genesis", join(dir, "genesis.json"), "--jwt-secret", join(dir, "jwt.hex"), "--public-rpc", "--port", String(port)]);
let out = "";
node.stdout.on("data", (d) => { out += d; process.stdout.write("  wacuum| " + d); });
node.stderr.on("data", (d) => process.stdout.write("  wacuum! " + d));
for (let i = 0; i < 600 && !out.includes("Engine API on"); i++) await new Promise((r) => setTimeout(r, 100));
const url = `http://127.0.0.1:${port}`;

// The consensus client's half.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = () => {
  const s = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ iat: Math.floor(Date.now() / 1000) });
  return s + "." + createHmac("sha256", secret).update(s).digest("base64url");
};
const engine = async (method, params) => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${jwt()}` },
                                 body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
};
const zero = "0x" + "00".repeat(32);
let head = (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }) })).json()).result;
let time = 12;
const makeBlock = async () => {
  const fc = { headBlockHash: head.hash, safeBlockHash: head.hash, finalizedBlockHash: zero };
  const attrs = { timestamp: "0x" + time.toString(16), prevRandao: zero, suggestedFeeRecipient: "0x" + "00".repeat(19) + "fe",
                  withdrawals: [], parentBeaconBlockRoot: zero };
  time += 12;
  const { payloadId } = await engine("engine_forkchoiceUpdatedV3", [fc, attrs]);
  const p = await engine("engine_getPayloadV4", [payloadId]);
  const st = await engine("engine_newPayloadV4", [p.executionPayload, [], zero, p.executionRequests]);
  if (st.status !== "VALID") throw new Error(`built block ${st.status}: ${st.validationError}`);
  const h = p.executionPayload.blockHash;
  await engine("engine_forkchoiceUpdatedV3", [{ headBlockHash: h, safeBlockHash: h, finalizedBlockHash: zero }, null]);
  head = { hash: h };
  return p.executionPayload;
};

// The wallet's half.
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };
const provider = new ethers.JsonRpcProvider(url, 1337, { staticNetwork: true, batchMaxCount: 1, pollingInterval: 50 });
const wallet = new ethers.Wallet(key, provider);
const mined = async (tx) => { const b = await makeBlock(); const r = await tx.wait(); return [b, r]; };
try {
  check((await provider.getNetwork()).chainId === 1337n, "eth_chainId");
  const to = "0x" + "22".repeat(20);
  const [b1, r1] = await mined(await wallet.sendTransaction({ to, value: 12345n }));
  check(r1.status === 1 && r1.blockNumber === 1, "a transfer is mined in block 1");
  check(await provider.getBalance(to) === 12345n, "and its value arrived");
  check(await provider.getBalance(to, 0) === 0n, "which it had not at block 0");
  check((await provider.getTransactionCount(me)) === 1, "the sender's nonce moved");

  // A contract whose every call logs 42 under one topic: init code that returns that runtime.
  const topic = ethers.id("Answered(uint256)");
  const runtime = "602a600052" + "7f" + topic.slice(2) + "60206000a100";
  const n = runtime.length / 2;
  const init = "60" + n.toString(16).padStart(2, "0") + "600c60003960" + n.toString(16).padStart(2, "0") + "6000f3" + runtime;
  const deploy = await wallet.sendTransaction({ data: "0x" + init });
  const [, r2] = await mined(deploy);
  check(r2.status === 1 && r2.contractAddress === ethers.getCreateAddress({ from: me, nonce: 1 }), "a contract is deployed where ethers says");
  check((await provider.getCode(r2.contractAddress)) === "0x" + runtime, "with its runtime code");

  const est = await provider.estimateGas({ from: me, to: r2.contractAddress, data: "0x" });
  check(est > 21000n && est < 30000n, `eth_estimateGas: ${est}`);
  const call = await wallet.sendTransaction({ to: r2.contractAddress, gasLimit: est });
  const [b3, r3] = await mined(call);
  check(r3.status === 1 && r3.gasUsed <= est, "the call succeeds within the estimate");
  check(r3.logs.length === 1 && r3.logs[0].topics[0] === topic && BigInt(r3.logs[0].data) === 42n, "its log is in the receipt");
  const logs = await provider.getLogs({ address: r2.contractAddress, topics: [topic], fromBlock: 0 });
  check(logs.length === 1 && logs[0].transactionHash === call.hash, "eth_getLogs finds it");
  check((await provider.getLogs({ topics: [ethers.id("other")], fromBlock: 0 })).length === 0, "and not under another topic");

  const block = await provider.getBlock(3, true);
  check(block.hash === b3.blockHash && block.prefetchedTransactions[0].hash === call.hash, "eth_getBlockByNumber, full");
  const tx = await provider.getTransaction(call.hash);
  check(tx.blockNumber === 3 && tx.from === me && tx.signature.r !== ethers.ZeroHash, "eth_getTransactionByHash");
  const fee = await provider.getFeeData();
  check(fee.maxFeePerGas > 0n && fee.maxPriorityFeePerGas === 1000000000n, "eth_gasPrice and eth_maxPriorityFeePerGas");
  const hist = await provider.send("eth_feeHistory", ["0x2", "latest", [50]]);
  check(hist.baseFeePerGas.length === 3 && hist.reward.length === 2, "eth_feeHistory");
  check((await provider.call({ to: r2.contractAddress })) === "0x", "eth_call");
  check(await provider.getBlockNumber() === 3, "eth_blockNumber");
  let refused = false;
  try { await provider.send("engine_forkchoiceUpdatedV3", [{}, null]); } catch { refused = true; }
  check(refused, "the Engine API is refused without a token");
} catch (err) {
  console.log(`FAIL ${err.stack}`);
  failed++;
}
node.kill();
console.log(failed ? `${failed} failed` : "all ok");
process.exit(failed ? 1 : 0);
