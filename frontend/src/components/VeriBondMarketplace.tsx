'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { useAgentStats, useClaimCount } from '@/hooks';
import { ADMIN_WALLET } from '@/lib/contracts';
import {
    Search, ShieldCheck, Gavel,
    Activity, User, Zap,
    AlertTriangle, Plus, Layers
} from 'lucide-react';

// --- TYPES ---

type AgentStatus = 'auction' | 'active' | 'slashed';

interface Agent {
    id: string;
    name: string;
    ticker: string;
    ens: string; // ENS Integration
    status: AgentStatus;
    price: number;
    change: number;
    accuracy: number; // The Trust Signal
    staked: string;   // USDC Staked
    auctionProgress?: number; // Only for CCA
}

// --- MOCK DATA (Polymarket Demo Context) ---

const AGENTS: Agent[] = [
    {
        id: '1', name: 'PolyPredictor Alpha', ticker: 'PRED', ens: 'alpha.eth',
        status: 'active', price: 4.20, change: 12.5, accuracy: 98.2, staked: '5,000 USDC'
    },
    {
        id: '2', name: 'Election Sentiment', ticker: 'VOTE', ens: 'vote-bot.eth',
        status: 'auction', price: 1.05, change: 0, accuracy: 100, staked: '0 USDC',
        auctionProgress: 65
    },
    {
        id: '3', name: 'Macro Trends AI', ticker: 'MACRO', ens: 'macro-ai.eth',
        status: 'slashed', price: 0.45, change: -42.8, accuracy: 64.0, staked: '200 USDC'
    },
    {
        id: '4', name: 'Crypto Native Scout', ticker: 'SCOUT', ens: 'scout.eth',
        status: 'active', price: 8.90, change: 3.2, accuracy: 94.5, staked: '1,200 USDC'
    },
];

const TAPE_EVENTS = [
    { time: '10:42:05', type: 'burn', text: 'Oracle Resolved: FALSE. Reserve Burned.', agent: 'MACRO', val: '-$4,200 🔥' },
    { time: '10:41:50', type: 'stake', text: 'Staked on "ETH > 3k by Friday"', agent: 'PRED', val: '500 USDC' },
    { time: '10:41:12', type: 'yellow', text: 'Query Fee paid via Yellow Channel', agent: 'PRED', val: '0.10 USDC' },
    { time: '10:40:00', type: 'auction', text: 'Uniswap CCA Bid Placed', agent: 'VOTE', val: '1,000 USDC' },
];

// --- SUB-COMPONENTS ---

// 1. The Sparkline (Visual Trust Signal)
const TrustGraph = ({ status }: { status: AgentStatus }) => {
    const color = status === 'slashed' ? '#ef4444' : status === 'auction' ? '#3b82f6' : '#14b8a6';
    // If slashed, show a crash. If active, show growth.
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
    const isAuction = agent.status === 'auction';
    const isSlashed = agent.status === 'slashed';

    return (
        <div className={`
      group relative flex items-center justify-between p-5 border-b border-white/5 
      hover:bg-zinc-900/40 transition-all cursor-pointer
      ${isSlashed ? 'bg-red-950/5' : ''}
    `}>
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
    );
};

// --- MAIN COMPONENT ---

export default function VeriBondMarketplaceFinal() {
    const [view, setView] = useState<'live' | 'auctions'>('live');
    const { address, isConnected } = useAccount();
    const { count: claimCount } = useClaimCount();

    // Format address for display
    const displayAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';

    // Check if admin
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

            {/* 2. CENTER COLUMN: The Feed (Marketplace) */}
            <main className="flex-1 flex flex-col min-w-0 bg-[#050505]">

                {/* Header */}
                <header className="h-16 border-b border-white/5 flex items-center justify-between px-6 sticky top-0 bg-[#050505]/90 backdrop-blur z-10">
                    <div className="flex items-center gap-2 text-zinc-400 text-sm">
                        <Search size={14} />
                        <input
                            type="text"
                            placeholder="Search agents by ENS or Ticker..."
                            className="bg-transparent outline-none placeholder-zinc-700 text-zinc-200 w-64"
                        />
                    </div>

                    <div className="flex gap-4 text-xs font-mono text-zinc-500">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-teal-500"></div>
                            Claims: {claimCount?.toString() ?? '...'}
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                            Agents: 4
                        </div>
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
                    {AGENTS.filter(a => view === 'live' ? a.status !== 'auction' : a.status === 'auction').map(agent => (
                        <AgentCard key={agent.id} agent={agent as Agent} />
                    ))}
                    {/* Duplicates for scroll feel */}
                    {AGENTS.filter(a => view === 'live' ? a.status !== 'active' : a.status === 'active').map(agent => (
                        <AgentCard key={agent.id + 'd'} agent={{ ...agent, id: agent.id + 'd' } as Agent} />
                    ))}
                </div>
            </main>

            {/* 3. RIGHT COLUMN: The Tape (VeriBond Loop) */}
            <aside className="w-80 border-l border-white/5 flex flex-col bg-[#080808] z-20 hidden xl:flex">

                <div className="p-4 border-b border-white/5">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                        <Layers size={12} /> The Loop Feed
                    </h3>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {TAPE_EVENTS.map((event, i) => (
                        <div key={i} className={`
                 p-4 border-b border-white/5 transition-colors
                 ${event.type === 'burn' ? 'bg-red-950/10 hover:bg-red-900/20' : 'hover:bg-zinc-900/30'}
               `}>
                            {/* Event Header */}
                            <div className="flex justify-between items-center mb-2">
                                <div className={`
                       text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border
                       ${event.type === 'burn' ? 'text-red-500 border-red-900/50 bg-red-950/20' :
                                        event.type === 'yellow' ? 'text-yellow-500 border-yellow-900/50 bg-yellow-950/20' :
                                            event.type === 'stake' ? 'text-teal-500 border-teal-900/50 bg-teal-950/20' :
                                                'text-blue-500 border-blue-900/50 bg-blue-950/20'}
                     `}>
                                    {event.type === 'burn' ? 'Reserve Burn' :
                                        event.type === 'yellow' ? 'Yellow Pay' :
                                            event.type === 'stake' ? 'Prediction' : 'CCA Bid'}
                                </div>
                                <span className="text-[10px] font-mono text-zinc-600">{event.time}</span>
                            </div>

                            {/* Event Body */}
                            <div className="text-xs text-zinc-300 font-medium mb-1">
                                <span className="text-zinc-500 mr-1">${event.agent}:</span>
                                {event.text}
                            </div>

                            {/* Event Value */}
                            <div className={`text-[10px] font-mono ${event.type === 'burn' ? 'text-red-500 font-bold' : 'text-zinc-500'}`}>
                                {event.val}
                            </div>
                        </div>
                    ))}
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