import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

// ABI minimal untuk OFT LayerZero
const MINIMAL_OFT_ABI = [
  "function estimateSendFee(uint16 _dstChainId, bytes _toAddress, uint _amount, bool _useZro, bytes _adapterParams) view returns (uint nativeFee, uint zroFee)",
  "function sendFrom(address _from, uint16 _dstChainId, bytes _toAddress, uint _amount, address payable _refundAddress, address _zroPaymentAddress, bytes _adapterParams) external payable",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)"
] as const;

type OFT = {
  estimateSendFee(
    dstChainId: number,
    toAddress: string,
    amount: bigint,
    useZro: boolean,
    adapterParams: string
  ): Promise<[bigint, bigint]>;
  sendFrom(
    from: string,
    dstChainId: number,
    toAddress: string,
    amount: bigint,
    refundAddress: string,
    zroPaymentAddress: string,
    adapterParams: string,
    overrides?: { value?: bigint }
  ): Promise<ethers.TransactionResponse>;
  decimals(): Promise<number>;
  name(): Promise<string>;
  symbol(): Promise<string>;
};

const getOFT = (addr: string, providerOrSigner: any) =>
  new ethers.Contract(addr, MINIMAL_OFT_ABI, providerOrSigner) as unknown as OFT;

// EID populer LayerZero
const LZ_CHAINS = [
  { label: "Ethereum", eid: 101 },
  { label: "BSC", eid: 102 },
  { label: "Avalanche", eid: 106 },
  { label: "Polygon", eid: 109 },
  { label: "Arbitrum", eid: 110 },
  { label: "Optimism", eid: 111 },
  { label: "Base", eid: 112 },
  { label: "Linea", eid: 115 },
];

