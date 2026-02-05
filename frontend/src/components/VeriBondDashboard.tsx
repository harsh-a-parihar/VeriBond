'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { useAgentStats, useClaimCount, useUSDCBalance } from '@/hooks';
import {
    Terminal, ShieldAlert, Activity, Lock, Cpu, Search, Zap,
    Server, Wifi, Database, Layers, ArrowUpRight, AlertTriangle
} from 'lucide-react';

// --- UTILS ---
const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

const formatUSDC = (val: bigint | undefined) => {
    if (!val) return '$0.00';
    return formatCurrency(Number(val) / 1e6);
};

// Default agent ID - Agent #142 registered on Base Sepolia
const DEFAULT_AGENT_ID = 142;

// --- SUB-COMPONENTS ---

const StatusBadge = ({ status, panic }: { status: string, panic: boolean }) => (
    <div className={`
    flex items-center gap-2 px-3 py-1 rounded border text-[10px] uppercase tracking-wider font-bold font-mono transition-all duration-500
    ${panic
            ? 'bg-red-950/20 border-red-900/50 text-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]'
            : 'bg-teal-950/20 border-teal-900/30 text-teal-500 shadow-[0_0_10px_rgba(20,184,166,0.1)]'}
  `}>
        <div className={`w-1.5 h-1.5 rounded-full ${panic ? 'bg-red-500 animate-pulse' : 'bg-teal-500'}`} />
        {status}
    </div>
);

const StatCard = ({ label, value, sub, panic, icon: Icon }: any) => (
    <div className={`p-4 rounded-lg border backdrop-blur-sm transition-colors duration-500 ${panic ? 'bg-red-950/10 border-red-900/30' : 'bg-zinc-900/20 border-white/5'}`}>
        <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">{label}</span>
            {Icon && <Icon size={12} className={panic ? 'text-red-500' : 'text-zinc-600'} />}
        </div>
        <div className={`text-2xl font-mono font-medium tracking-tight transition-colors duration-300 ${panic ? 'text-red-500' : 'text-zinc-100'}`}>
            {value}
        </div>
        {sub && <span className="text-xs text-zinc-600 mt-1 font-mono flex items-center gap-1">{sub}</span>}
    </div>
);

const HealthModule = ({ label, active, panic }: { label: string, active: boolean, panic: boolean }) => (
    <div className={`flex items-center justify-between p-2 rounded border ${panic ? 'border-red-900/30 bg-red-950/10' : 'border-zinc-800 bg-zinc-900/30'}`}>
        <span className="text-[10px] font-mono text-zinc-500 uppercase">{label}</span>
        <div className="flex gap-1">
            {[1, 2, 3].map(i => (
                <div key={i} className={`w-1 h-3 rounded-sm transition-colors duration-300 ${active
                    ? (panic ? 'bg-red-500' : 'bg-teal-500')
                    : 'bg-zinc-800'
                    } ${active && i === 3 ? 'animate-pulse' : ''}`} />
            ))}
        </div>
    </div>
);

// --- MAIN COMPONENT ---

