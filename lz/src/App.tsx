import { useState } from "react";
import { ethers } from "ethers";

/** ====== ABI minimal OFT ====== */
const MINIMAL_OFT_ABI = [
  "function estimateSendFee(uint16 _dstChainId, bytes _toAddress, uint _amount, bool _useZro, bytes _adapterParams) view returns (uint nativeFee, uint zroFee)",
  "function sendFrom(address _from, uint16 _dstChainId, bytes _toAddress, uint _amount, address payable _refundAddress, address _zroPaymentAddress, bytes _adapterParams) external payable",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)"
] as const;

/** ====== Chain presets ====== */
const CHAIN_CONFIG: Record<number, any> = {
  1:    { chainId: "0x1",    chainName: "Ethereum",     rpcUrls: ["https://rpc.ankr.com/eth"], nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18} },
  56:   { chainId: "0x38",   chainName: "BSC",          rpcUrls: ["https://bsc-dataseed.binance.org/"], nativeCurrency:{name:"BNB",symbol:"BNB",decimals:18} },
  137:  { chainId: "0x89",   chainName: "Polygon",      rpcUrls: ["https://polygon-rpc.com"], nativeCurrency:{name:"MATIC",symbol:"MATIC",decimals:18} },
  42161:{ chainId: "0xa4b1", chainName: "Arbitrum One", rpcUrls: ["https://arb1.arbitrum.io/rpc"], nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18} },
  10:   { chainId: "0xa",    chainName: "Optimism",     rpcUrls: ["https://mainnet.optimism.io"], nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18} },
  8453: { chainId: "0x2105", chainName: "Base",         rpcUrls: ["https://mainnet.base.org"], nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18} },
};

/** ====== LZ EIDs populer ====== */
const LZ_OPTS = [
  { label: "Ethereum", eid: 101, chainId: 1 },
  { label: "BSC",      eid: 102, chainId: 56 },
  { label: "Polygon",  eid: 109, chainId: 137 },
  { label: "Arbitrum", eid: 110, chainId: 42161 },
  { label: "Optimism", eid: 111, chainId: 10 },
  { label: "Base",     eid: 112, chainId: 8453 },
];

/** Helpers */
const getOFT = (addr: string, providerOrSigner: any) =>
  new ethers.Contract(addr, MINIMAL_OFT_ABI, providerOrSigner);

const toBytes = (addr: string) => ethers.solidityPacked(["address"], [addr]);
const abi = ethers.AbiCoder.defaultAbiCoder();

function buildAdapterV1(gasLimit: bigint) {
  return abi.encode(["uint16","uint256"], [1, gasLimit]);
}
function buildAdapterV2(gasLimit: bigint, dstNative: bigint) {
  return abi.encode(["uint16","uint256","uint256"], [2, gasLimit, dstNative]);
}
const errMsg = (e:any)=> e?.reason || e?.shortMessage || e?.message || "reverted";

type AdapterMode = "autoV1" | "autoV2" | "raw";

