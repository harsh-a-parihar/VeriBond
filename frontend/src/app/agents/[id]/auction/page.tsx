'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { AGENT_TOKEN_FACTORY, USDC } from '@/lib/contracts';
import { AGENT_TOKEN_FACTORY_ABI, CCA_ABI } from '@/lib/abis';
import { formatUnits, parseUnits } from 'viem';
import { Loader2, TrendingUp, Wallet, Clock, CheckCircle, ArrowLeft, Activity, Gavel } from 'lucide-react';

const ERC20_ABI = [
    {
        name: 'approve',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
        outputs: [{ type: 'bool' }],
    },
    {
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
        outputs: [{ type: 'uint256' }],
    }
] as const;

export default function AuctionPage() {
    const params = useParams();
    const router = useRouter();
    const { address } = useAccount();
    const agentId = params.id ? BigInt(params.id as string) : undefined;

    // 1. Get Auction Address from Factory
    const { data: auctionAddress, isLoading: isAddressLoading } = useReadContract({
        address: AGENT_TOKEN_FACTORY,
        abi: AGENT_TOKEN_FACTORY_ABI,
        functionName: 'getAgentAuction',
        args: agentId ? [agentId] : undefined,
    });

    const { data: tokenAddress } = useReadContract({
        address: AGENT_TOKEN_FACTORY,
        abi: AGENT_TOKEN_FACTORY_ABI,
        functionName: 'getAgentToken',
        args: agentId ? [agentId] : undefined,
    });

    // 2. Read Auction State
    const { data: clearingPrice, refetch: refetchPrice } = useReadContract({
        address: auctionAddress,
        abi: CCA_ABI,
        functionName: 'clearingPrice',
        args: [],
        query: { enabled: !!auctionAddress }
    });

    const { data: totalCleared, refetch: refetchCleared } = useReadContract({
        address: auctionAddress,
        abi: CCA_ABI,
        functionName: 'totalCleared',
        args: [],
        query: { enabled: !!auctionAddress }
    });

    // 3. User Interaction State
    const [bidAmount, setBidAmount] = useState('100');
    const [maxPrice, setMaxPrice] = useState('1.0');
    const [isApproveMode, setIsApproveMode] = useState(true);

    // 4. Contract Writes
    const { writeContract: writeApprove, data: approveHash, isPending: isApprovePending } = useWriteContract();
    const { writeContract: writeBid, data: bidHash, isPending: isBidPending, error: bidError } = useWriteContract();

    // 5. Transaction Receipts
    const { isSuccess: isApproveSuccess, isLoading: isApproveConfirming } = useWaitForTransactionReceipt({ hash: approveHash });
    const { isSuccess: isBidSuccess, isLoading: isBidConfirming } = useWaitForTransactionReceipt({ hash: bidHash });

    useEffect(() => {
        if (isApproveSuccess) setIsApproveMode(false);
        if (isBidSuccess) {
            setBidAmount('');
            refetchPrice();
            refetchCleared();
        }
    }, [isApproveSuccess, isBidSuccess]);

    const handleApprove = () => {
        if (!auctionAddress) return;
        writeApprove({
            address: USDC as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [auctionAddress, parseUnits(bidAmount, 6)],
        });
    };

    const handleBid = () => {
        if (!auctionAddress || !address) return;
        writeBid({
            address: auctionAddress,
            abi: CCA_ABI,
            functionName: 'submitBid',
            args: [
                parseUnits(maxPrice, 6),
                parseUnits(bidAmount, 6),
                address,
                BigInt(0),
                "0x"
            ],
        });
    };

    if (isAddressLoading) {
        return <div className="flex h-screen items-center justify-center bg-[#050505] text-zinc-500 font-mono"><Loader2 className="animate-spin mr-2" /> Loading Auction...</div>;
    }

    if (!auctionAddress || auctionAddress === '0x0000000000000000000000000000000000000000') {
        return (
            <div className="min-h-screen bg-[#050505] p-12 text-zinc-200 font-mono flex flex-col items-center">
                <Clock className="mb-4 text-zinc-600" />
                <h1 className="text-xl font-bold text-zinc-400">Auction Not Started</h1>
                <p className="text-zinc-500 mt-2">This agent has not launched a token auction yet.</p>
                <button onClick={() => router.push('/dashboard')} className="mt-8 text-xs underline text-zinc-500 hover:text-white">Return Home</button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#050505] text-zinc-200 font-sans selection:bg-teal-900/30 p-6 md:p-12">
            <div className="max-w-5xl mx-auto space-y-8">

                {/* Header */}
                <div className="flex justify-between items-start">
                    <div>
                        <button onClick={() => router.back()} className="text-xs font-mono text-zinc-500 hover:text-white mb-4 flex items-center gap-2">
                            <ArrowLeft size={12} /> Back
                        </button>
                        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
                            CCA Auction <span className="px-2 py-0.5 rounded bg-blue-900/20 border border-blue-900/50 text-blue-500 text-[10px] uppercase font-mono tracking-wider">Live</span>
                        </h1>
                        <p className="text-sm font-mono text-zinc-500 mt-1">
                            Contract: {auctionAddress}
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="text-xs text-zinc-500 uppercase tracking-wider font-bold">Clearing Price</p>
                        <p className="text-3xl font-bold font-mono text-white mt-1">
                            {clearingPrice ? formatUnits(clearingPrice, 6) : '---'} <span className="text-lg text-zinc-600">USDC</span>
                        </p>
                    </div>
                </div>

                <div className="grid md:grid-cols-2 gap-8">

                    {/* Bidding Card */}
                    <div className="border border-white/5 bg-[#0a0a0a] rounded-lg overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-white/5 bg-zinc-900/20 flex justify-between items-center">
                            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Place Bid</h2>
                            <Gavel size={14} className="text-zinc-600" />
                        </div>
                        <div className="p-6 space-y-6 flex-1">
                            <div className="space-y-2">
                                <label className="text-xs text-zinc-400 font-medium">Bid Amount (USDC)</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        className="w-full bg-[#050505] border border-zinc-800 rounded px-3 py-3 text-lg text-white font-mono focus:outline-none focus:border-blue-900/50 focus:ring-1 focus:ring-blue-900/50 transition-colors placeholder-zinc-800"
                                        value={bidAmount}
                                        onChange={e => setBidAmount(e.target.value)}
                                        placeholder="0.00"
                                    />
                                    <span className="absolute right-4 top-4 text-xs font-bold text-zinc-600">USDC</span>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs text-zinc-400 font-medium">Max Willingness to Pay</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        className="w-full bg-[#050505] border border-zinc-800 rounded px-3 py-3 text-lg text-white font-mono focus:outline-none focus:border-blue-900/50 focus:ring-1 focus:ring-blue-900/50 transition-colors placeholder-zinc-800"
                                        value={maxPrice}
                                        onChange={e => setMaxPrice(e.target.value)}
                                        placeholder="0.00"
                                    />
                                    <span className="absolute right-4 top-4 text-xs font-bold text-zinc-600">USDC / Token</span>
                                </div>
                                <p className="text-[10px] text-zinc-600 bg-zinc-900/50 p-2 rounded">
                                    You will only pay the uniform clearing price, which is ≤ your max price.
                                </p>
                            </div>

                            {bidError && (
                                <div className="p-3 border border-red-900/50 bg-red-950/10 rounded flex items-start gap-2">
                                    <Activity className="text-red-500 h-4 w-4 mt-0.5 shrink-0" />
                                    <p className="text-xs text-red-400 font-mono break-all">{bidError.message.split('\n')[0]}</p>
                                </div>
                            )}

                            {isBidSuccess && (
                                <div className="p-3 border border-green-900/50 bg-green-950/10 rounded flex items-center gap-2">
                                    <CheckCircle className="text-green-500 h-4 w-4 shrink-0" />
                                    <p className="text-xs text-green-400 font-bold">Bid Submitted Successfully</p>
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t border-white/5 bg-zinc-900/10">
                            {isApproveMode ? (
                                <button
                                    onClick={handleApprove}
                                    disabled={!bidAmount || isApprovePending || isApproveConfirming}
                                    className="w-full py-3 bg-zinc-200 hover:bg-white text-black font-bold uppercase tracking-wider text-xs rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {isApprovePending || isApproveConfirming ? <Loader2 className="animate-spin h-3 w-3" /> : <Wallet className="h-3 w-3" />}
                                    Approve USDC
                                </button>
                            ) : (
                                <button
                                    onClick={handleBid}
                                    disabled={!bidAmount || !maxPrice || isBidPending || isBidConfirming}
                                    className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase tracking-wider text-xs rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {isBidPending || isBidConfirming ? <Loader2 className="animate-spin h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                                    Submit Bid
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Stats Card */}
                    <div className="space-y-6">
                        <div className="border border-white/5 bg-[#0a0a0a] rounded-lg overflow-hidden">
                            <div className="p-4 border-b border-white/5 bg-zinc-900/20">
                                <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Auction Stats</h2>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="flex justify-between items-center py-2 border-b border-white/5">
                                    <span className="text-xs text-zinc-500">Tokens Sold</span>
                                    <span className="font-mono text-zinc-200">{totalCleared ? formatUnits(totalCleared, 18) : '0'}</span>
                                </div>
                                <div className="flex justify-between items-center py-2 border-b border-white/5">
                                    <span className="text-xs text-zinc-500">Token Contract</span>
                                    <span className="font-mono text-xs text-zinc-400">{tokenAddress?.slice(0, 10)}...{tokenAddress?.slice(-8)}</span>
                                </div>
                                <div className="flex justify-between items-center py-2 border-b border-white/5">
                                    <span className="text-xs text-zinc-500">Status</span>
                                    <span className="text-[10px] font-bold uppercase text-teal-500">Open for Bidding</span>
                                </div>
                            </div>
                        </div>

                        <div className="p-4 rounded-lg border border-blue-900/20 bg-blue-950/5">
                            <h4 className="font-medium text-xs mb-2 flex items-center gap-2 text-blue-400 font-mono">
                                <Clock className="h-3 w-3" /> About Continuous Clearing
                            </h4>
                            <p className="text-[10px] text-zinc-500 leading-relaxed">
                                Unlike traditional auctions, CCA discovers a price continuously with every block.
                                Bids are filled from highest to lowest. The clearing price adjusts dynamically based on demand.
                                This ensures fair price discovery and prevents front-running.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
