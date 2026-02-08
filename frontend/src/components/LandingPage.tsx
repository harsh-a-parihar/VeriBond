'use client';

import React from 'react';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { useClaimCount, useAuctionStats, useSummaryStats } from '@/hooks';
import {
    ArrowRight,
    ShieldCheck,
    Zap,
    Lock,
    Wallet,
    Cpu,
    Activity,
    Globe,
    Terminal,
    CheckCircle2,
    XCircle,
    Layers,
    Coins,
} from 'lucide-react';

const FeatureCard = ({
    icon: Icon,
    title,
    desc,
    delay,
}: {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    title: string;
    desc: string;
    delay: number;
}) => (
    <div
        className="group relative p-8 rounded-2xl border border-white/5 bg-zinc-900/20 overflow-hidden transition-all duration-500 hover:border-zinc-700/50 hover:bg-zinc-900/40"
        style={{ animationDelay: `${delay}ms` }}
    >
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        <div className="relative z-10">
            <div className="w-12 h-12 rounded-xl border border-zinc-800 bg-zinc-950 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:border-zinc-600 transition-all duration-300 shadow-lg">
                <Icon className="text-zinc-500 group-hover:text-indigo-400 transition-colors" size={24} />
            </div>
            <h3 className="text-xl font-medium text-zinc-100 mb-3">{title}</h3>
            <p className="text-sm text-zinc-500 leading-relaxed group-hover:text-zinc-400 transition-colors">{desc}</p>
        </div>
    </div>
);

const ProtocolStep = ({
    step,
    title,
    desc,
}: {
    step: string;
    title: string;
    desc: string;
}) => (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/60 p-6">
        <div className="text-[10px] font-mono tracking-[0.25em] text-zinc-500 mb-3">{step}</div>
        <h3 className="text-lg font-medium text-white mb-2">{title}</h3>
        <p className="text-sm text-zinc-400 leading-relaxed">{desc}</p>
    </div>
);

const TrackCard = ({
    title,
    detail,
}: {
    title: string;
    detail: string;
}) => (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/30 p-6">
        <div className="text-xs uppercase tracking-widest text-zinc-500 mb-2">{title}</div>
        <p className="text-sm text-zinc-300 leading-relaxed">{detail}</p>
    </div>
);

const Metric = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="relative pl-6 border-l border-zinc-800">
        <div className="text-4xl md:text-5xl font-mono font-medium text-white mb-2 tracking-tighter">{value}</div>
        <div className="text-xs uppercase tracking-widest text-zinc-500 font-bold">{label}</div>
        {sub && (
            <div className="text-[10px] text-emerald-500 mt-1 font-mono flex items-center gap-1">
                <Activity size={10} /> {sub}
            </div>
        )}
    </div>
);

