'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { useAgentStats, useClaimCount } from '@/hooks';
import { ADMIN_WALLET } from '@/lib/contracts';
import {
    Search, ShieldCheck, Gavel,
    Activity, User, Zap,
    AlertTriangle, Plus, Layers
} from 'lucide-react';
// ... (imports)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { CONTRACTS } from '@/lib/contracts';

// --- TYPES ---

type AgentStatus = 'auction' | 'active' | 'slashed';

// ... (Agent Interface) ...
interface Agent {
    id: string;
    name: string;
    ticker: string;
    ens: string;
    status: AgentStatus;
    price: number;
    change: number;
    accuracy: number;
    staked: string;
    auctionProgress?: number;
    image?: string;
    description?: string;
}

// Data Fetcher
const fetchAgents = async (): Promise<Agent[]> => {
    const res = await fetch('/api/agents');
    const data = await res.json();
    if (data.status === 'init_needed') return [];

    // Transform DB rows to Agent interface
    return (data.agents || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        ticker: row.ticker || 'UNK',
        ens: row.address.slice(0, 6) + '...' + row.address.slice(-4), // Mock ENS for now
        status: row.is_active ? 'active' : 'slashed', // Simplified status mapping
        price: 0, // Placeholder
        change: 0,
        accuracy: 100, // Placeholder or fetch real trust score if added to DB
        staked: '0 USDC',
        image: row.image,
        description: row.description
    }));
};

const syncIndexer = async () => {
    const res = await fetch('/api/indexer/sync');
    if (!res.ok) throw new Error('Sync failed');
    return res.json();
};


// --- SUB-COMPONENTS ---

// --- SUB-COMPONENTS ---
// ... (TrustGraph, AgentCard components - keeping these as is) [REDACTED FOR BREVITY, ASSUMING THEY ARE ABLE TO BE KEPT OR I WILL INCLUDE THEM IF NEEDED. ACTUALLY I SHOULD PROBABLY INCLUDE THEM TO BE SAFE OR TARGET CAREFULLY]

// 1. The Sparkline (Visual Trust Signal)
const TrustGraph = ({ status }: { status: AgentStatus }) => {
    const color = status === 'slashed' ? '#ef4444' : status === 'auction' ? '#3b82f6' : '#14b8a6';
    const points = status === 'slashed'
        ? [80, 82, 85, 84, 40, 35, 30]
        : [20, 25, 22, 30, 35, 38, 45];

    return (
        <div className="h-8 w-24">
            <svg className="w-full h-full overflow-visible" preserveAspectRatio="none">
                <polyline
                    points={points.map((p, i) => `${(i / (points.length - 1)) * 100},${100 - p}`).join(' ')}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                />
            </svg>
        </div>
    );
};

// 2. The Agent Card
const AgentCard = ({ agent }: { agent: Agent }) => {
    const router = useRouter();
    const isAuction = agent.status === 'auction';
    const isSlashed = agent.status === 'slashed';

    return (
        <div className={`
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

                {/* Right: Price & Graph */}
                <div className="w-[35%] flex items-center justify-end gap-6">
                    <TrustGraph status={agent.status} />
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
    const { address, isConnected } = useAccount();
    const { count: claimCount } = useClaimCount();

    // Query
    const { data: agents = [], isLoading, refetch } = useQuery({
        queryKey: ['agents'],
        queryFn: fetchAgents
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
    }, []);

    const displayAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';
    const isAdmin = address?.toLowerCase() === ADMIN_WALLET.toLowerCase();

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
                        <span className="ml-auto text-[10px] bg-blue-900/20 text-blue-500 px-1.5 py-0.5 rounded border border-blue-900/30">2</span>
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
                        <input type="text" placeholder="Search agents..." className="bg-transparent outline-none placeholder-zinc-700 text-zinc-200 w-64" />
                    </div>
                    <div className="flex gap-4 text-xs font-mono text-zinc-500">
                        <button onClick={() => sync()} disabled={isSyncing} className="flex items-center gap-2 hover:text-zinc-300 transition-colors">
                            <RefreshCw size={12} className={isSyncing ? "animate-spin" : ""} />
                            {isSyncing ? 'Syncing...' : 'Sync Chain'}
                        </button>
                    </div>
                </header>

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
                    ) : agents.length === 0 ? (
                        <div className="p-10 text-center text-zinc-600">
                            No agents found via Indexer. <br />
                            <button onClick={() => sync()} className="mt-2 text-zinc-400 underline hover:text-white">Run Sync</button>
                        </div>
                    ) : (
                        agents.map((agent) => (
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