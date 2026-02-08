'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { ADMIN_WALLET } from '@/lib/contracts';
import {
    Search, ShieldCheck, Gavel,
    Activity, User, Zap,
    AlertTriangle, Plus, Layers
} from 'lucide-react';
// ... (imports)
import { useQuery, useMutation } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

// --- TYPES ---

type AgentStatus = 'auction' | 'active' | 'slashed';

// ... (Agent Interface) ...
interface Agent {
    id: string;
    name: string;
    ticker: string;
    ens: string;
    status: AgentStatus;
    hasAuction: boolean;
    price: number;
    change: number;
    accuracy: number;
    staked: string;
    auctionProgress?: number;
    image?: string;
    description?: string;
}

interface AgentApiRow {
    id: string;
    owner?: string;
    name?: string;
    ticker?: string;
    image?: string;
    description?: string;
    claimed_name?: string;
    is_active?: boolean;
    auction_address?: string | null;
    auction_status?: string | null;
    total_cleared?: string | number | null;
    trust_score?: string | number | null;
}

interface AgentsApiResponse {
    status?: string;
    agents?: AgentApiRow[];
}

// Data Fetcher
const fetchAgents = async (query: string = ''): Promise<Agent[]> => {
    const url = query ? `/api/agents?q=${encodeURIComponent(query)}` : '/api/agents';
    const res = await fetch(url);
    const data = await res.json() as AgentsApiResponse;
    if (data.status === 'init_needed') return [];

    // Transform DB rows to Agent interface
    return (data.agents || []).map((row: AgentApiRow) => {
        const hasAuction = !!row.auction_address;
        return {
            id: row.id,
            name: row.name || 'Unknown Agent',
            ticker: row.ticker || 'UNK',
            ens: row.claimed_name
                ? `${row.claimed_name}.veribond`
                : (row.owner ? (row.owner.slice(0, 6) + '...' + row.owner.slice(-4)) : 'Unknown'),
            status: !row.is_active ? 'slashed' : (hasAuction ? 'auction' : 'active'),
            hasAuction,
            price: Number(row.total_cleared || 0), // Use total cleared as price/mcap proxy
            change: 0,
            accuracy: Number(row.trust_score || 100),
            staked: '0 USDC',
            image: row.image,
            description: row.description,
            auctionProgress: 0 // TODO: Calculate progress from start/end blocks
        }
    });
};

const syncIndexer = async () => {
    const res = await fetch('/api/indexer/sync');
    if (!res.ok) throw new Error('Sync failed');
    return res.json();
};


// --- SUB-COMPONENTS ---

// --- SUB-COMPONENTS ---
// ... (TrustGraph, AgentCard components - keeping these as is) [REDACTED FOR BREVITY, ASSUMING THEY ARE ABLE TO BE KEPT OR I WILL INCLUDE THEM IF NEEDED. ACTUALLY I SHOULD PROBABLY INCLUDE THEM TO BE SAFE OR TARGET CAREFULLY]

// 1. Trust Score Badge (Replaces Sparkline)
const TrustScoreBadge = ({ accuracy, status }: { accuracy: number; status: AgentStatus }) => {
    const isSlashed = status === 'slashed';
    const isAuction = status === 'auction';

    // Color based on trust score
    const getColor = () => {
        if (isSlashed) return { bg: 'bg-red-900/20', border: 'border-red-700/40', text: 'text-red-400', ring: 'stroke-red-500' };
        if (isAuction) return { bg: 'bg-blue-900/20', border: 'border-blue-700/40', text: 'text-blue-400', ring: 'stroke-blue-500' };
        if (accuracy >= 80) return { bg: 'bg-green-900/20', border: 'border-green-700/40', text: 'text-green-400', ring: 'stroke-green-500' };
        if (accuracy >= 50) return { bg: 'bg-yellow-900/20', border: 'border-yellow-700/40', text: 'text-yellow-400', ring: 'stroke-yellow-500' };
        return { bg: 'bg-red-900/20', border: 'border-red-700/40', text: 'text-red-400', ring: 'stroke-red-500' };
    };

    const colors = getColor();
    const circumference = 2 * Math.PI * 16; // radius = 16
    const offset = circumference - (accuracy / 100) * circumference;

    return (
        <div className="flex items-center gap-3">
            {/* Circular Progress */}
            <div className="relative w-12 h-12">
                <svg className="w-full h-full -rotate-90">
                    {/* Background circle */}
                    <circle
                        cx="24"
                        cy="24"
                        r="16"
                        stroke="currentColor"
                        strokeWidth="3"
                        fill="none"
                        className="text-zinc-800"
                    />
                    {/* Progress circle */}
                    <circle
                        cx="24"
                        cy="24"
                        r="16"
                        stroke="currentColor"
                        strokeWidth="3"
                        fill="none"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        className={colors.ring}
                    />
                </svg>
                {/* Center text */}
                <div className="absolute inset-0 flex items-center justify-center">
                    <span className={`text-xs font-bold ${colors.text}`}>
                        {accuracy}
                    </span>
                </div>
            </div>

            {/* Status label */}
            <div className="flex flex-col">
                <span className="text-[9px] text-zinc-600 uppercase tracking-wider">Trust Score</span>
                <span className={`text-xs font-medium ${colors.text}`}>
                    {isSlashed ? 'Slashed' : isAuction ? 'In Auction' : accuracy >= 80 ? 'Verified' : accuracy >= 50 ? 'Active' : 'Low Trust'}
                </span>
            </div>
        </div>
    );
};

