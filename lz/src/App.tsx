import { useState } from "react";
import { ethers } from "ethers";

const MINIMAL_OFT_ABI = [
  "function estimateSendFee(uint16 _dstChainId, bytes _toAddress, uint _amount, bool _useZro, bytes _adapterParams) view returns (uint nativeFee, uint zroFee)",
  "function sendFrom(address _from, uint16 _dstChainId, bytes _toAddress, uint _amount, address payable _refundAddress, address _zroPaymentAddress, bytes _adapterParams) external payable",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)"
] as const;

const CHAIN_CONFIG: Record<number, any> = {
  1: { chainId: "0x1", chainName: "Ethereum", rpcUrls: ["https://rpc.ankr.com/eth"] },
  56: { chainId: "0x38", chainName: "BSC", rpcUrls: ["https://bsc-dataseed.binance.org/"] },
  137: { chainId: "0x89", chainName: "Polygon", rpcUrls: ["https://polygon-rpc.com/"] },
  42161: { chainId: "0xa4b1", chainName: "Arbitrum One", rpcUrls: ["https://arb1.arbitrum.io/rpc"] },
  10: { chainId: "0xa", chainName: "Optimism", rpcUrls: ["https://mainnet.optimism.io"] },
  8453: { chainId: "0x2105", chainName: "Base", rpcUrls: ["https://mainnet.base.org"] },
};

const LZ_CHAINS = [
  { label: "Ethereum", eid: 101, chainId: 1 },
  { label: "BSC", eid: 102, chainId: 56 },
  { label: "Polygon", eid: 109, chainId: 137 },
  { label: "Arbitrum", eid: 110, chainId: 42161 },
  { label: "Optimism", eid: 111, chainId: 10 },
  { label: "Base", eid: 112, chainId: 8453 },
];

const getOFT = (addr: string, providerOrSigner: any) =>
  new ethers.Contract(addr, MINIMAL_OFT_ABI, providerOrSigner);

export default function App() {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  const [srcChain, setSrcChain] = useState<number>(56); // default BSC
  const [dst, setDst] = useState<number>(101);
  const [contractAddr, setContractAddr] = useState("");
  const [contract, setContract] = useState<any>(null);

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [nativeFee, setNativeFee] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connectWallet() {
    if (!(window as any).ethereum) {
      alert("MetaMask tidak ditemukan.");
      return;
    }
    const p = new ethers.BrowserProvider((window as any).ethereum, "any");
    const accounts = await p.send("eth_requestAccounts", []);
    const s = await p.getSigner();
    const addr = accounts[0];
    const n = await p.getNetwork();

    setProvider(p);
    setSigner(s);
    setAccount(addr);
    setChainId(Number(n.chainId));
    setRecipient(addr);
  }

  async function switchNetwork(target: number) {
    if (!(window as any).ethereum) return;
    try {
      await (window as any).ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_CONFIG[target].chainId }],
      });
      setChainId(target);
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        // Chain belum ada → add dulu
        await (window as any).ethereum.request({
          method: "wallet_addEthereumChain",
          params: [CHAIN_CONFIG[target]],
        });
      } else {
        console.error("Switch error:", switchError);
      }
    }
  }

  async function loadContract() {
    if (!provider) return alert("Connect wallet dulu.");
    const c = getOFT(contractAddr, provider);
    setContract(c);
  }

  async function doEstimate() {
    if (!contract) return alert("Load kontrak dulu.");
    try {
      const decimals = await contract.decimals();
      const amtWei = ethers.parseUnits(amount || "0", decimals);
      const res = await contract.estimateSendFee(dst, recipient, amtWei, false, "0x");
      setNativeFee(res?.[0]?.toString?.() || null);
    } catch (err) {
      console.error("Estimate error:", err);
    }
  }

  async function doBridge() {
    if (!signer || !contract) return;
    if (chainId !== srcChain) {
      alert("Switching network...");
      await switchNetwork(srcChain);
      return;
    }
    try {
      const decimals = await contract.decimals();
      const amtWei = ethers.parseUnits(amount, decimals);
      const fee = nativeFee ? BigInt(nativeFee) : 0n;
      setBusy(true);
      const tx = await contract.connect(signer).sendFrom(
        account,
        dst,
        recipient,
        amtWei,
        account,
        ethers.ZeroAddress,
        "0x",
        { value: fee }
      );
      alert("Tx hash: " + tx.hash);
      await tx.wait();
      alert("Confirmed!");
    } catch (err: any) {
      console.error("Bridge error:", err);
      alert("Bridge error: " + err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
      <div className="bg-white shadow-xl rounded-2xl p-6 w-full max-w-lg space-y-5">
        <h1 className="text-2xl font-bold">🌉 LayerZero Bridge</h1>

        {!account ? (
          <button onClick={connectWallet} className="w-full py-2 bg-indigo-600 text-white rounded-lg">
            Connect Wallet
          </button>
        ) : (
          <div className="p-3 bg-green-50 rounded-lg text-sm text-green-700">
            ✅ Connected: {account.slice(0, 6)}…{account.slice(-4)} | chainId: {chainId}
          </div>
        )}

        <div>
          <label className="text-sm">Source Chain</label>
          <select className="w-full border rounded-lg px-3 py-2 mt-1"
            value={srcChain}
            onChange={(e) => setSrcChain(Number(e.target.value))}
          >
            {LZ_CHAINS.map((c) => (
              <option key={c.chainId} value={c.chainId}>{c.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm">Destination Chain</label>
          <select className="w-full border rounded-lg px-3 py-2 mt-1"
            value={dst}
            onChange={(e) => setDst(Number(e.target.value))}
          >
            {LZ_CHAINS.map((c) => (
              <option key={c.eid} value={c.eid}>{c.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm">Contract Address</label>
          <input className="w-full border rounded-lg px-3 py-2 mt-1"
            placeholder="0x..."
            value={contractAddr}
            onChange={(e) => setContractAddr(e.target.value)}
          />
          <button onClick={loadContract} className="mt-2 w-full py-2 bg-gray-800 text-white rounded-lg">
            Load Contract
          </button>
        </div>

        <div>
          <label className="text-sm">Recipient</label>
          <input className="w-full border rounded-lg px-3 py-2 mt-1"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm">Amount</label>
          <input className="w-full border rounded-lg px-3 py-2 mt-1"
            placeholder="1.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <button onClick={doEstimate} className="flex-1 py-2 bg-gray-800 text-white rounded-lg">
            Estimate Fee
          </button>
          <button onClick={doBridge} disabled={busy} className="flex-1 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">
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
