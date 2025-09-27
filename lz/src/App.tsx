import { useState } from "react";
import { ethers } from "ethers";

/** ====== ABI minimal OFT LayerZero ====== */
const MINIMAL_OFT_ABI = [
  "function estimateSendFee(uint16 _dstChainId, bytes _toAddress, uint _amount, bool _useZro, bytes _adapterParams) view returns (uint nativeFee, uint zroFee)",
  "function sendFrom(address _from, uint16 _dstChainId, bytes _toAddress, uint _amount, address payable _refundAddress, address _zroPaymentAddress, bytes _adapterParams) external payable",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
] as const;

/** ====== Chain preset (mainnets). Tambah sendiri bila perlu ====== */
const CHAIN_CONFIG: Record<number, any> = {
  1:    { chainId: "0x1",    chainName: "Ethereum",     rpcUrls: ["https://rpc.ankr.com/eth"],      nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18} },
  56:   { chainId: "0x38",   chainName: "BSC",          rpcUrls: ["https://bsc-dataseed.binance.org/"], nativeCurrency:{name:"BNB",symbol:"BNB",decimals:18} },
  137:  { chainId: "0x89",   chainName: "Polygon",      rpcUrls: ["https://polygon-rpc.com"],       nativeCurrency:{name:"MATIC",symbol:"MATIC",decimals:18} },
  42161:{ chainId: "0xa4b1", chainName: "Arbitrum One", rpcUrls: ["https://arb1.arbitrum.io/rpc"],  nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18} },
  10:   { chainId: "0xa",    chainName: "Optimism",     rpcUrls: ["https://mainnet.optimism.io"],   nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18} },
  8453: { chainId: "0x2105", chainName: "Base",         rpcUrls: ["https://mainnet.base.org"],      nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18} },
};

/** ====== LZ EIDs populer + mapping chainId asal ====== */
const LZ_OPTS = [
  { label: "Ethereum", eid: 101, chainId: 1 },
  { label: "BSC", eid: 102, chainId: 56 },
  { label: "Polygon", eid: 109, chainId: 137 },
  { label: "Arbitrum", eid: 110, chainId: 42161 },
  { label: "Optimism", eid: 111, chainId: 10 },
  { label: "Base", eid: 112, chainId: 8453 },
];

/** helper: buat instance kontrak */
const getOFT = (addr: string, providerOrSigner: any) =>
  new ethers.Contract(addr, MINIMAL_OFT_ABI, providerOrSigner);

/** helper: encode EVM address -> bytes (abi.encodePacked(address)) */
const toBytes = (addr: string) => ethers.solidityPacked(["address"], [addr]);

