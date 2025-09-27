import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

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

const LZ_CHAINS = [
  { label: "Ethereum", eid: 101 },
  { label: "BSC", eid: 102 },
  { label: "Avalanche", eid: 106 },
  { label: "Polygon", eid: 109 },
  { label: "Arbitrum", eid: 110 },
  { label: "Optimism", eid: 111 },
  { label: "Base", eid: 112 },
];

export default function App() {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [account, setAccount] = useState<string | null>(null);

  const [contractAddr, setContractAddr] = useState("");
  const [contract, setContract] = useState<OFT | null>(null);
  const [tokenMeta, setTokenMeta] = useState({ name: "", symbol: "", decimals: 18 });

  const [dst, setDst] = useState<number>(101);
  const [recipient, setRecipient] = useState(""); // akan auto isi saat wallet connect
  const [amount, setAmount] = useState("");

  const [nativeFee, setNativeFee] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connectWallet() {
    if (!(window as any).ethereum) {
      alert("MetaMask tidak ditemukan.");
      return;
    }
    const p = new ethers.BrowserProvider((window as any).ethereum, "any");
    await p.send("eth_requestAccounts", []);
    const s = await p.getSigner();
    const addr = await s.getAddress();
    setProvider(p);
    setSigner(s);
    setAccount(addr);

    // otomatis isi recipient dengan address wallet yang connect
    setRecipient(addr);
  }

  async function loadContract() {
    if (!provider) return alert("Connect wallet dulu.");
    const c = getOFT(contractAddr, provider);
    setContract(c);
    try {
      setTokenMeta({
        name: await c.name(),
        symbol: await c.symbol(),
        decimals: Number(await c.decimals()),
      });
    } catch {}
  }

  async function doEstimate() {
    if (!contract) return alert("Kontrak belum dimuat.");
    const amtWei = ethers.parseUnits(amount || "0", tokenMeta.decimals);
    const res = await contract.estimateSendFee(dst, recipient, amtWei, false, "0x");
    setNativeFee(res?.[0]?.toString?.() || null);
  }

  async function doBridge() {
    if (!signer || !contract) return;
    const cWrite = getOFT(contractAddr, signer);
    const from = await signer.getAddress();
    const amtWei = ethers.parseUnits(amount, tokenMeta.decimals);
    const fee = nativeFee ? BigInt(nativeFee) : 0n;
    setBusy(true);
    const tx = await cWrite.sendFrom(
      from,
      dst,
      recipient,
      amtWei,
      from,
      ethers.ZeroAddress,
      "0x",
      { value: fee }
    );
    alert("Tx dikirim: " + tx.hash);
    await tx.wait();
    alert("Tx confirmed!");
    setBusy(false);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
      <div className="bg-white shadow-xl rounded-2xl p-6 w-full max-w-lg space-y-5">
        <h1 className="text-2xl font-bold">🌉 LayerZero Bridge</h1>

        {!account ? (
          <button
            onClick={connectWallet}
            className="w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Connect Wallet
          </button>
        ) : (
          <div className="p-3 bg-green-50 rounded-lg text-sm text-green-700">
            ✅ Connected: {account.slice(0, 6)}…{account.slice(-4)}
          </div>
        )}

        <div>
          <label className="text-sm">Contract Address</label>
          <input
            className="w-full border rounded-lg px-3 py-2 mt-1"
            placeholder="0x..."
            value={contractAddr}
            onChange={(e) => setContractAddr(e.target.value)}
          />
          <button
            onClick={loadContract}
            className="mt-2 w-full py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900"
          >
            Load Contract
          </button>
        </div>

        <div>
          <label className="text-sm">Destination Chain</label>
          <select
            className="w-full border rounded-lg px-3 py-2 mt-1"
            value={dst}
            onChange={(e) => setDst(Number(e.target.value))}
          >
            {LZ_CHAINS.map((c) => (
              <option key={c.eid} value={c.eid}>
                {c.label} (EID {c.eid})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm">Recipient</label>
          <input
            className="w-full border rounded-lg px-3 py-2 mt-1"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
          <p className="text-xs text-gray-500">
            otomatis isi dengan wallet yang connect
          </p>
        </div>

        <div>
          <label className="text-sm">Amount</label>
          <input
            className="w-full border rounded-lg px-3 py-2 mt-1"
            placeholder="1.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={doEstimate}
            className="flex-1 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900"
          >
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
      </div>
    </div>
  );
}
