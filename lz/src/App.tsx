import { useState } from "react";
import { ethers } from "ethers";

/** === ABI OFT V2 (minimal) ===
 * Catatan: struct di ethers ditulis sebagai tuple.
 */
const OFT_V2_ABI = [
  // view
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",

  // quote & send (V2)
  "function quoteSend((uint32,bytes32,uint256,uint256,bytes,bytes,bytes), bool) view returns (uint256 nativeFee, uint256 lzTokenFee)",
  "function send((uint32,bytes32,uint256,uint256,bytes,bytes,bytes), (uint256,uint256), address) payable",
] as const;

/** === Chain presets untuk switch wallet === */
const CHAIN_CONFIG: Record<number, any> = {
  1:    { chainId: "0x1",    chainName: "Ethereum",  rpcUrls: ["https://rpc.ankr.com/eth"], nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18} },
  56:   { chainId: "0x38",   chainName: "BSC",       rpcUrls: ["https://bsc-dataseed.binance.org/"], nativeCurrency:{name:"BNB",symbol:"BNB",decimals:18} },
  137:  { chainId: "0x89",   chainName: "Polygon",   rpcUrls: ["https://polygon-rpc.com"], nativeCurrency:{name:"MATIC",symbol:"MATIC",decimals:18} },
  42161:{ chainId: "0xa4b1", chainName: "Arbitrum",  rpcUrls: ["https://arb1.arbitrum.io/rpc"], nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18} },
  10:   { chainId: "0xa",    chainName: "Optimism",  rpcUrls: ["https://mainnet.optimism.io"], nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18} },
  8453: { chainId: "0x2105", chainName: "Base",      rpcUrls: ["https://mainnet.base.org"], nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18} },
};

/** helper: buat instance kontrak */
const getOFT = (addr: string, providerOrSigner: any) =>
  new ethers.Contract(addr, OFT_V2_ABI, providerOrSigner);

/** helper: EVM address (20B) -> bytes32 (left-pad) untuk V2 'to' */
const addrToBytes32 = (addr: string) => ethers.zeroPadValue(addr, 32);

/** helper: error message singkat */
const emsg = (e:any) => e?.reason || e?.shortMessage || e?.message || "reverted";

/** Tipe tuple yg dipakai ethers utk sendParam & fee */
type SendParam = [
  number,        // dstEid (uint32)
  string,        // to (bytes32)
  bigint,        // amountLD
  bigint,        // minAmountLD
  string,        // extraOptions (bytes)
  string,        // composeMsg (bytes)
  string         // oftCmd (bytes)
];

type FeeTuple = [bigint, bigint]; // (nativeFee, lzTokenFee)

