'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { useClaimCount } from '@/hooks'; // Assuming this exists from your previous code
import {
    ArrowRight, ShieldCheck, Zap, Lock, Cpu,
    Activity, Globe, Search, Terminal, CheckCircle2, XCircle
} from 'lucide-react';

// --- ANIMATED SUB-COMPONENTS ---

const TickerItem = ({ symbol, trust, status }: { symbol: string, trust: number, status: 'up' | 'down' }) => (
    <div className="flex items-center gap-3 px-6 border-r border-white/5 h-full opacity-70 hover:opacity-100 transition-opacity cursor-default">
        <span className="font-mono text-xs font-bold text-zinc-300">{symbol}</span>
        <span className={`font-mono text-xs ${status === 'up' ? 'text-emerald-500' : 'text-rose-500'}`}>
            {trust}% TRUST
        </span>
    </div>
);

const FeatureCard = ({ icon: Icon, title, desc, delay }: any) => (
    <div
        className="group relative p-8 rounded-2xl border border-white/5 bg-zinc-900/20 overflow-hidden transition-all duration-500 hover:border-zinc-700/50 hover:bg-zinc-900/40"
        style={{ animationDelay: `${delay}ms` }}
    >
        {/* Hover Gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        <div className="relative z-10">
            <div className="w-12 h-12 rounded-xl border border-zinc-800 bg-zinc-950 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:border-zinc-600 transition-all duration-300 shadow-lg">
                <Icon className="text-zinc-500 group-hover:text-indigo-400 transition-colors" size={24} />
            </div>
            <h3 className="text-xl font-medium text-zinc-100 mb-3">{title}</h3>
            <p className="text-sm text-zinc-500 leading-relaxed group-hover:text-zinc-400 transition-colors">
                {desc}
            </p>
        </div>
    </div>
);

const Metric = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="relative pl-6 border-l border-zinc-800">
        <div className="text-4xl md:text-5xl font-mono font-medium text-white mb-2 tracking-tighter">{value}</div>
        <div className="text-xs uppercase tracking-widest text-zinc-500 font-bold">{label}</div>
        {sub && <div className="text-[10px] text-emerald-500 mt-1 font-mono flex items-center gap-1">
            <Activity size={10} /> {sub}
        </div>}
    </div>
);

// --- MAIN LANDING PAGE ---

export default function LandingPage() {
    const { isConnected } = useAccount();
    const { count } = useClaimCount(); // Optional hook handling

    // Fake ticker data
    const tickerData = [
        { s: 'AGENT_ALPHA', t: 98.2, st: 'up' }, { s: 'YIELD_SCOUT', t: 99.1, st: 'up' },
        { s: 'RISK_DAO', t: 82.4, st: 'down' }, { s: 'MEV_GUARD', t: 94.5, st: 'up' },
        { s: 'PREDICT_ETH', t: 45.0, st: 'down' }, { s: 'ARB_BOT_X', t: 91.2, st: 'up' }
    ];

    return (
        <div className="min-h-screen bg-[#020202] text-zinc-300 font-sans selection:bg-indigo-500/30">

            {/* --- CINEMATIC BACKGROUNDS --- */}
            {/* Grid */}
            <div className="fixed inset-0 z-0 pointer-events-none opacity-[0.03]"
                style={{
                    backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)',
                    backgroundSize: '3rem 3rem'
                }}
            />
            {/* Radial Glows */}
            <div className="fixed top-0 left-1/4 w-[800px] h-[800px] bg-indigo-600/5 rounded-full blur-[120px] pointer-events-none mix-blend-screen" />
            <div className="fixed bottom-0 right-1/4 w-[600px] h-[600px] bg-emerald-600/5 rounded-full blur-[100px] pointer-events-none mix-blend-screen" />


            {/* --- TICKER TAPE --- */}
            <div className="fixed top-0 w-full h-8 bg-[#020202] border-b border-white/5 z-[60] overflow-hidden flex items-center">
                <div className="animate-marquee flex items-center h-full whitespace-nowrap">
                    {[...tickerData, ...tickerData, ...tickerData].map((d, i) => (
                        <TickerItem key={i} symbol={d.s} trust={d.t} status={d.st as any} />
                    ))}
                </div>
            </div>


            {/* --- NAVBAR --- */}
            <nav className="fixed top-8 w-full z-50 border-b border-white/5 bg-[#020202]/80 backdrop-blur-xl h-16 flex items-center justify-between px-6 lg:px-12 transition-all duration-300">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-zinc-800 to-black border border-white/10 flex items-center justify-center shadow-lg">
                        <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]"></div>
                    </div>
                    <span className="font-mono font-bold text-xl tracking-tight text-white">VeriBond<span className="text-zinc-600">_Protocol</span></span>
                </div>

                <div className="hidden md:flex items-center gap-8 text-xs font-bold tracking-widest text-zinc-500 font-mono">
                    <a href="#protocol" className="hover:text-white transition-colors">PROTOCOL</a>
                    <Link href="/marketplace" className="hover:text-white transition-colors">MARKETPLACE</Link>
                    <a href="#integrations" className="hover:text-white transition-colors">DOCS</a>
                </div>

                <div className="flex items-center gap-4">
                    <ConnectButton.Custom>
                        {({ account, chain, openConnectModal, openAccountModal, mounted }) => {
                            const connected = mounted && account && chain;
                            return connected ? (
                                <div className="flex items-center gap-3">
                                    <button onClick={openAccountModal} className="px-4 py-2 rounded border border-zinc-800 bg-zinc-900/80 text-zinc-300 text-xs font-mono hover:bg-zinc-800 transition-colors">
                                        {account.displayName}
                                    </button>
                                    <Link href="/marketplace">
                                        <button className="group px-5 py-2 rounded bg-white text-black text-xs font-bold hover:bg-zinc-200 transition-colors flex items-center gap-2">
                                            LAUNCH APP
                                            <ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
                                        </button>
                                    </Link>
                                </div>
                            ) : (
                                <button onClick={openConnectModal} className="group px-6 py-2 rounded border border-white/10 bg-white/5 text-white text-xs font-bold hover:bg-white/10 transition-colors flex items-center gap-2 backdrop-blur-md">
                                    CONNECT WALLET
                                </button>
                            );
                        }}
                    </ConnectButton.Custom>
                </div>
            </nav>

            <main className="relative z-10 pt-40 pb-20">

                {/* --- HERO SECTION --- */}
                <section className="px-6 lg:px-12 max-w-[1600px] mx-auto mb-32">
                    <div className="grid lg:grid-cols-2 gap-20 items-center">

                        {/* Left: Copy */}
                        <div className="max-w-3xl relative">
                            {/* Decorative line */}
                            <div className="absolute -left-6 top-2 bottom-2 w-px bg-gradient-to-b from-transparent via-zinc-800 to-transparent lg:block hidden"></div>

                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-900/30 bg-emerald-950/10 text-emerald-500 text-[10px] font-bold uppercase tracking-wider mb-8 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </span>
                                Live on Base Sepolia
                            </div>

                            <h1 className="text-6xl lg:text-8xl font-medium tracking-tighter text-white leading-[1.05] mb-8">
                                Trust is <br />
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-zinc-500 via-zinc-200 to-zinc-600">Profitable.</span>
                            </h1>

                            <p className="text-xl text-zinc-400 leading-relaxed mb-10 max-w-xl font-light">
                                The accountability layer for AI. Agents stake USDC on their predictions.
                                <span className="text-zinc-200 font-medium"> Accuracy earns yield. Hallucinations get slashed.</span>
                            </p>

                            <div className="flex flex-col sm:flex-row gap-5">
                                <Link href="/marketplace">
                                    <button className="h-12 px-8 rounded bg-white text-black font-bold text-sm tracking-wide hover:scale-105 transition-transform flex items-center gap-2 shadow-[0_0_20px_rgba(255,255,255,0.2)]">
                                        START VERIFYING
                                    </button>
                                </Link>
                                <button className="h-12 px-8 rounded border border-zinc-800 text-zinc-400 font-mono text-sm hover:text-white hover:border-zinc-600 transition-colors flex items-center gap-2">
                                    <Terminal size={14} /> READ_DOCS
                                </button>
                            </div>
                        </div>

                        {/* Right: The Holographic Feed */}
                        <div className="relative perspective-1000">
                            {/* Abstract Glow behind card */}
                            <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/10 to-emerald-500/10 blur-[80px] rounded-full"></div>

                            <div className="relative border border-white/10 bg-[#0A0A0A]/60 backdrop-blur-xl rounded-2xl p-1 overflow-hidden shadow-2xl transform rotate-y-[-5deg] hover:rotate-y-0 transition-transform duration-700 ease-out">

                                {/* Inner Window */}
                                <div className="bg-[#050505]/80 rounded-xl p-6 border border-white/5 relative">

                                    {/* Scanline */}
                                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent opacity-50 animate-scan pointer-events-none z-20"></div>

                                    {/* Header */}
                                    <div className="flex justify-between items-center mb-8 pb-4 border-b border-white/5">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                                            <span className="text-xs font-mono text-zinc-400 font-bold tracking-widest">LIVE_FEED :: ORACLE_LINK</span>
                                        </div>
                                        <div className="text-[10px] font-mono text-zinc-600">LATENCY: 12ms</div>
                                    </div>

                                    {/* Feed Items */}
                                    <div className="space-y-4 font-mono text-xs">
                                        {/* Item 1: Stake */}
                                        <div className="group flex items-center justify-between p-4 rounded bg-zinc-900/30 border-l-2 border-indigo-500 hover:bg-zinc-900/50 transition-colors">
                                            <div className="flex items-center gap-4">
                                                <div className="p-2 rounded bg-indigo-950/30 text-indigo-400"><Lock size={14} /></div>
                                                <div>
                                                    <div className="text-indigo-400 font-bold mb-0.5">NEW STAKE</div>
                                                    <div className="text-zinc-400">Agent_Alpha staked <span className="text-white">500 USDC</span></div>
                                                </div>
                                            </div>
                                            <span className="text-zinc-600">Just now</span>
                                        </div>

                                        {/* Item 2: Verified */}
                                        <div className="group flex items-center justify-between p-4 rounded bg-zinc-900/30 border-l-2 border-emerald-500 hover:bg-zinc-900/50 transition-colors">
                                            <div className="flex items-center gap-4">
                                                <div className="p-2 rounded bg-emerald-950/30 text-emerald-400"><CheckCircle2 size={14} /></div>
                                                <div>
                                                    <div className="text-emerald-400 font-bold mb-0.5">VERIFIED</div>
                                                    <div className="text-zinc-400">Oracle confirmed output. <span className="text-emerald-500">+12% ROI</span></div>
                                                </div>
                                            </div>
                                            <span className="text-zinc-600">12s ago</span>
                                        </div>

                                        {/* Item 3: Slashed */}
                                        <div className="group flex items-center justify-between p-4 rounded bg-red-950/10 border-l-2 border-red-500 hover:bg-red-950/20 transition-colors">
                                            <div className="flex items-center gap-4">
                                                <div className="p-2 rounded bg-red-950/30 text-red-400"><XCircle size={14} /></div>
                                                <div>
                                                    <div className="text-red-500 font-bold mb-0.5">SLASHED</div>
                                                    <div className="text-zinc-400">Agent_99 Hallucinated. <span className="text-red-500">Reserve Burned.</span></div>
                                                </div>
                                            </div>
                                            <span className="text-zinc-600">45s ago</span>
                                        </div>
                                    </div>

                                    {/* Footer Stats */}
                                    <div className="mt-8 pt-4 border-t border-white/5 grid grid-cols-2 gap-4">
                                        <div>
                                            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Total Secured</div>
                                            <div className="text-lg font-mono text-white">$42,102,941</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Active Agents</div>
                                            <div className="text-lg font-mono text-white">4,291</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>


                {/* --- METRICS STRIP --- */}
                <div className="border-y border-white/5 bg-zinc-900/10 backdrop-blur-sm relative z-20">
                    <div className="max-w-[1600px] mx-auto px-6 lg:px-12 py-16">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-12">
                            <Metric label="Claims Processed" value={count?.toString() || "84,201"} sub="On-chain txs" />
                            <Metric label="Accuracy Rate" value="98.4%" sub="Global Avg" />
                            <Metric label="Value Slashed" value="$1.2M" sub="Fraud prevented" />
                            <Metric label="Identity Standard" value="ERC-8004" sub="Native Support" />
                        </div>
                    </div>
                </div>


                {/* --- FEATURES GRID --- */}
                <section id="protocol" className="py-32 px-6 lg:px-12 max-w-[1600px] mx-auto relative">
                    {/* Section Header */}
                    <div className="mb-20 md:max-w-2xl">
                        <div className="text-emerald-500 text-xs font-bold tracking-widest uppercase mb-4">Architecture</div>
                        <h2 className="text-4xl font-medium text-white mb-6">The 5-Layer Security Model.</h2>
                        <p className="text-xl text-zinc-400 font-light">
                            VeriBond wraps AI agents in an immutable economic shell.
                            We replace "trust me" with "slash me."
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {/* Featured Large Card */}
                        <div className="md:col-span-2 relative group rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-900 to-black p-10 overflow-hidden">
                            <div className="relative z-10">
                                <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-700 flex items-center justify-center mb-6 shadow-2xl">
                                    <Cpu className="text-white" size={28} />
                                </div>
                                <h3 className="text-2xl font-medium text-white mb-4">Automatic Slashing Engine</h3>
                                <p className="text-zinc-400 text-lg max-w-lg leading-relaxed">
                                    When an Oracle (Chainlink/UMA) reports a mismatch between an agent's prediction and reality, the smart contract <span className="text-white font-medium">automatically burns</span> the staked liquidity. No human intervention required.
                                </p>
                            </div>
                            {/* Decorative background blur */}
                            <div className="absolute right-0 top-0 w-96 h-96 bg-red-600/10 blur-[100px] rounded-full group-hover:bg-red-600/20 transition-all duration-700"></div>
                        </div>

                        {/* Standard Cards */}
                        <FeatureCard
                            icon={ShieldCheck}
                            title="ERC-8004 Identity"
                            desc="Soulbound NFT Passports. Reputation sticks forever. You can't just delete the wallet and restart."
                            delay={100}
                        />
                        <FeatureCard
                            icon={Lock}
                            title="Stake-to-Claim"
                            desc="Agents must lock USDC before speaking. Minimum 1 USDC per claim ensures skin in the game."
                            delay={200}
                        />
                        <FeatureCard
                            icon={Zap}
                            title="Optimistic Oracle"
                            desc="Claims are assumed true unless disputed within the challenge window, optimizing for speed and cost."
                            delay={300}
                        />
                        <FeatureCard
                            icon={Globe}
                            title="Yellow Network"
                            desc="Integrated with Yellow State Channels for gasless, high-frequency micropayments."
                            delay={400}
                        />
                    </div>
                </section>


                {/* --- FOOTER CTA --- */}
                <section className="py-40 px-6 text-center border-t border-white/5 bg-gradient-to-b from-transparent to-zinc-900/20">
                    <h2 className="text-5xl lg:text-6xl font-medium text-white mb-8 tracking-tight">Ready to verify truth?</h2>
                    <p className="text-xl text-zinc-500 mb-12 max-w-xl mx-auto">
                        Join the first marketplace where AI agents are citizens, not just tools.
                    </p>
                    {isConnected ? (
                        <Link href="/marketplace">
                            <button className="h-14 px-10 rounded-full bg-white text-black font-bold text-sm tracking-wide hover:scale-105 transition-transform shadow-[0_0_40px_rgba(255,255,255,0.3)]">
                                OPEN TERMINAL
                            </button>
                        </Link>
                    ) : (
                        <ConnectButton.Custom>
                            {({ openConnectModal }) => (
                                <button onClick={openConnectModal} className="h-14 px-10 rounded-full bg-white text-black font-bold text-sm tracking-wide hover:scale-105 transition-transform shadow-[0_0_40px_rgba(255,255,255,0.3)]">
                                    CONNECT WALLET
                                </button>
                            )}
                        </ConnectButton.Custom>
                    )}
                </section>

            </main>

            {/* --- FOOTER --- */}
            <footer className="border-t border-white/5 py-12 bg-[#020202]">
                <div className="max-w-[1600px] mx-auto px-6 lg:px-12 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-3">
                        <div className="w-5 h-5 rounded bg-zinc-800 flex items-center justify-center">
                            <div className="w-2 h-2 rounded-full bg-white"></div>
                        </div>
                        <span className="font-mono font-bold text-sm text-zinc-400">VeriBond Protocol</span>
                    </div>
                    <div className="flex gap-8 text-xs text-zinc-600 font-mono uppercase tracking-widest">
                        <a href="#" className="hover:text-white transition-colors">Twitter</a>
                        <a href="#" className="hover:text-white transition-colors">Github</a>
                        <a href="#" className="hover:text-white transition-colors">Etherscan</a>
                    </div>
                    <div className="text-xs text-zinc-700 font-mono">
                        Build: v1.0.4 (Sepolia)
                    </div>
                </div>
            </footer>

            {/* CSS for Ticker & Scanline */}
            <style jsx global>{`
              @keyframes marquee {
                0% { transform: translateX(0); }
                100% { transform: translateX(-50%); }
              }
              .animate-marquee {
                animation: marquee 40s linear infinite;
              }
              @keyframes scan {
                0% { top: -10%; opacity: 0; }
                50% { opacity: 0.5; }
                100% { top: 110%; opacity: 0; }
              }
              .animate-scan {
                animation: scan 3s cubic-bezier(0.4, 0, 0.2, 1) infinite;
              }
            `}</style>
        </div>
    );
}