export default function VeriBondDashboard() {
    const [panicMode, setPanicMode] = useState(false);
    const [input, setInput] = useState('');
    const [logs, setLogs] = useState<{ id: number, time: string, text: string, type: 'info' | 'success' | 'error' | 'dim' }[]>([
        { id: 1, time: 'INIT', text: 'VeriBond Terminal v4.0 Initialized', type: 'info' },
        { id: 2, time: 'NET', text: 'Connecting to Base Sepolia...', type: 'dim' },
    ]);

    // Web3 Hooks
    const { address, isConnected } = useAccount();
    const agentStats = useAgentStats(DEFAULT_AGENT_ID);
    const { count: claimCount } = useClaimCount();
    const { balanceFormatted: usdcBalance } = useUSDCBalance();

    // Add connection log when wallet connects
    useEffect(() => {
        if (isConnected && address) {
            const time = new Date().toLocaleTimeString('en-US', { hour12: false });
            setLogs(prev => [...prev,
            { id: Date.now(), time, text: `Wallet Connected: ${address.slice(0, 6)}...${address.slice(-4)}`, type: 'success' },
            { id: Date.now() + 1, time, text: `Agent #${DEFAULT_AGENT_ID} Loaded - Accuracy: ${agentStats.accuracy.toFixed(1)}%`, type: 'info' },
            ]);
        }
    }, [isConnected, address]);

    // Enhanced Graph Logic (Confidence Interval)
    const [points, setPoints] = useState<number[]>(Array(50).fill(50));
    const [confidence, setConfidence] = useState<number[]>(Array(50).fill(2));

    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [logs]);

    useEffect(() => {
        const interval = setInterval(() => {
            setPoints(prev => {
                const last = prev[prev.length - 1];
                // Panic = Crash + High Volatility. Normal = Stable + Low Volatility
                const trend = panicMode ? -2 : 0.1;
                const noise = panicMode ? (Math.random() * 10 - 5) : (Math.random() * 2 - 1);
                let next = last + trend + noise;
                if (next > 95) next = 95;
                if (next < 5) next = 5;
                return [...prev.slice(1), next];
            });

            setConfidence(prev => {
                // Panic = Wide bands (Uncertainty). Normal = Narrow bands (Certainty).
                const targetWidth = panicMode ? 15 : 2;
                const nextWidth = prev[prev.length - 1] + (targetWidth - prev[prev.length - 1]) * 0.1;
                return [...prev.slice(1), nextWidth];
            });

        }, 100);
        return () => clearInterval(interval);
    }, [panicMode]);

    const handleCommand = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && input.trim()) {
            const cmd = input;
            const time = new Date().toLocaleTimeString('en-US', { hour12: false });
            setLogs(prev => [...prev, { id: Date.now(), time, text: `> ${cmd}`, type: 'info' }]);
            setInput('');

            setTimeout(() => {
                if (panicMode) {
                    setLogs(prev => [...prev, { id: Date.now() + 1, time, text: 'CRITICAL: ORACLE MISMATCH. SLASHING STAKE...', type: 'error' }]);
                } else {
                    setLogs(prev => [...prev, { id: Date.now() + 1, time, text: 'Verifying with Chainlink Functions...', type: 'dim' }]);
                    setTimeout(() => {
                        setLogs(prev => [...prev, { id: Date.now() + 2, time, text: '✓ Verified. Proof: 0x8a...9f21', type: 'success' }]);
                    }, 600);
                }
            }, 300);
        }
    };

    return (
        <div className={`min-h-screen transition-colors duration-1000 font-sans selection:bg-teal-500/30 ${panicMode ? 'bg-[#050000]' : 'bg-[#09090b]'}`}>

            {/* Cinematic Grain/Scanlines */}
            <div className="fixed inset-0 pointer-events-none z-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }}></div>
            <div className="fixed inset-0 pointer-events-none z-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-[1] bg-[length:100%_2px,3px_100%] opacity-20"></div>

            {/* Navigation */}
            <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-[#09090b]/80 backdrop-blur-xl h-16 flex items-center justify-between px-6 lg:px-12">
                <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded border flex items-center justify-center transition-colors ${panicMode ? 'bg-red-950 border-red-900' : 'bg-zinc-900 border-zinc-800'}`}>
                        <Cpu className={`w-4 h-4 ${panicMode ? 'text-red-500' : 'text-zinc-400'}`} />
                    </div>
                    <span className="font-mono font-bold text-lg tracking-tight text-zinc-100">VeriBond<span className="text-zinc-600">_OS</span></span>
                </div>
                <div className="hidden md:flex items-center gap-8 text-xs font-medium tracking-wide text-zinc-500 font-mono">
                    <Link href="/marketplace" className="hover:text-zinc-300 cursor-pointer transition-colors">MARKETPLACE</Link>
                    <span className="hover:text-zinc-300 cursor-pointer transition-colors">GOVERNANCE</span>
                    <span className="hover:text-zinc-300 cursor-pointer transition-colors">DOCS</span>
                </div>
                <div className="flex items-center gap-4">
                    <StatusBadge status={panicMode ? "SYSTEM COMPROMISED" : "SYSTEM OPTIMAL"} panic={panicMode} />
                    <ConnectButton.Custom>
                        {({ account, chain, openConnectModal, openAccountModal, mounted }) => {
                            const connected = mounted && account && chain;
                            return (
                                <button
                                    onClick={connected ? openAccountModal : openConnectModal}
                                    className={`px-3 py-1.5 rounded border text-xs font-mono transition-all ${connected
                                        ? 'bg-teal-950/20 border-teal-900/50 text-teal-500 hover:bg-teal-900/30'
                                        : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'
                                        }`}
                                >
                                    {connected ? `${account.displayName}` : 'CONNECT'}
                                </button>
                            );
                        }}
                    </ConnectButton.Custom>
                </div>
            </nav>

            <main className="relative z-10 pt-24 px-6 lg:px-12 pb-12 max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-2rem)]">

                {/* --- LEFT COLUMN: CONTROL & LOGS --- */}
                <div className="lg:col-span-4 flex flex-col gap-4">

                    {/* Header */}
                    <div className="py-4">
                        <div className="flex items-center gap-2 mb-2 text-xs font-mono text-zinc-500">
                            <Wifi size={12} className={panicMode ? 'text-red-500' : 'text-teal-500'} />
                            Connected: Base Sepolia
                        </div>
                        <h1 className="text-3xl font-medium tracking-tight text-white leading-tight">
                            Agent Command <br />
                            <span className={`${panicMode ? 'text-red-500' : 'text-zinc-500'} transition-colors duration-500`}>Interface v4.0</span>
                        </h1>
                    </div>

                    {/* The Terminal */}
                    <div className={`flex-1 rounded-lg border overflow-hidden flex flex-col transition-all duration-500 shadow-2xl relative ${panicMode ? 'border-red-900/30 bg-red-950/5' : 'border-white/10 bg-zinc-900/40'}`}>
                        {/* Status Bar */}
                        <div className="h-8 border-b border-white/5 bg-white/5 flex items-center px-3 justify-between">
                            <span className="text-[10px] uppercase text-zinc-500 font-mono flex items-center gap-2">
                                <Terminal size={10} /> output_log.txt
                            </span>
                            <span className="text-[10px] text-zinc-600 font-mono">PID: 8492</span>
                        </div>

                        {/* Logs */}
                        <div className="flex-1 p-4 font-mono text-[11px] leading-relaxed overflow-y-auto space-y-2 no-scrollbar" ref={scrollRef}>
                            {logs.map((log) => (
                                <div key={log.id} className="flex gap-3 animate-in fade-in slide-in-from-bottom-1 duration-300">
                                    <span className="text-zinc-600 shrink-0 select-none">[{log.time}]</span>
                                    <span className={`
                                        ${log.type === 'success' ? 'text-teal-500' : ''}
                                        ${log.type === 'error' ? 'text-red-500 font-bold' : ''}
                                        ${log.type === 'dim' ? 'text-zinc-600' : ''}
                                        ${log.type === 'info' ? 'text-zinc-300' : ''}
                                    `}>
                                        {log.type === 'success' && '✓ '}
                                        {log.type === 'error' && '✖ '}
                                        {log.text}
                                    </span>
                                </div>
                            ))}
                            {panicMode && (
                                <div className="mt-4 p-2 border border-red-500/20 bg-red-500/10 rounded text-red-400">
                                    <p className="font-bold mb-1">!!! AUTOMATIC SLASHING TRIGGERED !!!</p>
                                    <p className="opacity-70">Bonding curve reserve is being burned to cover liabilities.</p>
                                </div>
                            )}
                        </div>

                        {/* Input */}
                        <div className="p-3 border-t border-white/5 bg-zinc-950/50">
                            <div className="flex items-center gap-2">
                                <span className={panicMode ? 'text-red-500' : 'text-teal-500'}>➜</span>
                                <input
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={handleCommand}
                                    disabled={panicMode}
                                    className="bg-transparent border-none outline-none text-sm text-zinc-200 w-full placeholder-zinc-700 font-mono"
                                    placeholder={panicMode ? "LOCKDOWN ACTIVE" : "Query Agent..."}
                                    autoFocus
                                />
                            </div>
                        </div>
                    </div>

                    {/* System Health Grid */}
                    <div className="grid grid-cols-2 gap-2">
                        <HealthModule label="Oracle Uplink" active={!panicMode} panic={panicMode} />
                        <HealthModule label="Execution VM" active={true} panic={panicMode} />
                        <HealthModule label="Reserve Link" active={!panicMode} panic={panicMode} />
                        <HealthModule label="Proof Gen" active={true} panic={panicMode} />
                    </div>
                </div>

                {/* --- RIGHT COLUMN: VISUALIZATION --- */}
                <div className="lg:col-span-8 flex flex-col gap-6">

                    {/* Top Stats - Now with real data */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <StatCard
                            label="USDC Balance"
                            value={isConnected ? `$${usdcBalance}` : '--'}
                            sub={isConnected ? 'Connected' : 'Connect Wallet'}
                            panic={panicMode}
                            icon={Lock}
                        />
                        <StatCard
                            label="Truth Score"
                            value={agentStats.isLoading ? '...' : `${agentStats.accuracy.toFixed(1)}%`}
                            sub={`${agentStats.correct.toString()}/${agentStats.total.toString()} Claims`}
                            panic={panicMode || agentStats.accuracy < 70}
                            icon={ShieldAlert}
                        />
                        <StatCard
                            label="Total Slashed"
                            value={formatUSDC(agentStats.slashed)}
                            sub="Agent #142"
                            panic={agentStats.slashed > BigInt(0)}
                            icon={Activity}
                        />
                        <StatCard
                            label="Total Claims"
                            value={claimCount?.toString() ?? '...'}
                            sub="Platform-wide"
                            panic={panicMode}
                            icon={Database}
                        />
                    </div>

                    {/* The Main Graph (Confidence Interval) */}
                    <div className={`flex-1 rounded-xl border relative overflow-hidden flex flex-col transition-colors duration-500 ${panicMode ? 'bg-red-950/5 border-red-900/30' : 'bg-zinc-900/20 border-white/5'}`}>

                        {/* Header Overlay */}
                        <div className="absolute top-4 left-6 z-20">
                            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                                <Activity size={12} /> Live Confidence Interval
                            </h3>
                            <p className="text-2xl font-mono text-zinc-200 mt-1">
                                {panicMode ? 'UNCERTAINTY DETECTED' : 'HIGH CONFIDENCE'}
                            </p>
                        </div>

                        {/* Chart Area */}
                        <div className="absolute inset-0 z-10 p-6 pt-20">
                            <svg className="w-full h-full overflow-visible" preserveAspectRatio="none">
                                {/* The Confidence Band (Shaded Area) */}
                                <path
                                    d={`
                                        M 0 ${100 - (points[0] - confidence[0])} 
                                        ${points.map((p, i) => `L ${(i / (points.length - 1)) * 100} ${100 - (p - confidence[i])}`).join(' ')}
                                        ${points.slice().reverse().map((p, i) => {
                                        const revIdx = points.length - 1 - i;
                                        return `L ${(revIdx / (points.length - 1)) * 100} ${100 - (p + confidence[revIdx])}`;
                                    }).join(' ')}
                                        Z
                                    `}
                                    fill={panicMode ? "rgba(239, 68, 68, 0.1)" : "rgba(20, 184, 166, 0.1)"}
                                    stroke="none"
                                    className="transition-all duration-300 ease-linear"
                                />

                                {/* The Main Line */}
                                <path
                                    d={`M 0 ${100 - points[0]} ` + points.map((p, i) => `L ${(i / (points.length - 1)) * 100} ${100 - p}`).join(' ')}
                                    fill="none"
                                    stroke={panicMode ? "#ef4444" : "#14b8a6"}
                                    strokeWidth="2"
                                    vectorEffect="non-scaling-stroke"
                                    className="transition-all duration-300 ease-linear"
                                />

                                {/* Gradient Under Line */}
                                <defs>
                                    <linearGradient id="gradPanic" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#ef4444" stopOpacity="0.2" />
                                        <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
                                    </linearGradient>
                                </defs>
                            </svg>
                        </div>

                        {/* Grid Lines */}
                        <div className="absolute inset-0 z-0 flex flex-col justify-between p-6 pt-20 pb-12 opacity-10 pointer-events-none">
                            {[1, 2, 3, 4].map(i => <div key={i} className="w-full h-px bg-zinc-500 border-dashed border-b border-zinc-600" />)}
                        </div>
                    </div>

                    {/* Bottom Controls */}
                    <div className="h-16 border rounded-lg border-white/5 bg-zinc-900/30 flex items-center justify-between px-6 backdrop-blur">
                        <div className="flex gap-8 text-xs text-zinc-500 font-mono">
                            <div className="flex items-center gap-2">
                                <Layers size={14} />
                                <span>Block: 19,204,102</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Zap size={14} />
                                <span>Gas: 12 gwei</span>
                            </div>
                            <div className="hidden md:flex items-center gap-2">
                                <Server size={14} />
                                <span>RPC: 14ms</span>
                            </div>
                        </div>

                        <button
                            onClick={() => setPanicMode(!panicMode)}
                            className={`
                                group relative px-5 py-2 rounded text-xs font-bold tracking-wider uppercase transition-all duration-300
                                overflow-hidden border flex items-center gap-2
                                ${panicMode
                                    ? 'bg-red-500/10 border-red-500 text-red-500 hover:bg-red-500/20'
                                    : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'}
                            `}
                        >
                            {panicMode ? <AlertTriangle size={14} className="animate-pulse" /> : <ShieldAlert size={14} />}
                            <span>{panicMode ? 'RESET PROTOCOL' : 'SIMULATE ATTACK'}</span>
                        </button>
                    </div>

                </div>
            </main>
        </div>
    );
}