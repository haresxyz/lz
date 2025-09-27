import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

// ABI minimal OFT
const MINIMAL_OFT_ABI = [
  "function estimateSendFee(uint16 _dstChainId, bytes _toAddress, uint _amount, bool _useZro, bytes _adapterParams) view returns (uint nativeFee, uint zroFee)",
  "function sendFrom(address _from, uint16 _dstChainId, bytes _toAddress, uint _amount, address payable _refundAddress, address _zroPaymentAddress, bytes _adapterParams) external payable",
  "function lzReceive(uint16 _srcChainId, bytes _srcAddress, uint64 _nonce, bytes _payload) external",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)"
] as const;

// EID populer LayerZero
const LZ_CHAINS = [
  { label: "Ethereum", eid: 101 },
  { label: "BSC", eid: 102 },
  { label: "Avalanche", eid: 106 },
  { label: "Polygon", eid: 109 },
  { label: "Arbitrum One", eid: 110 },
  { label: "Optimism", eid: 111 },
  { label: "Base", eid: 112 },
  { label: "Linea", eid: 115 }
];

export default function App() {
  const [prov, setProv] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  const [contractAddr, setContractAddr] = useState("");
  const [contract, setContract] = useState<ethers.Contract | null>(null);
  const [token, setToken] = useState({ name: "", symbol: "", decimals: 18 });
  const [flags, setFlags] = useState({ estimate: false, sendFrom: false });

  const [dst, setDst] = useState<number>(LZ_CHAINS[0].eid);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [adapterParamsHex, setAdapterParamsHex] = useState("0x");
  const [useZro, setUseZro] = useState(false);

  const [nativeFee, setNativeFee] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAddress = (a: string) => { try { return ethers.isAddress(a); } catch { return false; } };

  async function connectWallet() {
    if (!(window as any).ethereum) return alert("MetaMask tidak ditemukan.");
    const p = new ethers.BrowserProvider((window as any).ethereum, "any");
    await p.send("eth_requestAccounts", []);
    const s = await p.getSigner();
    setProv(p); setSigner(s);
    setAccount(await s.getAddress());
    const n = await p.getNetwork(); setChainId(Number(n.chainId));
  }

  useEffect(() => {
    if (!(window as any).ethereum) return;
    const onAcc = async (accs: string[]) => {
      setAccount(accs?.[0] || null);
      if (prov) setSigner(await prov.getSigner());
    };
    const onCh = async () => {
      const n = await prov?.getNetwork();
      setChainId(n ? Number(n.chainId) : null);
    };
    (window as any).ethereum.on?.("accountsChanged", onAcc);
    (window as any).ethereum.on?.("chainChanged", onCh);
    return () => {
      (window as any).ethereum?.removeListener?.("accountsChanged", onAcc);
      (window as any).ethereum?.removeListener?.("chainChanged", onCh);
    };
  }, [prov]);

  async function loadContract() {
    if (!prov) return alert("Connect wallet dulu.");
    if (!isAddress(contractAddr)) return alert("Alamat kontrak tidak valid.");
    const c = new ethers.Contract(contractAddr, MINIMAL_OFT_ABI, prov);
    setContract(c);

    // deteksi ringan
    let estimate = false, sendFrom = false;
    try { const r = await c.estimateSendFee(101, "0x" + "00".repeat(20), 1, false, "0x"); if (r) estimate = true; } catch {}
    try { if (c.interface.getFunction("sendFrom")) sendFrom = true; } catch {}
    setFlags({ estimate, sendFrom });

    let decimals = 18, name = "", symbol = "";
    try { decimals = Number(await c.decimals()); } catch {}
    try { name = await c.name(); } catch {}
    try { symbol = await c.symbol(); } catch {}
    setToken({ name, symbol, decimals });

    alert("Kontrak dimuat.");
  }

  async function doEstimate() {
    if (!contract) return alert("Kontrak belum dimuat.");
    if (!recipient || !isAddress(recipient)) return alert("Recipient tidak valid.");
    if (!amount || Number(amount) <= 0) return alert("Amount harus > 0.");
    if (!flags.estimate) return alert("Kontrak tidak expose estimateSendFee.");
    const amtWei = ethers.parseUnits(amount, token.decimals || 18);
    const res = await contract.estimateSendFee(Number(dst), recipient, amtWei, Boolean(useZro), adapterParamsHex || "0x");
    setNativeFee(res?.[0]?.toString?.() || null);
  }

  async function doBridge() {
    if (!signer) return alert("Wallet belum connect.");
    if (!contract) return alert("Kontrak belum dimuat.");
    if (!flags.sendFrom) return alert("Kontrak tidak expose sendFrom.");
    if (!recipient || !isAddress(recipient)) return alert("Recipient tidak valid.");
    if (!amount || Number(amount) <= 0) return alert("Amount harus > 0.");

    const from = await signer.getAddress();
    const amtWei = ethers.parseUnits(amount, token.decimals || 18);
    let value = nativeFee ? BigInt(nativeFee) : 0n;
    if (value === 0n) {
      try {
        const r = await contract.estimateSendFee(Number(dst), recipient, amtWei, Boolean(useZro), adapterParamsHex || "0x");
        value = BigInt(r?.[0] || 0n);
      } catch {}
    }

    setBusy(true);
    const tx = await contract.connect(signer).sendFrom(
      from, Number(dst), recipient, amtWei, from, ethers.ZeroAddress, adapterParamsHex || "0x",
      { value }
    );
    alert("Tx dikirim: " + tx.hash);
    await tx.wait();
    alert("Tx confirmed.");
    setBusy(false);
  }

  const dstLabel = useMemo(() => LZ_CHAINS.find(c => c.eid === Number(dst))?.label || "-", [dst]);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 20, fontFamily: "Inter, system-ui, Arial" }}>
      <h1>LayerZero OFT Bridge (Basic)</h1>
      <p style={{ color: "#666" }}>Connect wallet → Load kontrak → pilih tujuan & amount → Estimate → Bridge.</p>

      <hr />
      <h3>1) Wallet</h3>
      {account
        ? <p>Connected: <b>{account}</b> (chainId: {chainId})</p>
        : <button onClick={connectWallet}>Connect Wallet</button>}

      <h3>2) Load Kontrak</h3>
      <input style={{ width: "100%" }} placeholder="0x... (alamat kontrak OFT / adapter)" value={contractAddr} onChange={e => setContractAddr(e.target.value)} />
      <button onClick={loadContract} style={{ marginTop: 8 }}>Load</button>
      {contract && (
        <p>Token: {token.name || "-"} ({token.symbol || "-"}) · decimals: {token.decimals} · estimate: {String(flags.estimate)} · sendFrom: {String(flags.sendFrom)}</p>
      )}

      <h3>3) Bridge</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label>Destination (EID)</label>
          <select style={{ width: "100%", marginTop: 6 }} value={dst} onChange={e => setDst(Number(e.target.value))}>
            {LZ_CHAINS.map(c => <option key={c.eid} value={c.eid}>{c.label} (EID {c.eid})</option>)}
          </select>
          <div style={{ color:"#666", fontSize:12 }}>Terpilih: {dstLabel}</div>
        </div>
        <div>
          <label>Recipient (EVM)</label>
          <input style={{ width: "100%", marginTop: 6 }} placeholder="0x..." value={recipient} onChange={e => setRecipient(e.target.value)} />
        </div>
        <div>
          <label>Amount ({token.symbol || "token"})</label>
          <input style={{ width: "100%", marginTop: 6 }} type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} />
        </div>
        <div>
          <label>Adapter Params (hex)</label>
          <input style={{ width: "100%", marginTop: 6 }} placeholder="0x" value={adapterParamsHex} onChange={e => setAdapterParamsHex(e.target.value)} />
          <label style={{ display: "inline-flex", gap: 6, marginTop: 8 }}>
            <input type="checkbox" checked={useZro} onChange={e => setUseZro(e.target.checked)} />
            Use ZRO payment (jika didukung)
          </label>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={doEstimate}>Estimate Fee</button>
        <button onClick={doBridge} disabled={busy}>{busy ? "Bridging..." : "Bridge (sendFrom)"}</button>
      </div>

      {nativeFee && (
        <div style={{ marginTop: 12, background: "#f6f6f6", padding: 10, borderRadius: 8 }}>
          <b>Fee (estimate):</b> nativeFee (wei) = {nativeFee}
        </div>
      )}

      <div style={{ marginTop: 12, color: "#a00" }}>
        ⚠️ Pastikan kontrak adalah OFT/adapter LayerZero, EID benar, dan uji kecil/testnet dulu.
      </div>
    </div>
  );
}