export default function App() {
  const [provider, setProvider]   = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner]       = useState<ethers.Signer | null>(null);
  const [account, setAccount]     = useState<string | null>(null);
  const [chainId, setChainId]     = useState<number | null>(null);

  const [srcChain, setSrcChain]   = useState<number>(8453);  // contoh default Base
  const [dstEid, setDstEid]       = useState<number>(102);   // contoh default BSC

  const [contractAddr, setContractAddr] = useState("");
  const [contract, setContract]   = useState<any>(null);
  const [token, setToken]         = useState({ name:"", symbol:"", decimals:18 });

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount]       = useState("");

  // Advanced (adapter/fee/ZRO)
  const [adapterMode, setAdapterMode] = useState<AdapterMode>("autoV1");
  const [gasLimit, setGasLimit]   = useState<string>("300000");
  const [dstNative, setDstNative] = useState<string>("0");     // untuk v2
  const [rawAdapter, setRawAdapter] = useState<string>("0x");   // untuk mode raw
  const [useZro, setUseZro]       = useState<boolean>(false);
  const [feeOverride, setFeeOverride] = useState<string>("");  // wei
  const [nativeFee, setNativeFee] = useState<string | null>(null);

  const [busy, setBusy]           = useState(false);

  /** Connect */
  async function connectWallet() {
    try {
      if (!(window as any).ethereum) return alert("MetaMask tidak ditemukan.");
      const p  = new ethers.BrowserProvider((window as any).ethereum, "any");
      const ac = await p.send("eth_requestAccounts", []);
      const s  = await p.getSigner();
      const n  = await p.getNetwork();
      setProvider(p); setSigner(s);
      setAccount(ac[0]); setChainId(Number(n.chainId));
      setRecipient(ac[0]);
    } catch (e) { alert(errMsg(e)); }
  }

  /** Switch/Add ke source */
  async function ensureSourceNetwork(target: number) {
    if (!(window as any).ethereum) return;
    if (chainId === target) return;
    try {
      await (window as any).ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_CONFIG[target].chainId }],
      });
      setChainId(target);
    } catch (e:any) {
      if (e.code === 4902) {
        await (window as any).ethereum.request({
          method: "wallet_addEthereumChain",
          params: [CHAIN_CONFIG[target]],
        });
        setChainId(target);
      } else {
        throw e;
      }
    }
  }

  /** Load kontrak & token info */
  async function loadContract() {
    try {
      if (!provider) return alert("Connect wallet dulu.");
      if (!ethers.isAddress(contractAddr)) return alert("Alamat kontrak tidak valid.");
      const c = getOFT(contractAddr, provider);
      const [name, symbol, decimals] = await Promise.all([c.name(), c.symbol(), c.decimals()]);
      setContract(c);
      setToken({ name, symbol, decimals: Number(decimals) });
      alert(`Token: ${name} (${symbol}), decimals ${decimals}`);
    } catch (e) { alert("Gagal load kontrak (pastikan ini OFT)."); }
  }

  /** Ambil adapter params sesuai mode */
  function currentAdapter(): string {
    if (adapterMode === "raw") {
      return rawAdapter && rawAdapter !== "" ? rawAdapter : "0x";
    }
    if (adapterMode === "autoV2") {
      return buildAdapterV2(BigInt(gasLimit || "0"), BigInt(dstNative || "0"));
    }
    // default v1
    return buildAdapterV1(BigInt(gasLimit || "0"));
  }

  /** Estimate fee */
  async function doEstimate() {
    try {
      if (!contract) return alert("Kontrak belum dimuat.");
      if (!ethers.isAddress(recipient)) return alert("Recipient tidak valid.");
      if (!amount || Number(amount) <= 0) return alert("Amount > 0");
      const amt = ethers.parseUnits(amount, token.decimals);
      const toB = toBytes(recipient);
      const adapter = currentAdapter();
      const res = await contract.estimateSendFee(Number(dstEid), toB, amt, useZro, adapter);
      setNativeFee(res?.[0]?.toString?.() || null);
    } catch (e) { alert("Estimate gagal: " + errMsg(e)); }
  }

  /** Bridge (preflight + kirim) */
  async function doBridge() {
    if (!signer || !contract) return;
    try {
      await ensureSourceNetwork(srcChain);

      const from  = await signer.getAddress();
      const amt   = ethers.parseUnits(amount, token.decimals);
      const toB   = toBytes(recipient);
      const adapter = currentAdapter();

      // fee
      let fee = feeOverride && feeOverride !== "" ? BigInt(feeOverride) : (nativeFee ? BigInt(nativeFee) : 0n);
      if (fee === 0n) {
        const r = await contract.estimateSendFee(Number(dstEid), toB, amt, useZro, adapter);
        fee = BigInt(r?.[0] || 0n);
      }

      const cWrite = contract.connect(signer);

      // preflight (lebih informatif)
      try {
        await cWrite.sendFrom.staticCall(from, Number(dstEid), toB, amt, from, ethers.ZeroAddress, adapter, { value: fee });
        await cWrite.estimateGas.sendFrom(from, Number(dstEid), toB, amt, from, ethers.ZeroAddress, adapter, { value: fee });
      } catch (pre:any) {
        console.error("preflight revert", pre);
        alert("Preflight revert.\nKemungkinan:\n• trustedRemote/peer belum diset untuk EID tujuan\n• adapterParams (v1/v2/gas) tidak cocok\n• fee native kurang\n• kontrak bukan OFT");
        return;
      }

      setBusy(true);
      const tx = await cWrite.sendFrom(from, Number(dstEid), toB, amt, from, ethers.ZeroAddress, adapter, { value: fee });
      alert("Tx sent: " + tx.hash);
      await tx.wait();
      alert("Tx confirmed!");
    } catch (e) {
      alert("Bridge error: " + errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
      <div className="bg-white shadow-xl rounded-2xl p-6 w-full max-w-2xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">🌉 LayerZero Bridge</h1>
          {!account ? (
            <button onClick={connectWallet} className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
              Connect Wallet
            </button>
          ) : (
            <div className="text-sm text-green-700 bg-green-50 px-3 py-1 rounded-lg">
              ✅ {account.slice(0,6)}…{account.slice(-4)} · chainId {chainId}
            </div>
          )}
        </header>

        {/* Info Token */}
        {contract && (
          <div className="rounded-xl border p-4 bg-slate-50">
            <div className="font-semibold">Token yang di-bridge</div>
            <div className="text-sm text-slate-700 mt-1">
              <div>Nama: <b>{token.name || "-"}</b></div>
              <div>Simbol: <b>{token.symbol || "-"}</b></div>
              <div>Decimals: <b>{token.decimals}</b></div>
              <div>Kontrak: <span className="font-mono">{contractAddr}</span></div>
              <div>Source Chain: <b>{CHAIN_CONFIG[srcChain]?.chainName || srcChain}</b></div>
            </div>
          </div>
        )}

        {/* Source & Destination */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Source Chain</div>
            <select className="w-full mt-2 border rounded-lg px-3 py-2"
              value={srcChain}
              onChange={(e)=>setSrcChain(Number(e.target.value))}
            >
              {LZ_OPTS.map(c => <option key={c.chainId} value={c.chainId}>{c.label} (chainId {c.chainId})</option>)}
            </select>
            <button onClick={()=>ensureSourceNetwork(srcChain)} className="mt-2 w-full py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900">
              Switch ke Source
            </button>
          </div>

          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Destination (EID)</div>
            <select className="w-full mt-2 border rounded-lg px-3 py-2"
              value={dstEid}
              onChange={(e)=>setDstEid(Number(e.target.value))}
            >
              {LZ_OPTS.map(c => <option key={c.eid} value={c.eid}>{c.label} (EID {c.eid})</option>)}
            </select>
          </div>
        </div>

        {/* Kontrak */}
        <div className="rounded-xl border p-4">
          <div className="text-sm font-semibold">Alamat Kontrak (OFT/Adapter)</div>
          <input className="w-full mt-2 border rounded-lg px-3 py-2 font-mono"
            placeholder="0x..."
            value={contractAddr}
            onChange={(e)=>setContractAddr(e.target.value)}
          />
          <button onClick={loadContract} className="mt-2 w-full py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900">
            Load Contract & Token Info
          </button>
        </div>

        {/* Recipient & Amount */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Recipient</div>
            <input className="w-full mt-2 border rounded-lg px-3 py-2 font-mono"
              value={recipient}
              onChange={(e)=>setRecipient(e.target.value)}
            />
            <div className="text-xs text-slate-500 mt-1">Otomatis terisi wallet yang connect (bisa diedit).</div>
          </div>
          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Amount</div>
            <input className="w-full mt-2 border rounded-lg px-3 py-2"
              placeholder="1.0"
              value={amount}
              onChange={(e)=>setAmount(e.target.value)}
            />
          </div>
        </div>

        {/* Advanced Adapter / Fee */}
        <div className="rounded-xl border p-4 space-y-3">
          <div className="text-sm font-semibold">Advanced (samakan dengan tx contoh)</div>
          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs">Adapter Mode</label>
              <select className="w-full mt-1 border rounded-lg px-3 py-2"
                value={adapterMode}
                onChange={(e)=>setAdapterMode(e.target.value as AdapterMode)}
              >
                <option value="autoV1">Auto v1 (gas)</option>
                <option value="autoV2">Auto v2 (gas + dstNative)</option>
                <option value="raw">Raw hex (paste)</option>
              </select>
            </div>
            <div>
              <label className="text-xs">Gas Limit</label>
              <input className="w-full mt-1 border rounded-lg px-3 py-2" type="number"
                value={gasLimit} onChange={(e)=>setGasLimit(e.target.value)} />
            </div>
            <div>
              <label className="text-xs">Dst Native (wei, v2)</label>
              <input className="w-full mt-1 border rounded-lg px-3 py-2" type="number"
                value={dstNative} onChange={(e)=>setDstNative(e.target.value)} />
            </div>
          </div>
          {adapterMode === "raw" && (
            <div>
              <label className="text-xs">Raw Adapter Params (hex)</label>
              <input className="w-full mt-1 border rounded-lg px-3 py-2 font-mono"
                placeholder="0x..."
                value={rawAdapter}
                onChange={(e)=>setRawAdapter(e.target.value)}
              />
              <div className="text-[11px] text-slate-500 mt-1">
                Tip: panjang 64 byte ≈ v1, 96 byte ≈ v2.
              </div>
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={useZro} onChange={(e)=>setUseZro(e.target.checked)} />
              Use ZRO payment
            </label>
            <div>
              <label className="text-xs">Override Fee (wei, optional)</label>
              <input className="w-full mt-1 border rounded-lg px-3 py-2"
                placeholder="kosongkan untuk pakai estimate"
                value={feeOverride}
                onChange={(e)=>setFeeOverride(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={doEstimate} className="flex-1 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900">
            Estimate Fee
          </button>
          <button onClick={doBridge} disabled={busy} className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {busy ? "Bridging..." : "Bridge"}
          </button>
        </div>

        {nativeFee && (
          <div className="p-3 bg-yellow-50 rounded-lg text-sm text-yellow-700">
            Fee Estimate: {nativeFee} wei
          </div>
        )}

        <p className="text-xs text-slate-500">
          Catatan: kalau tetap “missing revert data”, biasanya route belum dibuka (trustedRemote/peer belum diset),
          atau adapter versi/param tidak cocok dengan kontrak tujuan.
        </p>
      </div>
    </div>
  );
}