export default function App() {
  const [provider, setProvider]   = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner]       = useState<ethers.Signer | null>(null);
  const [account, setAccount]     = useState<string | null>(null);
  const [chainId, setChainId]     = useState<number | null>(null);

  const [srcChain, setSrcChain]   = useState<number>(8453); // default Base
  const [dstEid, setDstEid]       = useState<number>(0);    // <- isi dari docs LZ V2 (30xxx/40xxx)

  const [contractAddr, setContractAddr] = useState("");
  const [contract, setContract]   = useState<any>(null);
  const [token, setToken]         = useState({ name:"", symbol:"", decimals:18 });

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount]       = useState("");
  const [slippageBps, setSlippageBps] = useState<string>("50"); // 0.5% default

  const [optionsHex, setOptionsHex] = useState<string>("0x"); // extraOptions raw hex (TYPE_3). Bisa kosong.
  const [useLzToken, setUseLzToken] = useState<boolean>(false);

  const [quotedFee, setQuotedFee] = useState<FeeTuple | null>(null);
  const [feeOverride, setFeeOverride] = useState<string>(""); // wei opsional override
  const [busy, setBusy] = useState(false);

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
    } catch (e) { alert(emsg(e)); }
  }

  /** Switch / add ke source chain */
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

  /** Load kontrak & token meta */
  async function loadContract() {
    try {
      if (!provider) return alert("Connect wallet dulu.");
      if (!ethers.isAddress(contractAddr)) return alert("Alamat kontrak tidak valid.");
      const c = getOFT(contractAddr, provider);
      const [name, symbol, decimals] = await Promise.all([c.name(), c.symbol(), c.decimals()]);
      setContract(c);
      setToken({ name, symbol, decimals: Number(decimals) });
      alert(`Token: ${name} (${symbol}), decimals ${decimals}`);
    } catch (e) { alert("Gagal load kontrak (pastikan ini OFT v2)."); }
  }

  /** Bangun sendParam */
  function buildSendParam(): SendParam {
    if (!ethers.isAddress(recipient)) throw new Error("Recipient tidak valid");
    if (!amount || Number(amount) <= 0) throw new Error("Amount > 0");

    const amt = ethers.parseUnits(amount, token.decimals);
    const bps = BigInt(slippageBps || "0"); // basis points
    const minAmt = bps > 0n ? (amt * (10000n - bps)) / 10000n : amt; // slippage

    return [
      Number(dstEid),                     // dstEid (uint32)
      addrToBytes32(recipient),           // to (bytes32)
      amt,                                // amountLD
      minAmt,                             // minAmountLD
      optionsHex || "0x",                 // extraOptions
      "0x",                               // composeMsg
      "0x",                               // oftCmd
    ];
  }

  /** Quote fee */
  async function quote() {
    try {
      if (!contract) return alert("Kontrak belum dimuat.");
      const sp = buildSendParam();
      const fee = await contract.quoteSend(sp, useLzToken) as FeeTuple;
      setQuotedFee([BigInt(fee[0]), BigInt(fee[1])]);
    } catch (e) { alert("Quote gagal: " + emsg(e)); }
  }

  /** Send */
  async function send() {
    if (!signer || !contract) return;
    try {
      if (!dstEid || dstEid < 30000) {
        alert("Masukkan dstEid V2 yang benar (format 30xxx/40xxx dari docs).");
        return;
      }
      await ensureSourceNetwork(srcChain);

      const sp = buildSendParam();

      // fee dari quote atau override
      let nativeFee = quotedFee ? quotedFee[0] : 0n;
      if (feeOverride) nativeFee = BigInt(feeOverride);

      if (nativeFee === 0n) {
        const f = await contract.quoteSend(sp, useLzToken) as FeeTuple;
        nativeFee = BigInt(f[0] || 0n);
      }

      const feeTuple: FeeTuple = [nativeFee, 0n]; // lzTokenFee=0 bila pay in native
      const from = await signer.getAddress();
      const cWrite = contract.connect(signer);

      // optional preflight
      try {
        await cWrite.send.staticCall(sp, feeTuple, from, { value: nativeFee });
        await cWrite.estimateGas.send(sp, feeTuple, from, { value: nativeFee });
      } catch (pre:any) {
        console.error("preflight", pre);
        alert(
          "Preflight revert.\nKemungkinan:\n• route/peer belum dibuka untuk dstEid ini\n• extraOptions (TYPE_3) tidak cocok\n• fee kurang\n• kontrak bukan OFT v2"
        );
        return;
      }

      setBusy(true);
      const tx = await cWrite.send(sp, feeTuple, from, { value: nativeFee });
      alert("Tx sent: " + tx.hash);
      await tx.wait();
      alert("Tx confirmed!");
    } catch (e) {
      alert("Send error: " + emsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
      <div className="bg-white shadow-xl rounded-2xl p-6 w-full max-w-3xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">🌉 LayerZero Bridge (V2)</h1>
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

        {contract && (
          <div className="rounded-xl border p-4 bg-slate-50">
            <div className="font-semibold">Token yang di-bridge</div>
            <div className="text-sm text-slate-700 mt-1 grid grid-cols-2 gap-2">
              <div>Nama: <b>{token.name || "-"}</b></div>
              <div>Simbol: <b>{token.symbol || "-"}</b></div>
              <div>Decimals: <b>{token.decimals}</b></div>
              <div>Kontrak: <span className="font-mono">{contractAddr}</span></div>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Source Chain</div>
            <select className="w-full mt-2 border rounded-lg px-3 py-2"
              value={srcChain}
              onChange={(e)=>setSrcChain(Number(e.target.value))}
            >
              {Object.keys(CHAIN_CONFIG).map((cid)=>(
                <option key={cid} value={Number(cid)}>
                  {CHAIN_CONFIG[Number(cid)].chainName} (chainId {cid})
                </option>
              ))}
            </select>
            <button onClick={()=>ensureSourceNetwork(srcChain)} className="mt-2 w-full py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900">
              Switch ke Source
            </button>
          </div>

          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Destination EID (V2)</div>
            <input className="w-full mt-2 border rounded-lg px-3 py-2"
              placeholder="contoh: 30184 (Base), 30102 (BSC) — lihat tabel docs"
              value={dstEid || ""}
              onChange={(e)=>setDstEid(Number(e.target.value))}
            />
            <div className="text-[11px] text-slate-500 mt-1">
              Ambil EID dari tabel “Deployed Endpoints” (format 30xxx/40xxx).
            </div>
          </div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="text-sm font-semibold">Alamat Kontrak (OFT v2)</div>
          <input className="w-full mt-2 border rounded-lg px-3 py-2 font-mono"
            placeholder="0x..."
            value={contractAddr}
            onChange={(e)=>setContractAddr(e.target.value)}
          />
          <button onClick={loadContract} className="mt-2 w-full py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900">
            Load Contract & Token Info
          </button>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div className="rounded-xl border p-4 md:col-span-2">
            <div className="text-sm font-semibold">Recipient</div>
            <input className="w-full mt-2 border rounded-lg px-3 py-2 font-mono"
              value={recipient}
              onChange={(e)=>setRecipient(e.target.value)}
            />
            <div className="text-xs text-slate-500 mt-1">
              V2 membutuhkan <i>bytes32</i>, UI mengonversi otomatis dari address.
            </div>
          </div>
          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Amount</div>
            <input className="w-full mt-2 border rounded-lg px-3 py-2"
              placeholder="1.0"
              value={amount}
              onChange={(e)=>setAmount(e.target.value)}
            />
            <div className="text-xs text-slate-500 mt-1">Decimals: {token.decimals}</div>
          </div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="text-sm font-semibold">Slippage (minAmount) • basis points</div>
          <input className="w-full mt-2 border rounded-lg px-3 py-2" type="number"
            value={slippageBps}
            onChange={(e)=>setSlippageBps(e.target.value)}
          />
          <div className="text-[11px] text-slate-500 mt-1">50 = 0.5%, 100 = 1%, 0 = tanpa slippage.</div>
        </div>

        <div className="rounded-xl border p-4 space-y-3">
          <div className="text-sm font-semibold">extraOptions (TYPE_3) • Raw hex</div>
          <input className="w-full mt-2 border rounded-lg px-3 py-2 font-mono"
            placeholder="0x (kosong) atau paste dari tx contoh di explorer"
            value={optionsHex}
            onChange={(e)=>setOptionsHex(e.target.value)}
          />
          <div className="grid md:grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={useLzToken} onChange={(e)=>setUseLzToken(e.target.checked)} />
              Bayar pakai LZ token (ZRO/LZT) — biasanya <b>OFF</b>
            </label>
            <div>
              <label className="text-xs">Override Native Fee (wei, opsional)</label>
              <input className="w-full mt-1 border rounded-lg px-3 py-2"
                placeholder="kosongkan untuk pakai hasil quote"
                value={feeOverride}
                onChange={(e)=>setFeeOverride(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={quote} className="flex-1 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900">
            Quote Fee
          </button>
          <button onClick={send} disabled={busy} className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {busy ? "Sending..." : "Send"}
          </button>
        </div>

        {quotedFee && (
          <div className="p-3 bg-yellow-50 rounded-lg text-sm text-yellow-700">
            Fee (native): {quotedFee[0].toString()} wei • LZ token fee: {quotedFee[1].toString()} wei
          </div>
        )}

        <p className="text-xs text-slate-500">
          Tips: EID harus sesuai tabel V2 (30xxx/40xxx). Jika tetap revert:
          rute/peer belum dibuka oleh owner, atau <i>extraOptions</i> tidak cocok. Samakan
          <i>dstEid / to / amount / extraOptions / msg.value</i> dengan tx referensi dari explorer.
        </p>
      </div>
    </div>
  );
}
