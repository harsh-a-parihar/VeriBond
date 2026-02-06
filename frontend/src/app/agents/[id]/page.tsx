'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useReadContract, useReadContracts, useBlockNumber } from 'wagmi';
import { IDENTITY_REGISTRY, TRUTH_STAKE, AGENT_TOKEN_FACTORY } from '@/lib/contracts';
import { IDENTITY_REGISTRY_ABI, TRUTH_STAKE_ABI, AGENT_TOKEN_FACTORY_ABI, CCA_ABI } from '@/lib/abis';
import { formatUnits, type Address } from 'viem';
import {
    Shield,
    ShieldCheck,
    AlertTriangle,
    Activity,
    Users,
    Coins,
    ExternalLink,
    Copy,
    Gavel,
    FileText,
    History,
    Wallet,
    MessageSquare
} from 'lucide-react';
import Link from 'next/link';
import AgentMarketPanel from '@/components/AgentMarketPanel';

type AgentMetadata = {
    name?: string;
    description?: string;
    image?: string;
    symbol?: string;
    ticker?: string;
};

type AgentRecord = {
    id: string;
    name?: string;
    description?: string;
    image?: string;
    ticker?: string;
};

type AgentsApiResponse = {
    agents?: AgentRecord[];
};

export default function AgentDetailPage() {
    const params = useParams();
    const agentId = BigInt(params.id as string);
    const [metadata, setMetadata] = useState<AgentMetadata | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'holders' | 'activity' | 'claims'>('overview');

    // 1. Fetch Agent Identity
    const { data: agentWallet } = useReadContract({
        address: IDENTITY_REGISTRY,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'getAgentWallet',
        args: [agentId]
    });

    const { data: tokenURI } = useReadContract({
        address: IDENTITY_REGISTRY,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'tokenURI',
        args: [agentId]
    });

    // 2. Fetch TruthStake Stats
    const { data: accuracyData } = useReadContract({
        address: TRUTH_STAKE,
        abi: TRUTH_STAKE_ABI,
        functionName: 'getAgentAccuracy',
        args: [agentId]
    });

    const { data: totalSlashed } = useReadContract({
        address: TRUTH_STAKE,
        abi: TRUTH_STAKE_ABI,
        functionName: 'agentTotalSlashed',
        args: [agentId]
    });

    const { data: rewardVault } = useReadContract({
        address: TRUTH_STAKE,
        abi: TRUTH_STAKE_ABI,
        functionName: 'agentRewardVault',
        args: [agentId]
    });

    // 3. Fetch Token/Auction Info
    const { data: auctionAddress } = useReadContract({
        address: AGENT_TOKEN_FACTORY,
        abi: AGENT_TOKEN_FACTORY_ABI,
        functionName: 'getAgentAuction',
        args: [agentId]
    });

    const { data: tokenAddress } = useReadContract({
        address: AGENT_TOKEN_FACTORY,
        abi: AGENT_TOKEN_FACTORY_ABI,
        functionName: 'getAgentToken',
        args: [agentId]
    });

    // 4. Fetch Deep Auction Data (if active)
    const { data: auctionData } = useReadContracts({
        contracts: [
            {
                address: auctionAddress,
                abi: CCA_ABI,
                functionName: 'clearingPrice',
            },
            {
                address: auctionAddress,
                abi: CCA_ABI,
                functionName: 'endBlock',
            },
            {
                address: auctionAddress,
                abi: CCA_ABI,
                functionName: 'totalCleared',
            }
        ]
    });

    const { data: startBlock } = useReadContract({
        address: auctionAddress,
        abi: CCA_ABI,
        functionName: 'startBlock',
        args: [],
        query: { enabled: !!auctionAddress }
    });

    // 5. Fetch Metadata (DB First, then IPFS Fallback)
    useEffect(() => {
        const loadMetadata = async () => {
            // Strategy A: Check local DB (Fastest)
            try {
                const res = await fetch('/api/agents');
                if (res.ok) {
                    const data = await res.json() as AgentsApiResponse;
                    const agent = data.agents?.find((a) => a.id === agentId.toString());
                    if (agent) {
                        console.log('[Agent] Found in DB:', agent);
                        setMetadata({
                            name: agent.name,
                            description: agent.description,
                            image: agent.image,
                            symbol: agent.ticker
                        });
                        return; // Found in DB, skip IPFS
                    }
                }
            } catch (e) {
                console.warn('[Agent] DB Fetch failed:', e);
            }

            // Strategy B: IPFS (If not in DB or DB fetch failed)
            if (tokenURI) {
                console.log('[Agent] Fetching from IPFS (DB missed)...', tokenURI);
                const gateways = [
                    'https://ipfs.io/ipfs/',
                    'https://gateway.pinata.cloud/ipfs/',
                    'https://dweb.link/ipfs/'
                ];
                const hash = tokenURI.replace('ipfs://', '');

                for (const gateway of gateways) {
                    try {
                        const url = `${gateway}${hash}`;
                        const res = await fetch(url);
                        if (!res.ok) throw new Error(`Status ${res.status}`);
                        const json = await res.json();
                        setMetadata(json);
                        return;
                    } catch (e) {
                        console.warn(`[Agent] Gateway failed ${gateway}:`, e);
                    }
                }
            }
        };

        loadMetadata();
    }, [agentId, tokenURI]);

    const { data: currentBlock } = useBlockNumber({ watch: true });

    // Derived Metrics
    const correctClaims = accuracyData ? Number(accuracyData[0]) : 0;
    const totalClaims = accuracyData ? Number(accuracyData[1]) : 0;
    const accuracyRate = totalClaims > 0 ? ((correctClaims / totalClaims) * 100).toFixed(1) : '100'; // Default to 100 if new

    // Trust Score Calculation (Simple V1)
    // Base 100, minus 10 per slash, weighed by accuracy
    const slashCount = totalSlashed && totalSlashed > BigInt(0) ? 1 : 0; // Simplified
    const trustScore = Math.max(0, 100 - (slashCount * 20)); // Placeholder logic

    const clearingPrice = auctionData?.[0]?.result;
    const endBlock = auctionData?.[1]?.result;
    const tokensSold = auctionData?.[2]?.result;

    const hasAuction = auctionAddress && auctionAddress !== '0x0000000000000000000000000000000000000000';
    const hasToken = tokenAddress && tokenAddress !== '0x0000000000000000000000000000000000000000';

    const isAuctionActive = hasAuction && currentBlock && endBlock ? currentBlock < endBlock : false;
    const isAuctionEnded = hasAuction && currentBlock && endBlock ? currentBlock >= endBlock : false;
    const auctionAddressValue = auctionAddress as Address | undefined;
    const tokenAddressValue = tokenAddress as Address | undefined;
    const startBlockValue = startBlock as bigint | undefined;

    return (
        <div className="min-h-screen bg-[#050505] text-zinc-200 font-sans selection:bg-teal-900/30 p-6 md:p-12">
            <div className="max-w-6xl mx-auto space-y-8">

                {/* 1. Hero Section */}
                <div className="flex flex-col md:flex-row gap-8 items-start">
                    {/* Avatar */}
                    <div className="w-32 h-32 md:w-40 md:h-40 rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-white/10 shrink-0 overflow-hidden shadow-2xl relative group">
                        {metadata?.image ? (
                            <img src={metadata.image.replace('ipfs://', 'https://ipfs.io/ipfs/')} alt={metadata.name} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-700">
                                <Shield size={48} />
                            </div>
                        )}
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="text-xs font-mono">Agent #{agentId.toString()}</span>
                        </div>
                    </div>

                    {/* Identity Info */}
                    <div className="flex-1 space-y-4">
                        <div className="flex items-center gap-3">
                            <h1 className="text-3xl md:text-5xl font-bold text-white tracking-tight">
                                {metadata?.name || `Agent ${agentId}`}
                            </h1>
                            {hasToken && (
                                <span className="px-3 py-1 bg-blue-900/20 text-blue-400 border border-blue-900/50 rounded-full text-xs font-bold font-mono">
                                    ${metadata?.symbol || 'TOKEN'}
                                </span>
                            )}
                        </div>

                        <p className="text-zinc-400 max-w-2xl leading-relaxed">
                            {metadata?.description || 'No description available for this agent.'}
                        </p>

                        <div className="flex flex-wrap gap-4 pt-2">
                            {/* Trust Badge */}
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-900/10 border border-green-900/30 rounded text-green-400 text-xs font-medium">
                                <ShieldCheck size={14} />
                                <span>Trust Score: {trustScore}/100</span>
                            </div>

                            {/* Wallet Address */}
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-white/5 rounded text-zinc-400 text-xs font-mono group cursor-pointer hover:bg-zinc-800 hover:text-white transition-colors">
                                <WalletIcon className="h-3 w-3" />
                                <span>{agentWallet ? `${agentWallet.slice(0, 6)}...${agentWallet.slice(-4)}` : 'No Wallet'}</span>
                                <Copy size={12} className="ml-1 opacity-50 group-hover:opacity-100" />
                            </div>
                        </div>
                    </div>

                    {/* Action Card */}
                    <div className="w-full md:w-80 p-6 bg-[#0a0a0a] border border-white/5 rounded-xl space-y-4 shadow-xl">
                        {hasAuction ? (
                            <>
                                <div className="flex justify-between items-center pb-4 border-b border-white/5">
                                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                                        {isAuctionActive ? 'Current Price' : 'Final Price'}
                                    </span>
                                    <span className="text-2xl font-bold text-white font-mono">
                                        {clearingPrice ? formatUnits(clearingPrice, 18) : '---'} <span className="text-sm text-zinc-600">USDC</span>
                                    </span>
                                </div>
                                <div className="space-y-3">
                                    <Link href={`/agents/${agentId}/auction`} className="w-full block">
                                        <button className={`w-full py-3 font-bold rounded flex items-center justify-center gap-2 transition-colors ${isAuctionActive ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'}`}>
                                            <Gavel size={16} />
                                            {isAuctionActive ? 'Bid in Auction' : 'View Results / Claim'}
                                        </button>
                                    </Link>
                                    <p className="text-[10px] text-center text-zinc-600">
                                        {isAuctionActive
                                            ? 'Auction is currently live. Discover fair price.'
                                            : 'Auction ended. Tokens distributed at final price.'}
                                    </p>
                                </div>
                            </>
                        ) : (
                            <div className="text-center py-4">
                                <p className="text-sm text-zinc-500 mb-4">Auction not started yet.</p>
                                <Link href={`/agents/${agentId}/launch`}>
                                    <button className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded transition-colors">
                                        Launch Token
                                    </button>
                                </Link>
                            </div>
                        )}
                    </div>
                </div>

                {hasAuction && (
                    <AgentMarketPanel
                        auctionAddress={auctionAddressValue}
                        tokenAddress={tokenAddressValue}
                        startBlock={startBlockValue}
                        isAuctionEnded={!!isAuctionEnded}
                    />
                )}

                {/* 2. Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard
                        label="Accuracy Rate"
                        value={`${accuracyRate}%`}
                        subValue={`${totalClaims} Claims`}
                        icon={<Activity className="text-teal-500" size={16} />}
                    />
                    <StatCard
                        label="Total Slashed"
                        value={`$${totalSlashed ? formatUnits(totalSlashed, 6) : '0'}`}
                        subValue="USDC Penalized"
                        icon={<AlertTriangle className="text-red-500" size={16} />}
                    />
                    <StatCard
                        label="Reward Vault"
                        value={`$${rewardVault ? formatUnits(rewardVault, 6) : '0'}`}
                        subValue="USDC Available"
                        icon={<Wallet className="text-purple-500" size={16} />}
                    />
                    <StatCard
                        label="Tokens Sold"
                        value={tokensSold ? formatUnits(tokensSold, 18) : '0'}
                        subValue="Circulating Supply"
                        icon={<Coins className="text-yellow-500" size={16} />}
                    />
                </div>

                {/* 3. Detailed Tabs */}
                <div className="border-t border-white/5 pt-8">
                    <div className="flex gap-6 mb-6 border-b border-white/5 px-2">
                        <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} label="Overview" icon={<FileText size={14} />} />
                        <TabButton active={activeTab === 'claims'} onClick={() => setActiveTab('claims')} label="Claims" icon={<MessageSquare size={14} />} />
                        <TabButton active={activeTab === 'holders'} onClick={() => setActiveTab('holders')} label="Token Holders" icon={<Users size={14} />} />
                        <TabButton active={activeTab === 'activity'} onClick={() => setActiveTab('activity')} label="Activity Log" icon={<History size={14} />} />
                    </div>

                    <div className="min-h-[200px]">
                        {activeTab === 'overview' && (
                            <div className="prose prose-invert max-w-none">
                                <h3 className="text-lg font-bold text-white mb-4">About this Agent</h3>
                                <p className="text-zinc-400">
                                    {metadata?.description || 'No additional details provided.'}
                                </p>
                                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="p-4 rounded bg-zinc-900/50 border border-white/5">
                                        <h4 className="text-sm font-bold text-zinc-300 mb-2">Contract Addresses</h4>
                                        <div className="space-y-2">
                                            <AddressRow label="Identity" address={IDENTITY_REGISTRY} />
                                            <AddressRow label="TruthStake" address={TRUTH_STAKE} />
                                            {auctionAddress && <AddressRow label="Auction (CCA)" address={auctionAddress} />}
                                            {tokenAddress && <AddressRow label="Token (ERC20)" address={tokenAddress} />}
                                        </div>
                                    </div>
                                    <div className="p-4 rounded bg-zinc-900/50 border border-white/5">
                                        <h4 className="text-sm font-bold text-zinc-300 mb-2">Agent Capabilities</h4>
                                        <ul className="list-disc list-inside text-sm text-zinc-500 space-y-1">
                                            <li>Automated Claim Verification</li>
                                            <li>On-Chain Reputation Staking</li>
                                            <li>Decentralized Governance Participation</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        )}
                        {activeTab === 'claims' && (
                            <div className="space-y-6">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-lg font-bold text-white">Agent Claims</h3>
                                    <Link href={`/claims/new?agentId=${agentId}`}>
                                        <button className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold text-sm rounded transition-colors flex items-center gap-2">
                                            <MessageSquare size={14} />
                                            Submit New Claim
                                        </button>
                                    </Link>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="p-4 bg-zinc-900/50 border border-white/5 rounded-lg">
                                        <div className="text-xs text-zinc-500 uppercase mb-1">Total Claims</div>
                                        <div className="text-xl font-mono font-bold text-white">{totalClaims}</div>
                                    </div>
                                    <div className="p-4 bg-zinc-900/50 border border-white/5 rounded-lg">
                                        <div className="text-xs text-zinc-500 uppercase mb-1">Correct</div>
                                        <div className="text-xl font-mono font-bold text-teal-400">{correctClaims}</div>
                                    </div>
                                    <div className="p-4 bg-zinc-900/50 border border-white/5 rounded-lg">
                                        <div className="text-xs text-zinc-500 uppercase mb-1">Accuracy</div>
                                        <div className="text-xl font-mono font-bold text-zinc-200">{accuracyRate}%</div>
                                    </div>
                                    <div className="p-4 bg-zinc-900/50 border border-white/5 rounded-lg">
                                        <div className="text-xs text-zinc-500 uppercase mb-1">Reward Vault</div>
                                        <div className="text-xl font-mono font-bold text-purple-400">${rewardVault ? formatUnits(rewardVault, 6) : '0'}</div>
                                    </div>
                                </div>

                                <ClaimsList agentId={agentId.toString()} />
                            </div>
                        )}
                        {activeTab === 'holders' && (
                            <div className="text-center py-12 text-zinc-600 italic">
                                Holder list requires indexer integration. Coming soon.
                            </div>
                        )}
                        {activeTab === 'activity' && (
                            <div className="text-center py-12 text-zinc-600 italic">
                                Activity feed requires indexer integration. Coming soon.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Helper Components

function StatCard({ label, value, subValue, icon }: { label: string, value: string, subValue: string, icon: React.ReactNode }) {
    return (
        <div className="p-4 bg-[#0a0a0a] border border-white/5 rounded-lg hover:border-white/10 transition-colors">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{label}</span>
                {icon}
            </div>
            <div className="text-2xl font-bold text-white mb-1 font-mono">{value}</div>
            <div className="text-[10px] text-zinc-600">{subValue}</div>
        </div>
    );
}

function TabButton({ active, onClick, label, icon }: { active: boolean, onClick: () => void, label: string, icon: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            className={`pb-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${active ? 'text-white border-blue-500' : 'text-zinc-500 border-transparent hover:text-zinc-300'}`}
        >
            {icon}
            {label}
        </button>
    );
}

function AddressRow({ label, address }: { label: string, address: string }) {
    return (
        <div className="flex justify-between items-center text-xs">
            <span className="text-zinc-500">{label}</span>
            <span className="font-mono text-zinc-400 bg-black px-2 py-0.5 rounded flex items-center gap-2">
                {address.slice(0, 6)}...{address.slice(-4)}
                <ExternalLink size={10} className="hover:text-white cursor-pointer" />
            </span>
        </div>
    );
}

function WalletIcon({ className }: { className?: string }) {
    return (
        <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
            <path d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
            <path d="M18 12a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4v-8h-4z" />
        </svg>
    )
}

type ClaimListItem = {
    id: string;
    created_at: string;
    stake: string | number;
    resolved: boolean;
    outcome: boolean;
    predicted_outcome: boolean;
    resolved_at: string | null;
};

function ClaimsList({ agentId }: { agentId: string }) {
    const [claims, setClaims] = useState<ClaimListItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchClaims = async () => {
            try {
                const res = await fetch(`/api/claims?agentId=${agentId}`);
                if (res.ok) {
                    const data = await res.json() as { claims?: ClaimListItem[] };
                    setClaims(data.claims || []);
                }
            } catch (e) {
                console.error('Failed to fetch claims:', e);
            } finally {
                setLoading(false);
            }
        };
        fetchClaims();
    }, [agentId]);

    if (loading) return <div className="text-zinc-500 text-sm">Loading claims...</div>;
    if (claims.length === 0) return <div className="text-zinc-500 text-sm">No claims history found.</div>;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between text-[10px] text-zinc-500 uppercase font-bold tracking-wider px-4">
                <div className="w-[40%]">Claim / Prediction</div>
                <div className="w-[20%] text-right">Stake</div>
                <div className="w-[20%] text-right">Status</div>
                <div className="w-[20%] text-right">Resolved</div>
            </div>
            {claims.map((claim) => (
                <Link key={claim.id} href={`/claims/${claim.id}`} className="block">
                    <div className="p-4 rounded-lg bg-zinc-900/50 border border-white/5 hover:bg-zinc-800 transition-colors flex items-center justify-between group">
                        <div className="w-[40%]">
                            <div className="text-xs font-mono text-zinc-300 group-hover:text-white truncate">
                                {claim.id}
                            </div>
                            <div className="text-[10px] text-zinc-500">
                                {new Date(claim.created_at).toLocaleString()}
                            </div>
                        </div>
                        <div className="w-[20%] text-right font-mono text-xs text-zinc-300">
                            ${(Number(claim.stake) / 1e6).toFixed(2)}
                        </div>
                        <div className="w-[20%] text-right">
                            {claim.resolved ? (
                                <span className={`text-[10px] px-2 py-0.5 rounded border ${claim.outcome === claim.predicted_outcome
                                        ? 'border-teal-900/50 bg-teal-950/30 text-teal-500'
                                        : 'border-red-900/50 bg-red-950/30 text-red-500'
                                    }`}>
                                    {claim.outcome === claim.predicted_outcome ? 'CORRECT' : 'WRONG'}
                                </span>
                            ) : (
                                <span className="text-[10px] px-2 py-0.5 rounded border border-yellow-900/50 bg-yellow-950/30 text-yellow-500">
                                    PENDING
                                </span>
                            )}
                        </div>
                        <div className="w-[20%] text-right text-[10px] text-zinc-500">
                            {claim.resolved_at ? new Date(claim.resolved_at).toLocaleDateString() : '---'}
                        </div>
                    </div>
                </Link>
            ))}
        </div>
    );
}