// 2. The Agent Card
const AgentCard = ({ agent }: { agent: Agent }) => {
    const router = useRouter();
    const isAuction = agent.status === 'auction';
    const isSlashed = agent.status === 'slashed';

    return (
        <div
            onClick={() => router.push(`/agents/${agent.id}`)}
            className={`
      group relative flex flex-col border-b border-white/5 
      hover:bg-zinc-900/40 transition-all cursor-pointer
      ${isSlashed ? 'bg-red-950/5' : ''}
    `}>
            {/* Main Row */}
            <div className="flex items-center justify-between p-5">
                {/* Left: Identity (ERC-8004) */}
                <div className="flex items-center gap-4 w-[35%]">
                    <div className={`
            w-10 h-10 rounded-lg border flex items-center justify-center text-xs font-bold font-mono
            ${isAuction ? 'border-blue-900 bg-blue-950/20 text-blue-500' :
                            isSlashed ? 'border-red-900 bg-red-950/20 text-red-500' :
                                'border-zinc-800 bg-zinc-900 text-zinc-400'}
            `}>
                        {agent.ticker.slice(0, 2)}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-zinc-200">{agent.name}</span>
                            {isSlashed && <AlertTriangle size={12} className="text-red-500" />}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono">
                            <span className="text-zinc-400">{agent.ens}</span>
                            <span>•</span>
                            <span>#{agent.id.padStart(4, '0')}</span>
                        </div>
                    </div>
                </div>

                {/* Middle: Status / Mechanics */}
                <div className="w-[30%] flex flex-col justify-center">
                    {isAuction ? (
                        <div className="w-full max-w-[140px]">
                            <div className="flex justify-between text-[10px] text-blue-400 mb-1 uppercase tracking-wider font-bold">
                                <span>CCA Auction</span>
                                <span>{agent.auctionProgress}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-blue-950 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500" style={{ width: `${agent.auctionProgress}%` }}></div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-4">
                            <div>
                                <div className="text-[10px] text-zinc-600 uppercase">Staked</div>
                                <div className="text-xs font-mono text-zinc-300">{agent.staked}</div>
                            </div>
                            <div>
                                <div className="text-[10px] text-zinc-600 uppercase">Trust</div>
                                <div className={`text-xs font-mono font-bold ${agent.accuracy > 90 ? 'text-teal-500' : 'text-red-500'}`}>
                                    {agent.accuracy}%
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right: Trust Badge & Price */}
                <div className="w-[35%] flex items-center justify-end gap-6">
                    <TrustScoreBadge accuracy={agent.accuracy} status={agent.status} />
                    <div className="text-right min-w-[60px]">
                        <div className="text-sm font-mono text-zinc-200">${agent.price.toFixed(2)}</div>
                        <div className={`text-[10px] font-mono ${agent.change >= 0 ? 'text-teal-500' : 'text-red-500'}`}>
                            {agent.change > 0 ? '+' : ''}{agent.change}%
                        </div>
                    </div>
                </div>
            </div>

            {/* Action Bar (Buttons) */}
            <div className="hidden group-hover:flex px-5 pb-4 gap-3 border-t border-white/5 pt-3 mx-5 mt-[-10px]">
                <button
                    onClick={(e) => { e.stopPropagation(); router.push(`/agents/${agent.id}/launch`); }}
                    className="flex-1 py-1.5 text-[10px] font-medium uppercase tracking-wider border border-zinc-800 hover:bg-zinc-900 rounded text-zinc-400 transition-colors"
                >
                    Launch Token
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); router.push(`/agents/${agent.id}`); }}
                    className="flex-1 py-1.5 text-[10px] font-medium uppercase tracking-wider border border-zinc-800 hover:bg-zinc-900 rounded text-zinc-300 transition-colors"
                >
                    Details
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); router.push(`/agents/${agent.id}/auction`); }}
                    className="flex-1 py-1.5 text-[10px] font-medium uppercase tracking-wider border border-blue-900/30 bg-blue-950/10 hover:bg-blue-900/20 rounded text-blue-400 transition-colors"
                >
                    View CCA Auction
                </button>
            </div>
        </div>
    );
};