export default function App() {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  const [srcChain, setSrcChain] = useState<number>(56);        // default source: BSC
  const [dstEid, setDstEid] = useState<number>(101);           // default destination: Ethereum (EID 101)

  const [contractAddr, setContractAddr] = useState("");
  const [contract, setContract] = useState<any>(null);

  const [tokenMeta, setTokenMeta] = useState({ name: "", symbol: "", decimals: 18 });
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");

  const [nativeFee, setNativeFee] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Connect wallet */
  async function connectWallet() {
    try {
      if (!(window as any).ethereum) return alert("MetaMask tidak ditemukan.");
      const p = new ethers.BrowserProvider((window as any).ethereum, "any");
      const accounts = await p.send("eth_requestAccounts", []);
      const s = await p.getSigner();
      const n = await p.getNetwork();
      setProvider(p);
      setSigner(s);
      setAccount(accounts[0]);
      setChainId(Number(n.chainId));
      setRecipient(accounts[0]); // auto isi recipient
    } catch (e: any) {
      console.error(e); alert(e.message || e);
    }
  }

  /** Switch / add network ke source chain */
  async function ensureSourceNetwork(target: number) {
    if (!(window as any).ethereum) return;
    if (chainId === target) return;
    try {
      await (window as any).ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_CONFIG[target].chainId }],
      });
      setChainId(target);
    } catch (err: any) {
      if (err.code === 4902) {
        await (window as any).ethereum.request({
          method: "wallet_addEthereumChain",
          params: [CHAIN_CONFIG[target]],
        });
        setChainId(target);
      } else {
        throw err;
      }
    }
  }

  /** Load kontrak & token info */
  async function loadContract() {
    try {
      if (!provider) return alert("Connect wallet dulu.");
      if (!ethers.isAddress(contractAddr)) return alert("Alamat kontrak tidak valid.");
      const c = getOFT(contractAddr, provider);
      setContract(c);
      const [name, symbol, decimals] = await Promise.all([c.name(), c.symbol(), c.decimals()]);
      setTokenMeta({ name, symbol, decimals: Number(decimals) });
      alert(`Loaded: ${name} (${symbol}), decimals ${decimals}`);
    } catch (e: any) {
      console.error("loadContract", e);
      alert("Gagal load kontrak (pastikan ini OFT/adapter).");
    }
  }

  /** Estimate fee */
  async function doEstimate() {
    try {
      if (!contract) return alert("Kontrak belum dimuat.");
      if (!recipient || !ethers.isAddress(recipient)) return alert("Recipient tidak valid.");
      if (!amount || Number(amount) <= 0) return alert("Amount > 0");
      const amtWei = ethers.parseUnits(amount, tokenMeta.decimals);
      const toB = toBytes(recipient);
      const res = await contract.estimateSendFee(Number(dstEid), toB, amtWei, false, "0x");
      setNativeFee(res?.[0]?.toString?.() || null);
      console.log("estimateSendFee", res);
    } catch (e: any) {
      console.error("estimate", e);
      alert("Estimate gagal (cek trustedRemote / EID / adapterParams).");
    }
  }

  /** Bridge */
  async function doBridge() {
    if (!signer || !contract) return;
    try {
      // pastikan di source chain yang dipilih
      await ensureSourceNetwork(srcChain);

      const from = await signer.getAddress();
      const decimals = tokenMeta.decimals;
      const amtWei = ethers.parseUnits(amount, decimals);
      const toB = toBytes(recipient);

      // fee
      let fee = nativeFee ? BigInt(nativeFee) : 0n;
      if (fee === 0n) {
        const r = await contract.estimateSendFee(Number(dstEid), toB, amtWei, false, "0x");
        fee = BigInt(r?.[0] || 0n);
      }

      // preflight supaya error-nya jelas
      const cWrite = contract.connect(signer);
      try {
        const gas = await cWrite.estimateGas.sendFrom(
          from, Number(dstEid), toB, amtWei, from, ethers.ZeroAddress, "0x", { value: fee }
        );
        console.log("preflight gas", gas.toString());
      } catch (pre: any) {
        console.error("preflight revert", pre);
        alert(
          "Preflight revert.\nKemungkinan:\n• trustedRemote/peer untuk EID tujuan belum diset\n• adapterParams salah\n• fee native kurang\n• kontrak bukan OFT"
        );
        return;
      }

      setBusy(true);
      const tx = await cWrite.sendFrom(
        from, Number(dstEid), toB, amtWei, from, ethers.ZeroAddress, "0x", { value: fee }
      );
      alert("Tx sent: " + tx.hash);
      const rc = await tx.wait();
      console.log("confirmed", rc);
      alert("Tx confirmed!");
    } catch (e: any) {
      console.error("bridge", e);
      alert("Bridge error: " + (e.reason || e.message || "reverted"));
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

        {/* Token info */}
        {contract && (
          <div className="rounded-xl border p-4 bg-slate-50">
            <div className="font-semibold">Token yang di-bridge</div>
            <div className="text-sm text-slate-700 mt-1">
              <div>Nama: <b>{tokenMeta.name || "-"}</b></div>
              <div>Simbol: <b>{tokenMeta.symbol || "-"}</b></div>
              <div>Decimals: <b>{tokenMeta.decimals}</b></div>
              <div>Kontrak: <span className="font-mono">{contractAddr}</span></div>
              <div>Source Chain: <b>{CHAIN_CONFIG[srcChain]?.chainName || srcChain}</b></div>
            </div>
          </div>
        )}

        {/* Source & Destination */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Source Chain</div>
            <select
              className="w-full mt-2 border rounded-lg px-3 py-2"
              value={srcChain}
              onChange={(e) => setSrcChain(Number(e.target.value))}
            >
              {LZ_OPTS.map((c) => (
                <option key={c.chainId} value={c.chainId}>{c.label} (chainId {c.chainId})</option>
              ))}
            </select>
            <button
              onClick={() => ensureSourceNetwork(srcChain)}
              className="mt-2 w-full py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900"
            >
              Switch ke Source
            </button>
          </div>

          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Destination (EID)</div>
            <select
              className="w-full mt-2 border rounded-lg px-3 py-2"
              value={dstEid}
              onChange={(e) => setDstEid(Number(e.target.value))}
            >
              {LZ_OPTS.map((c) => (
                <option key={c.eid} value={c.eid}>{c.label} (EID {c.eid})</option>
              ))}
            </select>
          </div>
        </div>

        {/* Contract */}
        <div className="rounded-xl border p-4">
          <div className="text-sm font-semibold">Alamat Kontrak (OFT/Adapter)</div>
          <input
            className="w-full mt-2 border rounded-lg px-3 py-2 font-mono"
            placeholder="0x..."
            value={contractAddr}
            onChange={(e) => setContractAddr(e.target.value)}
          />
          <button
            onClick={loadContract}
            className="mt-2 w-full py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900"
          >
            Load Contract & Token Info
          </button>
        </div>

        {/* Recipient & Amount */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Recipient</div>
            <input
              className="w-full mt-2 border rounded-lg px-3 py-2 font-mono"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
            <div className="text-xs text-slate-500 mt-1">Otomatis terisi dengan wallet yang connect (bisa diedit).</div>
          </div>
          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Amount</div>
            <input
              className="w-full mt-2 border rounded-lg px-3 py-2"
              placeholder="1.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={doEstimate} className="flex-1 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900">
            Estimate Fee
          </button>
          <button
            onClick={doBridge}
            disabled={busy}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Bridging..." : "Bridge"}
          </button>
        </div>

        {nativeFee && (
          <div className="p-3 bg-yellow-50 rounded-lg text-sm text-yellow-700">
            Fee Estimate: {nativeFee} wei
          </div>
        )}

        <p className="text-xs text-slate-500">
          Catatan: Bridge butuh kontrak OFT yang sudah <i>trustedRemote/peer</i> untuk EID tujuan. Jika preflight revert,
          cek konfigurasi peer & adapterParams, serta pastikan berada di source chain yang benar.
        </p>
      </div>
    </div>
  );
}