export default function App() {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  const [contractAddr, setContractAddr] = useState("");
  const [contract, setContract] = useState<OFT | null>(null);
  const [tokenMeta, setTokenMeta] = useState({ name: "", symbol: "", decimals: 18 });

  const [dst, setDst] = useState<number>(101);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [adapterParamsHex, setAdapterParamsHex] = useState("0x");
  const [useZro, setUseZro] = useState(false);

  const [nativeFee, setNativeFee] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAddress = (a: string) => { try { return ethers.isAddress(a); } catch { return false; } };

  // connect wallet
  async function connectWallet() {
    if (!(window as any).ethereum) return alert("MetaMask tidak ditemukan.");
    const p = new ethers.BrowserProvider((window as any).ethereum, "any");
    await p.send("eth_requestAccounts", []);
    const s = await p.getSigner();
    const addr = await s.getAddress();
    const n = await p.getNetwork();
    setProvider(p); setSigner(s); setAccount(addr); setChainId(Number(n.chainId));
  }

  // listener accounts/chain
  useEffect(() => {
    if (!(window as any).ethereum) return;
    const accChanged = async (accs: string[]) => {
      setAccount(accs?.[0] || null);
      if (provider) setSigner(await provider.getSigner());
    };
    const chainChanged = async () => {
      const n = await provider?.getNetwork();
      setChainId(n ? Number(n.chainId) : null);
    };
    (window as any).ethereum.on?.("accountsChanged", accChanged);
    (window as any).ethereum.on?.("chainChanged", chainChanged);
    return () => {
      (window as any).ethereum?.removeListener?.("accountsChanged", accChanged);
      (window as any).ethereum?.removeListener?.("chainChanged", chainChanged);
    };
  }, [provider]);

  // load kontrak
  async function loadContract() {
    if (!provider) return alert("Connect wallet dulu.");
    if (!isAddress(contractAddr)) return alert("Alamat kontrak tidak valid.");
    const c = getOFT(contractAddr, provider);
    setContract(c);

    let decimals = 18, name = "", symbol = "";
    try { decimals = Number(await c.decimals()); } catch {}
    try { name = await c.name(); } catch {}
    try { symbol = await c.symbol(); } catch {}
    setTokenMeta({ name, symbol, decimals });
    alert(`Kontrak dimuat: ${name} (${symbol})`);
  }

  // estimate fee
  async function doEstimate() {
    if (!contract) return alert("Kontrak belum dimuat.");
    if (!recipient || !isAddress(recipient)) return alert("Recipient tidak valid.");
    if (!amount || Number(amount) <= 0) return alert("Amount harus > 0.");

    const amtWei = ethers.parseUnits(amount, tokenMeta.decimals || 18);
    const res = await contract.estimateSendFee(dst, recipient, amtWei, useZro, adapterParamsHex || "0x");
    setNativeFee(res?.[0]?.toString?.() || null);
  }

  // bridge
  async function doBridge() {
    if (!signer) return alert("Wallet belum connect.");
    if (!contract) return alert("Kontrak belum dimuat.");
    if (!recipient || !isAddress(recipient)) return alert("Recipient tidak valid.");
    if (!amount || Number(amount) <= 0) return alert("Amount harus > 0.");

    const cWrite = getOFT(contractAddr, signer);
    const from = await signer.getAddress();
    const amtWei = ethers.parseUnits(amount, tokenMeta.decimals || 18);
    const refund = from;
    const zro = ethers.ZeroAddress;

    let value = nativeFee ? BigInt(nativeFee) : 0n;
    if (value === 0n) {
      try {
        const res = await contract.estimateSendFee(dst, recipient, amtWei, useZro, adapterParamsHex || "0x");
        value = BigInt(res?.[0] || 0n);
      } catch {}
    }

    setBusy(true);
    const tx = await cWrite.sendFrom(
      from, dst, recipient, amtWei, refund, zro, adapterParamsHex || "0x", { value }
    );
    alert("Tx dikirim: " + tx.hash);
    await tx.wait();
    alert("Tx confirmed.");
    setBusy(false);
  }

  const dstLabel = useMemo(() => LZ_CHAINS.find(c => c.eid === Number(dst))?.label || "-", [dst]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-white shadow-sm">
        <div className="max-w-5xl mx-auto flex justify-between items-center p-4">
          <h1 className="text-xl font-bold">🌉 LZ Bridge UI</h1>
          {!account ? (
            <button
              onClick={connectWallet}
              className="rounded-lg bg-black px-4 py-2 text-white hover:opacity-90"
            >
              Connect Wallet
            </button>
          ) : (
            <span className="text-sm text-gray-600">
              {account.slice(0,6)}…{account.slice(-4)} | chainId: {chainId}
            </span>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-6 space-y-6">
        {/* Load kontrak */}
        <section className="bg-white rounded-xl shadow p-5">
          <h2 className="text-lg font-semibold">1) Load Kontrak OFT</h2>
          <div className="mt-3 flex gap-3">
            <input
              className="flex-1 rounded-lg border px-3 py-2"
              placeholder="0x... alamat kontrak"
              value={contractAddr}
              onChange={(e) => setContractAddr(e.target.value)}
            />
            <button
              onClick={loadContract}
              className="rounded-lg bg-gray-800 px-4 py-2 text-white hover:opacity-90"
            >
              Load
            </button>
          </div>
          {contract && (
            <div className="mt-4 text-sm text-gray-700">
              Token: <b>{tokenMeta.name} ({tokenMeta.symbol})</b> | Decimals: {tokenMeta.decimals}
            </div>
          )}
        </section>

        {/* Bridge */}
        <section className="bg-white rounded-xl shadow p-5">
          <h2 className="text-lg font-semibold">2) Bridge</h2>
          <div className="grid md:grid-cols-2 gap-4 mt-3">
            <div>
              <label className="text-sm">Chain Tujuan</label>
              <select
                className="w-full rounded-lg border px-3 py-2 mt-1"
                value={dst}
                onChange={(e) => setDst(Number(e.target.value))}
              >
                {LZ_CHAINS.map(c => (
                  <option key={c.eid} value={c.eid}>{c.label} (EID {c.eid})</option>
                ))}
              </select>
              <div className="text-xs text-gray-500 mt-1">Terpilih: {dstLabel}</div>
            </div>
            <div>
              <label className="text-sm">Recipient</label>
              <input
                className="w-full rounded-lg border px-3 py-2 mt-1"
                placeholder="0x..."
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm">Amount</label>
              <input
                type="number"
                className="w-full rounded-lg border px-3 py-2 mt-1"
                placeholder="1.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm">Adapter Params (hex)</label>
              <input
                className="w-full rounded-lg border px-3 py-2 mt-1"
                placeholder="0x"
                value={adapterParamsHex}
                onChange={(e) => setAdapterParamsHex(e.target.value)}
              />
              <label className="flex items-center gap-2 mt-2 text-sm">
                <input type="checkbox" checked={useZro} onChange={(e) => setUseZro(e.target.checked)} />
                Use ZRO payment
              </label>
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              onClick={doEstimate}
              className="rounded-lg bg-gray-800 px-4 py-2 text-white hover:opacity-90"
            >
              Estimate Fee
            </button>
            <button
              onClick={doBridge}
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Bridging..." : "Bridge"}
            </button>
          </div>

          {nativeFee && (
            <div className="mt-4 text-sm bg-green-50 p-3 rounded-lg">
              Fee Estimate: {nativeFee} wei
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
