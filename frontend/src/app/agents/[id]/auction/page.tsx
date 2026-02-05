'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { AGENT_TOKEN_FACTORY, USDC } from '@/lib/contracts';
import { AGENT_TOKEN_FACTORY_ABI, CCA_ABI } from '@/lib/abis';
import { formatUnits, parseUnits, maxUint160, maxUint48, parseAbiItem } from 'viem';
import { Loader2, TrendingUp, Wallet, Clock, CheckCircle, ArrowLeft, Activity, Gavel } from 'lucide-react';

// Permit2 canonical address (same on all EVM chains)
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;

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

const PERMIT2_ABI = [
    {
        name: 'approve',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'token', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint160' },
            { name: 'expiration', type: 'uint48' }
        ],
        outputs: [],
    },
    {
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            { name: 'owner', type: 'address' },
            { name: 'token', type: 'address' },
            { name: 'spender', type: 'address' }
        ],
        outputs: [
            { name: 'amount', type: 'uint160' },
            { name: 'expiration', type: 'uint48' },
            { name: 'nonce', type: 'uint48' }
        ],
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

    // Read auction timing
    const { data: startBlock } = useReadContract({
        address: auctionAddress,
        abi: [{ name: 'startBlock', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] }] as const,
        functionName: 'startBlock',
        args: [],
        query: { enabled: !!auctionAddress }
    });

    const { data: endBlock } = useReadContract({
        address: auctionAddress,
        abi: [{ name: 'endBlock', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] }] as const,
        functionName: 'endBlock',
        args: [],
        query: { enabled: !!auctionAddress }
    });

    // Log auction timing for debugging
    useEffect(() => {
        if (startBlock && endBlock) {
            console.log('[Auction] Timing:', {
                startBlock: startBlock.toString(),
                endBlock: endBlock.toString(),
                clearingPrice: clearingPrice?.toString()
            });
        }
    }, [startBlock, endBlock, clearingPrice]);

    // 3. User Interaction State
    const [bidAmount, setBidAmount] = useState('100');
    const [maxPrice, setMaxPrice] = useState('1.0');
    const [approvalStep, setApprovalStep] = useState<'erc20' | 'permit2' | 'ready'>('erc20');
    const [lastBidId, setLastBidId] = useState<bigint | null>(null);
    const [userBids, setUserBids] = useState<bigint[]>([]);
    const publicClient = usePublicClient();

    // Read claimBlock to check if claiming is available
    const { data: claimBlock } = useReadContract({
        address: auctionAddress,
        abi: CCA_ABI,
        functionName: 'claimBlock',
        args: [],
        query: { enabled: !!auctionAddress }
    });

    // Fetch user's bids
    useEffect(() => {
        const fetchBids = async () => {
            if (!publicClient || !auctionAddress || !address || !startBlock) return;

            try {
                // Get all bids submitted by user
                const submittedLogs = await publicClient.getLogs({
                    address: auctionAddress,
                    event: parseAbiItem('event BidSubmitted(uint256 indexed bidId, address indexed owner, uint256 maxPrice, uint128 amount)'),
                    args: { owner: address },
                    fromBlock: BigInt(startBlock),
                    toBlock: 'latest'
                });

                // Get all bids exited (claimed) by user
                const exitedLogs = await publicClient.getLogs({
                    address: auctionAddress,
                    event: parseAbiItem('event BidExited(uint256 indexed bidId, address indexed owner, uint256 tokensFilled, uint256 currencyRefunded)'),
                    args: { owner: address },
                    fromBlock: BigInt(startBlock),
                    toBlock: 'latest'
                });

                const exitedBidIds = new Set(exitedLogs.map(log => log.args.bidId!.toString()));

                // Filter out exited bids
                const activeBidIds = submittedLogs
                    .map(log => log.args.bidId!)
                    .filter(id => !exitedBidIds.has(id.toString()))
                    .sort((a, b) => Number(b - a)); // Newest first

                setUserBids(activeBidIds);

                // Auto-select newest bid if no selection and no pending claim
                if (activeBidIds.length > 0 && !lastBidId) {
                    setLastBidId(activeBidIds[0]);
                }
            } catch (err) {
                console.error("Error fetching bids", err);
            }
        };

        const interval = setInterval(fetchBids, 5000); // Poll every 5s
        fetchBids();
        return () => clearInterval(interval);
    }, [publicClient, auctionAddress, address, startBlock, lastBidId]);

    // 4. Contract Writes
    const { writeContractAsync, isPending: isWritePending } = useWriteContract();
    const { writeContract: writeBid, data: bidHash, isPending: isBidPending, error: bidError } = useWriteContract();
    const { writeContract: writeClaim, data: claimHash, isPending: isClaimPending } = useWriteContract();

    // 5. Transaction Receipts
    const { isSuccess: isBidSuccess, isLoading: isBidConfirming } = useWaitForTransactionReceipt({ hash: bidHash });
    const { isSuccess: isClaimSuccess, isLoading: isClaimConfirming } = useWaitForTransactionReceipt({ hash: claimHash });

    useEffect(() => {
        if (isBidSuccess) {
            setBidAmount('');
            refetchPrice();
            refetchCleared();
            // Note: In production, we'd parse the BidSubmitted event to get bidId
        }
    }, [isBidSuccess]);

    // Handle claim tokens
    const handleClaim = async () => {
        if (!auctionAddress || !address || !lastBidId) {
            console.error('[Claim] Missing auctionAddress, address, or bidId');
            return;
        }

        console.log('[Claim] Claiming tokens for bidId:', lastBidId.toString());
        writeClaim({
            address: auctionAddress,
            abi: CCA_ABI,
            functionName: 'claimTokens',
            args: [lastBidId],
        });
    };

    // Multi-step approval flow for Permit2
    const handleApprove = async () => {
        if (!auctionAddress || !publicClient || !address) return;

        try {
            if (approvalStep === 'erc20') {
                // Step 1: Approve USDC to Permit2
                console.log('[Approve] Step 1: Approving USDC to Permit2...');
                const hash = await writeContractAsync({
                    address: USDC as `0x${string}`,
                    abi: ERC20_ABI,
                    functionName: 'approve',
                    args: [PERMIT2_ADDRESS, BigInt(2) ** BigInt(256) - BigInt(1)], // Max approval
                });
                console.log('[Approve] ERC20 approval tx:', hash);
                await publicClient.waitForTransactionReceipt({ hash });
                console.log('[Approve] ERC20 approval confirmed');
                setApprovalStep('permit2');
            }

            if (approvalStep === 'permit2' || approvalStep === 'erc20') {
                // Step 2: Set Permit2 allowance for auction
                console.log('[Approve] Step 2: Setting Permit2 allowance for auction...');
                const hash = await writeContractAsync({
                    address: PERMIT2_ADDRESS,
                    abi: PERMIT2_ABI,
                    functionName: 'approve',
                    args: [
                        USDC as `0x${string}`,
                        auctionAddress,
                        maxUint160,
                        Number(maxUint48)
                    ],
                });
                console.log('[Approve] Permit2 approval tx:', hash);
                await publicClient.waitForTransactionReceipt({ hash });
                console.log('[Approve] Permit2 approval confirmed');
                setApprovalStep('ready');
            }
        } catch (error) {
            console.error('[Approve] Error:', error);
        }
    };

    const handleBid = async () => {
        if (!auctionAddress || !address || !publicClient) return;

        try {
            // CCA expects amounts in currency decimals (USDC = 6)
            const bidAmountParsed = parseUnits(bidAmount, 6);

            // Fetch floorPrice and tickSpacing from the auction contract
            console.log('[Bid] Fetching auction parameters...');
            const [floorPrice, tickSpacing] = await Promise.all([
                publicClient.readContract({
                    address: auctionAddress,
                    abi: CCA_ABI,
                    functionName: 'floorPrice',
                }),
                publicClient.readContract({
                    address: auctionAddress,
                    abi: CCA_ABI,
                    functionName: 'tickSpacing',
                }),
            ]);
            console.log('[Bid] floorPrice:', floorPrice?.toString());
            console.log('[Bid] tickSpacing:', tickSpacing?.toString());

            // Calculate maxPrice as floorPrice + tickSpacing (bid at next possible price tick)
            // Per official docs: "maxPrice MUST be strictly above the current clearing price"
            const maxPriceQ96 = (floorPrice || BigInt(0)) + (tickSpacing || BigInt(0));
            console.log('[Bid] maxPriceQ96 (floorPrice + tickSpacing):', maxPriceQ96.toString());

            console.log('[Bid] Submitting bid:', {
                auctionAddress,
                maxPriceQ96: maxPriceQ96.toString(),
                amount: bidAmountParsed.toString(),
                owner: address
            });

            writeBid({
                address: auctionAddress,
                abi: CCA_ABI,
                functionName: 'submitBid',
                args: [
                    maxPriceQ96,             // maxPrice = floorPrice + tickSpacing
                    bidAmountParsed,         // amount in USDC (6 decimals)
                    address,                 // owner
                    "0x" as `0x${string}`    // hookData (empty)
                ],
            });
        } catch (error) {
            console.error('[Bid] Error:', error);
        }
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

    // Check if auction has ended
    // const isAuctionEnded = endBlock && BigInt(endBlock) < BigInt(Date.now() / 2000 + 37280000); // Rough check
    // Actually check by comparing with current block from the lastBid or approx
    const auctionStatus = endBlock ? (
        startBlock && endBlock ?
            `Blocks ${startBlock.toString()} - ${endBlock.toString()} (Duration: ${Number(endBlock - startBlock)} blocks ≈ ${Math.round(Number(endBlock - startBlock) * 2 / 3600)}h)` :
            'Loading...'
    ) : 'Loading...';

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
                            {approvalStep !== 'ready' ? (
                                <button
                                    onClick={handleApprove}
                                    disabled={!bidAmount || isWritePending}
                                    className="w-full py-3 bg-zinc-200 hover:bg-white text-black font-bold uppercase tracking-wider text-xs rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {isWritePending ? <Loader2 className="animate-spin h-3 w-3" /> : <Wallet className="h-3 w-3" />}
                                    {approvalStep === 'erc20' ? 'Approve USDC (Step 1/2)' : 'Approve Permit2 (Step 2/2)'}
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

                        {/* Claim Tokens Card */}
                        <div className="border border-white/5 bg-[#0a0a0a] rounded-lg overflow-hidden">
                            <div className="p-4 border-b border-white/5 bg-zinc-900/20">
                                <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Claim Tokens</h2>
                            </div>
                            <div className="p-4 space-y-4">
                                <div className="flex justify-between items-center py-2 border-b border-white/5">
                                    <span className="text-xs text-zinc-500">Claim Block</span>
                                    <span className="font-mono text-zinc-200">{claimBlock?.toString() || 'Loading...'}</span>
                                </div>
                                <div className="flex justify-between items-center py-2 border-b border-white/5">
                                    <span className="text-xs text-zinc-500">End Block</span>
                                    <span className="font-mono text-zinc-200">{endBlock?.toString() || 'Loading...'}</span>
                                </div>

                                <div>
                                    <label className="block text-[10px] text-zinc-500 mb-2 uppercase tracking-wider">Select Bid to Claim</label>

                                    {userBids.length > 0 ? (
                                        <div className="relative">
                                            <select
                                                className="w-full bg-zinc-900 border border-white/10 rounded p-3 text-sm font-mono focus:outline-none focus:border-teal-500/50 appearance-none text-zinc-300"
                                                value={lastBidId?.toString() || ''}
                                                onChange={e => setLastBidId(BigInt(e.target.value))}
                                            >
                                                {userBids.map(bidId => (
                                                    <option key={bidId.toString()} value={bidId.toString()}>
                                                        Bid #{bidId.toString()}
                                                    </option>
                                                ))}
                                            </select>
                                            <div className="absolute right-3 top-3.5 pointer-events-none">
                                                <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-3 bg-zinc-900/50 border border-white/5 rounded text-xs text-zinc-500 italic text-center">
                                            No claimable bids found.
                                        </div>
                                    )}

                                    <p className="text-[10px] text-zinc-600 mt-2 flex items-center justify-between">
                                        <span>Check BidSubmitted event</span>
                                        {userBids.length > 0 && <span className="text-teal-500/80">{userBids.length} active bid(s)</span>}
                                    </p>
                                </div>

                                {isClaimSuccess && (
                                    <div className="p-3 border border-green-900/50 bg-green-950/10 rounded flex items-center gap-2">
                                        <CheckCircle className="text-green-500 h-4 w-4 shrink-0" />
                                        <p className="text-xs text-green-400 font-bold">Tokens Claimed Successfully</p>
                                    </div>
                                )}
                            </div>
                            <div className="p-4 border-t border-white/5 bg-zinc-900/10">
                                <button
                                    onClick={handleClaim}
                                    disabled={!lastBidId || isClaimPending || isClaimConfirming}
                                    className="w-full py-3 bg-teal-600 hover:bg-teal-500 text-white font-bold uppercase tracking-wider text-xs rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {isClaimPending || isClaimConfirming ? <Loader2 className="animate-spin h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
                                    Claim Tokens
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