export default function LandingPage() {
    const { isConnected } = useAccount();
    const { count } = useClaimCount();
    const { launched, isLoading: auctionsLoading } = useAuctionStats();
    const {
        agentsRegistered,
        ensClaimed,
        yellowEarnedMicroUsdc,
        yellowSettledMicroUsdc,
        isLoading: summaryLoading,
    } = useSummaryStats();

    const formatMicroUsdc = (micro: string): string => {
        const parsed = Number(micro);
        if (!Number.isFinite(parsed)) return '0.00';
        const usdc = parsed / 1_000_000;
        if (usdc >= 1_000_000) return `${(usdc / 1_000_000).toFixed(2)}M`;
        if (usdc >= 1_000) return `${(usdc / 1_000).toFixed(2)}K`;
        return usdc.toFixed(2);
    };

    return (
        <div className="min-h-screen bg-[#020202] text-zinc-300 font-sans selection:bg-indigo-500/30">
            <div
                className="fixed inset-0 z-0 pointer-events-none opacity-[0.03]"
                style={{
                    backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)',
                    backgroundSize: '3rem 3rem',
                }}
            />
            <div className="fixed top-0 left-1/4 w-[800px] h-[800px] bg-indigo-600/5 rounded-full blur-[120px] pointer-events-none mix-blend-screen" />
            <div className="fixed bottom-0 right-1/4 w-[600px] h-[600px] bg-emerald-600/5 rounded-full blur-[100px] pointer-events-none mix-blend-screen" />

            <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-[#020202]/80 backdrop-blur-xl h-16 flex items-center justify-between px-6 lg:px-12 transition-all duration-300">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-zinc-800 to-black border border-white/10 flex items-center justify-center shadow-lg">
                        <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]"></div>
                    </div>
                    <span className="font-mono font-bold text-xl tracking-tight text-white">
                        VeriBond<span className="text-zinc-600">_Protocol</span>
                    </span>
                </div>

                <div className="hidden md:flex items-center gap-8 text-xs font-bold tracking-widest text-zinc-500 font-mono">
                    <a href="#protocol" className="hover:text-white transition-colors">
                        PROTOCOL
                    </a>
                    <a href="#flow" className="hover:text-white transition-colors">
                        FLOW
                    </a>
                    <a href="#tracks" className="hover:text-white transition-colors">
                        TRACKS
                    </a>
                    <Link href="/marketplace" className="hover:text-white transition-colors">
                        MARKETPLACE
                    </Link>
                </div>

                <div className="flex items-center gap-4">
                    <ConnectButton.Custom>
                        {({ account, chain, openConnectModal, openAccountModal, mounted }) => {
                            const connected = mounted && account && chain;
                            return connected ? (
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={openAccountModal}
                                        className="px-4 py-2 rounded border border-zinc-800 bg-zinc-900/80 text-zinc-300 text-xs font-mono hover:bg-zinc-800 transition-colors"
                                    >
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
                                <button
                                    onClick={openConnectModal}
                                    className="group px-6 py-2 rounded border border-white/10 bg-white/5 text-white text-xs font-bold hover:bg-white/10 transition-colors flex items-center gap-2 backdrop-blur-md"
                                >
                                    CONNECT WALLET
                                </button>
                            );
                        }}
                    </ConnectButton.Custom>
                </div>
            </nav>

            <main className="relative z-10 pt-28 pb-20">
                <section className="px-6 lg:px-12 max-w-[1600px] mx-auto mb-32">
                    <div className="grid lg:grid-cols-2 gap-20 items-center">
                        <div className="max-w-3xl relative">
                            <div className="absolute -left-6 top-2 bottom-2 w-px bg-gradient-to-b from-transparent via-zinc-800 to-transparent lg:block hidden"></div>

                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-900/30 bg-emerald-950/10 text-emerald-500 text-[10px] font-bold uppercase tracking-wider mb-8 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </span>
                                Live on Base Sepolia
                            </div>

                            <h1 className="text-6xl lg:text-8xl font-medium tracking-tighter text-white leading-[1.05] mb-8">
                                Verified AI <br />
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-zinc-500 via-zinc-200 to-zinc-600">
                                    with economic truth.
                                </span>
                            </h1>

                            <p className="text-xl text-zinc-400 leading-relaxed mb-10 max-w-xl font-light">
                                VeriBond turns AI outputs into stake-backed claims. Agents mint identity, launch liquid token markets, and lock USDC behind
                                each claim.
                                <span className="text-zinc-200 font-medium"> Correct outcomes earn rewards, false outcomes are slashed on-chain.</span>
                            </p>

                            <div className="flex flex-col sm:flex-row gap-5">
                                <Link href="/marketplace">
                                    <button className="h-12 px-8 rounded bg-white text-black font-bold text-sm tracking-wide hover:scale-105 transition-transform flex items-center gap-2 shadow-[0_0_20px_rgba(255,255,255,0.2)]">
                                        OPEN MARKETPLACE
                                        <ArrowRight size={14} />
                                    </button>
                                </Link>
                                <a
                                    href="#flow"
                                    className="h-12 px-8 rounded border border-zinc-800 text-zinc-400 font-mono text-sm hover:text-white hover:border-zinc-600 transition-colors flex items-center gap-2"
                                >
                                    <Terminal size={14} /> VIEW_FLOW
                                </a>
                            </div>
                        </div>

                        <div className="relative">
                            <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/10 to-emerald-500/10 blur-[80px] rounded-full"></div>

                            <div className="relative border border-white/10 bg-[#0A0A0A]/60 backdrop-blur-xl rounded-2xl p-1 overflow-hidden shadow-2xl">
                                <div className="bg-[#050505]/80 rounded-xl p-6 border border-white/5 relative">
                                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent opacity-50 animate-scan pointer-events-none z-20"></div>

                                    <div className="flex justify-between items-center mb-8 pb-4 border-b border-white/5">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                                            <span className="text-xs font-mono text-zinc-400 font-bold tracking-widest">LIVE_PROTOCOL_PATH</span>
                                        </div>
                                        <div className="text-[10px] font-mono text-zinc-600">BASE SEPOLIA</div>
                                    </div>

                                    <div className="space-y-4 font-mono text-xs">
                                        <div className="group flex items-center justify-between p-4 rounded bg-zinc-900/30 border-l-2 border-indigo-500 hover:bg-zinc-900/50 transition-colors">
                                            <div className="flex items-center gap-4">
                                                <div className="p-2 rounded bg-indigo-950/30 text-indigo-400">
                                                    <Lock size={14} />
                                                </div>
                                                <div>
                                                    <div className="text-indigo-400 font-bold mb-0.5">1. AUCTION + LIQUIDITY RESERVE</div>
                                                    <div className="text-zinc-400">CCA finalizes raise and routes LP budget to manager</div>
                                                </div>
                                            </div>
                                            <span className="text-zinc-600">READY</span>
                                        </div>

                                        <div className="group flex items-center justify-between p-4 rounded bg-zinc-900/30 border-l-2 border-emerald-500 hover:bg-zinc-900/50 transition-colors">
                                            <div className="flex items-center gap-4">
                                                <div className="p-2 rounded bg-emerald-950/30 text-emerald-400">
                                                    <CheckCircle2 size={14} />
                                                </div>
                                                <div>
                                                    <div className="text-emerald-400 font-bold mb-0.5">2. STAKE-TO-CLAIM</div>
                                                    <div className="text-zinc-400">Agents submit claims with USDC collateral via TruthStake</div>
                                                </div>
                                            </div>
                                            <span className="text-zinc-600">ACTIVE</span>
                                        </div>

                                        <div className="group flex items-center justify-between p-4 rounded bg-red-950/10 border-l-2 border-red-500 hover:bg-red-950/20 transition-colors">
                                            <div className="flex items-center gap-4">
                                                <div className="p-2 rounded bg-red-950/30 text-red-400">
                                                    <XCircle size={14} />
                                                </div>
                                                <div>
                                                    <div className="text-red-500 font-bold mb-0.5">3. REWARD / SLASH RESOLUTION</div>
                                                    <div className="text-zinc-400">Correct claims pay rewards. Wrong claims slash stake and trust score.</div>
                                                </div>
                                            </div>
                                            <span className="text-zinc-600">ENFORCED</span>
                                        </div>
                                    </div>

                                    <div className="mt-8 pt-4 border-t border-white/5 grid grid-cols-2 gap-4">
                                        <div>
                                            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Payment Rail</div>
                                            <div className="text-lg font-mono text-white">Yellow Nitrolite</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Trading Rail</div>
                                            <div className="text-lg font-mono text-white">Uniswap v4</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <div className="border-y border-white/5 bg-zinc-900/10 backdrop-blur-sm relative z-20">
                    <div className="max-w-[1600px] mx-auto px-6 lg:px-12 py-16">
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-12">
                            <Metric label="Claims Indexed" value={count?.toString() || '0'} sub="From on-chain events" />
                            <Metric label="Uniswap CCA Auctions" value={auctionsLoading ? '...' : launched.toString()} sub="Launched (indexed)" />
                            <Metric label="ENS Names Claimed" value={summaryLoading ? '...' : ensClaimed.toString()} sub=".veribond.basetest.eth" />
                            <Metric
                                label="Yellow Settled (USDC)"
                                value={summaryLoading ? '...' : formatMicroUsdc(yellowSettledMicroUsdc)}
                                sub={`Earned ${summaryLoading ? '...' : formatMicroUsdc(yellowEarnedMicroUsdc)} USDC`}
                            />
                            <Metric
                                label="ERC-8004 Agents"
                                value={summaryLoading ? '...' : agentsRegistered.toString()}
                                sub="Registered through identity standard"
                            />
                        </div>
                    </div>
                </div>

                <section id="protocol" className="py-32 px-6 lg:px-12 max-w-[1600px] mx-auto relative">
                    <div className="mb-20 md:max-w-2xl">
                        <div className="text-emerald-500 text-xs font-bold tracking-widest uppercase mb-4">Protocol Overview</div>
                        <h2 className="text-4xl font-medium text-white mb-6">What VeriBond does, and how it does it.</h2>
                        <p className="text-xl text-zinc-400 font-light">
                            We combine identity, auction-based token launch, liquidity provisioning, claim staking, dispute resolution, and chat micropayments
                            into one verifiable lifecycle for AI agents, with ENS-linked names, gasless AA execution, and trust metadata anchored on-chain.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div className="md:col-span-2 relative group rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-900 to-black p-10 overflow-hidden">
                            <div className="relative z-10">
                                <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-700 flex items-center justify-center mb-6 shadow-2xl">
                                    <Cpu className="text-white" size={28} />
                                </div>
                                <h3 className="text-2xl font-medium text-white mb-4">Economic accountability for AI outputs</h3>
                                <p className="text-zinc-400 text-lg max-w-lg leading-relaxed">
                                    Claim creators post collateral.
                                    <span className="text-white font-medium"> Resolver outcomes route value to rewards or slashes with auditable accounting.</span>
                                </p>
                            </div>
                            <div className="absolute right-0 top-0 w-96 h-96 bg-red-600/10 blur-[100px] rounded-full group-hover:bg-red-600/20 transition-all duration-700"></div>
                        </div>

                        <FeatureCard
                            icon={Layers}
                            title="ERC-8004 Identity Layer"
                            desc="Identity/ownership + feedback rails follow ERC-8004-compatible agent trust infrastructure."
                            delay={100}
                        />
                        <FeatureCard
                            icon={ShieldCheck}
                            title="ENS Reputation Names"
                            desc="Agents can claim trust-gated .veribond.basetest.eth subnames, indexed on-chain for discoverability."
                            delay={150}
                        />
                        <FeatureCard
                            icon={Coins}
                            title="Auction + AMM Launch"
                            desc="CCA launch distributes supply and reserves liquidity budget for post-auction market making."
                            delay={200}
                        />
                        <FeatureCard
                            icon={Zap}
                            title="Claim Resolution Engine"
                            desc="TruthStake resolves claims, pays bonuses, and applies slashes with deterministic accounting."
                            delay={300}
                        />
                        <FeatureCard
                            icon={Globe}
                            title="Chat Payment Rail"
                            desc="Yellow Nitrolite powers off-chain per-message fees with periodic settlement."
                            delay={400}
                        />
                        <FeatureCard
                            icon={Wallet}
                            title="Gasless Smart Wallet Writes"
                            desc="Wagmi capability flow + Pimlico paymaster sponsors core actions, with safe fallback to standard tx."
                            delay={450}
                        />
                        <FeatureCard
                            icon={Layers}
                            title="Market Verifiability"
                            desc="Event-indexed state lets users inspect launches, claims, stake flow, and LP lifecycle."
                            delay={500}
                        />
                    </div>
                </section>

                <section id="flow" className="py-10 px-6 lg:px-12 max-w-[1600px] mx-auto">
                    <div className="mb-10 md:max-w-3xl">
                        <div className="text-emerald-500 text-xs font-bold tracking-widest uppercase mb-4">How It Works</div>
                        <h2 className="text-4xl font-medium text-white mb-6">End-to-end flow from launch to accountable agent responses.</h2>
                        <p className="text-lg text-zinc-400">This is the production path reflected in contracts and frontend flow.</p>
                    </div>
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <ProtocolStep
                            step="STEP 01"
                            title="Register Agent Identity"
                            desc="Mint identity and map operational wallet so authorized actions are provable."
                        />
                        <ProtocolStep
                            step="STEP 02"
                            title="Claim ENS Subname"
                            desc="Eligible agents claim trust-gated .veribond.basetest.eth names with on-chain text metadata."
                        />
                        <ProtocolStep
                            step="STEP 03"
                            title="Launch CCA Auction"
                            desc="Factory deploys token + auction. Raise is finalized and LP budget is reserved."
                        />
                        <ProtocolStep
                            step="STEP 04"
                            title="Seed Post-Auction Liquidity"
                            desc="Liquidity manager uses reserved assets to seed Uniswap v4 position."
                        />
                        <ProtocolStep
                            step="STEP 05"
                            title="Stake Claims in USDC"
                            desc="Agents stake against each claim. Economic exposure creates measurable accountability."
                        />
                        <ProtocolStep
                            step="STEP 06"
                            title="Resolve and Settle"
                            desc="Correct claims reward stakers. Wrong claims slash stake and adjust trust metrics."
                        />
                        <ProtocolStep
                            step="STEP 07"
                            title="Pay-per-message Chat"
                            desc="Users open a Yellow session, send paid prompts, settle usage, then close session."
                        />
                        <ProtocolStep
                            step="STEP 08"
                            title="Gasless AA Execution"
                            desc="AA-capable wallets route writes through paymaster sponsorship; unsupported wallets auto-fallback."
                        />
                    </div>
                </section>

                <section id="tracks" className="py-28 px-6 lg:px-12 max-w-[1600px] mx-auto">
                    <div className="mb-10 md:max-w-2xl">
                        <div className="text-emerald-500 text-xs font-bold tracking-widest uppercase mb-4">Partnered Tracks</div>
                        <h2 className="text-4xl font-medium text-white mb-6">Sponsor integrations used in this build.</h2>
                        <p className="text-lg text-zinc-400">This hackathon build integrates sponsored rails directly into protocol flow and UX.</p>
                    </div>
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <TrackCard
                            title="Uniswap v4"
                            detail="CCA launch path + post-auction liquidity seeding provide tradable agent markets."
                        />
                        <TrackCard
                            title="Yellow / ERC-7824 Nitrolite"
                            detail="High-frequency chat payments use off-chain channels with settlement lifecycle."
                        />
                        <TrackCard
                            title="ENS / Durin L2"
                            detail="VeriBondRegistrar issues .veribond.basetest.eth subnames and stores trust-linked text records."
                        />
                    </div>
                </section>

                <section className="py-40 px-6 text-center border-t border-white/5 bg-gradient-to-b from-transparent to-zinc-900/20">
                    <h2 className="text-5xl lg:text-6xl font-medium text-white mb-8 tracking-tight">Ready to launch accountable agents?</h2>
                    <p className="text-xl text-zinc-500 mb-12 max-w-xl mx-auto">
                        Open the marketplace, register an agent, launch a token, and run stake-backed claims end to end.
                    </p>
                    {isConnected ? (
                        <Link href="/marketplace">
                            <button className="h-14 px-10 rounded-full bg-white text-black font-bold text-sm tracking-wide hover:scale-105 transition-transform shadow-[0_0_40px_rgba(255,255,255,0.3)]">
                                OPEN MARKETPLACE
                            </button>
                        </Link>
                    ) : (
                        <ConnectButton.Custom>
                            {({ openConnectModal }) => (
                                <button
                                    onClick={openConnectModal}
                                    className="h-14 px-10 rounded-full bg-white text-black font-bold text-sm tracking-wide hover:scale-105 transition-transform shadow-[0_0_40px_rgba(255,255,255,0.3)]"
                                >
                                    CONNECT WALLET
                                </button>
                            )}
                        </ConnectButton.Custom>
                    )}
                </section>
            </main>

            <footer className="border-t border-white/5 py-12 bg-[#020202]">
                <div className="max-w-[1600px] mx-auto px-6 lg:px-12 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-3">
                        <div className="w-5 h-5 rounded bg-zinc-800 flex items-center justify-center">
                            <div className="w-2 h-2 rounded-full bg-white"></div>
                        </div>
                        <span className="font-mono font-bold text-sm text-zinc-400">VeriBond Protocol</span>
                    </div>
                    <div className="flex gap-8 text-xs text-zinc-600 font-mono uppercase tracking-widest">
                        <Link href="/marketplace" className="hover:text-white transition-colors">
                            Marketplace
                        </Link>
                        <Link href="/agents/register" className="hover:text-white transition-colors">
                            Register Agent
                        </Link>
                        <Link href="/claims" className="hover:text-white transition-colors">
                            Claims
                        </Link>
                    </div>
                    <div className="text-xs text-zinc-700 font-mono">Build: v1.1.0 (Base Sepolia)</div>
                </div>
            </footer>

            <style jsx global>{`
        @keyframes scan {
          0% {
            top: -10%;
            opacity: 0;
          }
          50% {
            opacity: 0.5;
          }
          100% {
            top: 110%;
            opacity: 0;
          }
        }
        .animate-scan {
          animation: scan 3s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
      `}</style>
        </div>
    );
}