export default function VeriBondMarketplaceFinal() {
    const [view, setView] = useState<'live' | 'auctions'>('live');
    const [searchInput, setSearchInput] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const { address, isConnected } = useAccount();

    // Debounce search input
    React.useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(searchInput);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchInput]);

    // Query
    const { data: agents = [], isLoading, refetch } = useQuery({
        queryKey: ['agents', debouncedQuery],
        queryFn: () => fetchAgents(debouncedQuery)
    });

    // Mutation for Sync
    const { mutate: sync, isPending: isSyncing } = useMutation({
        mutationFn: syncIndexer,
        onSuccess: () => {
            refetch();
        }
    });

    // Auto-sync on mount (Developer Experience: Pull-on-read)
    React.useEffect(() => {
        sync();
    }, [sync]);

    const displayAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';
    const isAdmin = address?.toLowerCase() === ADMIN_WALLET.toLowerCase();
    const auctionAgents = agents.filter((agent) => agent.hasAuction);
    const liveAgents = agents.filter((agent) => !agent.hasAuction);
    const visibleAgents = view === 'auctions' ? auctionAgents : liveAgents;
    const topPerformers = [...agents]
        .sort((a, b) => {
            if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
            return Number(b.id) - Number(a.id);
        })
        .slice(0, 5);

    return (
        <div className="flex h-screen bg-[#050505] text-zinc-200 font-sans selection:bg-teal-900/30">
            {/* 1. LEFT COLUMN: Identity & Nav (Sticky Context) */}
            <aside className="w-72 border-r border-white/5 flex flex-col bg-[#080808] z-20">
                {/* Branding */}
                <div className="h-16 flex items-center px-6 border-b border-white/5">
                    <div className="font-mono font-bold text-lg tracking-tight text-zinc-100">
                        VeriBond<span className="text-zinc-600">_Terminal</span>
                    </div>
                </div>

                {/* User Identity (Soulbound) */}
                <div className="p-6 border-b border-white/5">
                    <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3 font-semibold">Owner Identity</div>
                    {isConnected ? (
                        <>
                            <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/50 flex items-center gap-3">
                                <div className="w-10 h-10 rounded bg-zinc-900 border border-zinc-700 flex items-center justify-center">
                                    <User size={16} className="text-zinc-400" />
                                </div>
                                <div>
                                    <div className="text-xs font-medium text-zinc-300">{displayAddress}</div>
                                    <div className="text-[10px] text-zinc-500 flex items-center gap-1">
                                        <ShieldCheck size={10} /> Connected
                                    </div>
                                </div>
                            </div>
                            <Link href="/claims/new" className="mt-3 w-full py-2 text-xs font-medium border border-zinc-800 hover:bg-zinc-900 rounded text-zinc-400 transition-colors block text-center">
                                Submit New Claim
                            </Link>
                            {isAdmin && (
                                <Link href="/agents/register" className="mt-2 w-full py-2 text-xs font-medium border border-zinc-800 hover:bg-zinc-900 rounded text-zinc-500 transition-colors flex items-center justify-center gap-2">
                                    <Plus size={12} /> Register Agent
                                </Link>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/50 flex items-center gap-3">
                                <div className="w-10 h-10 rounded bg-gradient-to-br from-zinc-800 to-black border border-white/5 flex items-center justify-center">
                                    <User size={16} className="text-zinc-400" />
                                </div>
                                <div>
                                    <div className="text-xs font-bold text-zinc-500">Not Connected</div>
                                    <div className="text-[10px] text-zinc-600">Connect to interact</div>
                                </div>
                            </div>
                            <ConnectButton.Custom>
                                {({ openConnectModal }) => (
                                    <button
                                        onClick={openConnectModal}
                                        className="mt-3 w-full py-2 text-xs font-medium border border-zinc-800 hover:bg-zinc-900 rounded text-zinc-400 transition-colors"
                                    >
                                        Connect Wallet
                                    </button>
                                )}
                            </ConnectButton.Custom>
                        </>
                    )}
                </div>

                {/* Navigation */}
                <div className="flex-1 p-4 space-y-1">
                    <button
                        onClick={() => setView('live')}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${view === 'live' ? 'bg-zinc-900 text-white border border-zinc-800' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        <Activity size={16} /> Live Markets
                    </button>
                    <button
                        onClick={() => setView('auctions')}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${view === 'auctions' ? 'bg-zinc-900 text-white border border-zinc-800' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        <Gavel size={16} /> Uniswap CCA Auctions
                        <span className="ml-auto text-[10px] bg-blue-900/20 text-blue-500 px-1.5 py-0.5 rounded border border-blue-900/30">
                            {isLoading ? '...' : auctionAgents.length}
                        </span>
                    </button>
                </div>

                {/* Status Footer */}
                <div className="p-4 text-[10px] text-zinc-600 border-t border-white/5 font-mono">
                    <div className="flex justify-between mb-1">
                        <span>LP Burn</span>
                        <span className="text-zinc-400">Enabled</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Yellow Protocol</span>
                        <span className="text-zinc-400">Connected</span>
                    </div>
                </div>
            </aside>

            {/* center column */}
            <main className="flex-1 flex flex-col min-w-0 bg-[#050505]">
                {/* Header */}
                <header className="h-16 border-b border-white/5 flex items-center justify-between px-6 sticky top-0 bg-[#050505]/90 backdrop-blur z-10">
                    <div className="flex items-center gap-2 text-zinc-400 text-sm">
                        <Search size={14} />
                        <input
                            type="text"
                            placeholder="Search by name, ID, address, or ENS..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="bg-transparent outline-none placeholder-zinc-700 text-zinc-200 w-80"
                        />
                    </div>
                    <div className="flex gap-4 text-xs font-mono text-zinc-500">
                        <button onClick={() => sync()} disabled={isSyncing} className="flex items-center gap-2 hover:text-zinc-300 transition-colors">
                            <RefreshCw size={12} className={isSyncing ? "animate-spin" : ""} />
                            {isSyncing ? 'Syncing...' : 'Sync Chain'}
                        </button>
                    </div>
                </header>

                {/* TOP PERFORMERS SECTION */}
                {topPerformers.length > 0 && (
                    <div className="px-6 py-5 border-b border-white/5 bg-gradient-to-r from-zinc-900/50 via-purple-950/10 to-zinc-900/50">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <span className="text-lg">🏆</span>
                                <h2 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">Top Performers</h2>
                            </div>
                            <span className="text-[10px] text-zinc-500 font-mono">By Trust Score (Global)</span>
                        </div>
                        <div className="flex gap-3 overflow-x-auto pb-1">
                            {topPerformers.map((agent, index) => (
                                    <Link
                                        key={agent.id}
                                        href={`/agents/${agent.id}`}
                                        className={`
                                            group flex-shrink-0 p-4 rounded-xl border transition-all duration-200 cursor-pointer
                                            ${index === 0
                                                ? 'bg-gradient-to-br from-yellow-900/20 via-amber-900/10 to-yellow-950/20 border-yellow-700/30 hover:border-yellow-600/50 shadow-lg shadow-yellow-900/10'
                                                : index === 1
                                                    ? 'bg-gradient-to-br from-zinc-700/20 via-zinc-800/10 to-zinc-700/20 border-zinc-500/30 hover:border-zinc-400/50'
                                                    : index === 2
                                                        ? 'bg-gradient-to-br from-amber-800/20 via-amber-900/10 to-amber-950/20 border-amber-700/30 hover:border-amber-600/50'
                                                        : 'bg-zinc-900/50 border-white/5 hover:border-white/10'
                                            }
                                        `}
                                        style={{ minWidth: '160px' }}
                                    >
                                        {/* Rank Badge */}
                                        <div className="flex items-center justify-between mb-3">
                                            <span className={`
                                                text-xl font-bold
                                                ${index === 0 ? 'text-yellow-400' : index === 1 ? 'text-zinc-400' : index === 2 ? 'text-amber-500' : 'text-zinc-500'}
                                            `}>
                                                #{index + 1}
                                            </span>
                                            <span className={`
                                                text-xs font-bold px-2 py-0.5 rounded-full
                                                ${agent.accuracy >= 80
                                                    ? 'bg-green-900/30 text-green-400 border border-green-800/50'
                                                    : agent.accuracy >= 50
                                                        ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-800/50'
                                                        : 'bg-red-900/30 text-red-400 border border-red-800/50'
                                                }
                                            `}>
                                                {agent.accuracy}
                                            </span>
                                        </div>

                                        {/* Agent Info */}
                                        <div className="flex items-center gap-2 mb-2">
                                            {agent.image ? (
                                                <img
                                                    src={agent.image.replace('ipfs://', 'https://ipfs.io/ipfs/')}
                                                    alt={agent.name}
                                                    className="w-8 h-8 rounded-lg object-cover border border-white/10"
                                                />
                                            ) : (
                                                <div className={`
                                                    w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold font-mono border
                                                    ${index === 0 ? 'bg-yellow-950/30 border-yellow-800/50 text-yellow-400' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}
                                                `}>
                                                    {agent.ticker.slice(0, 2)}
                                                </div>
                                            )}
                                            <div className="overflow-hidden">
                                                <div className="text-xs font-medium text-zinc-200 truncate group-hover:text-white transition-colors">
                                                    {agent.name}
                                                </div>
                                                <div className="text-[10px] text-zinc-500 font-mono truncate">
                                                    {agent.ens}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Trust Label */}
                                        <div className="text-[9px] text-zinc-600 uppercase tracking-wider font-medium">
                                            Trust Score
                                        </div>
                                    </Link>
                                ))}
                        </div>
                    </div>
                )}

                {/* Filter Bar */}
                <div className="px-6 py-3 border-b border-white/5 bg-zinc-900/10 flex items-center gap-4 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                    <div className="w-[35%]">Agent Identity</div>
                    <div className="w-[30%]">Accountability Status</div>
                    <div className="w-[35%] text-right pr-6">Trust Signal</div>
                </div>

                {/* The List */}
                <div className="flex-1 overflow-y-auto">
                    {isLoading ? (
                        <div className="p-10 text-center text-zinc-600">Loading Market Data...</div>
                    ) : visibleAgents.length === 0 ? (
                        <div className="p-10 text-center text-zinc-600">
                            {view === 'auctions'
                                ? 'No CCA auctions found for the current query.'
                                : 'No live non-auction agents found for the current query.'}
                            <br />
                            <button onClick={() => sync()} className="mt-2 text-zinc-400 underline hover:text-white">Run Sync</button>
                        </div>
                    ) : (
                        visibleAgents.map((agent) => (
                            <AgentCard key={agent.id} agent={agent} />
                        ))
                    )}
                </div>
            </main>

            {/* right column */}
            <aside className="w-80 border-l border-white/5 flex flex-col bg-[#080808] z-20 hidden xl:flex">

                <div className="p-4 border-b border-white/5">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                        <Layers size={12} /> The Loop Feed
                    </h3>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {/* Tape events removed for now or fetch real ones later */}
                    <div className="p-4 text-center text-zinc-700 text-xs">Live feed connecting...</div>
                </div>

                {/* Yellow Protocol Integration Badge */}
                <div className="p-4 border-t border-white/5 bg-zinc-900/20">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
                            <Zap size={14} className="text-yellow-500" />
                        </div>
                        <div>
                            <div className="text-[10px] uppercase text-zinc-500 font-bold">Micropayments Active</div>
                            <div className="text-[10px] text-zinc-600">Powered by Yellow Network</div>
                        </div>
                    </div>
                </div>
            </aside>
        </div>
    );
}
