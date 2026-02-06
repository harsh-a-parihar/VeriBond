'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContracts } from 'wagmi';
import { formatDistanceToNow, isPast } from 'date-fns';
import { useClaimDetails } from '@/hooks';
import { CONTRACTS } from '@/lib/contracts';
import { TRUTH_STAKE_ABI } from '@/lib/abis';
import {
    ArrowLeft, Cpu, Clock, CheckCircle2, XCircle,
    Loader2, AlertTriangle, User, Lock
} from 'lucide-react';

// Format USDC amount
const formatUSDC = (val: bigint) => (Number(val) / 1e6).toFixed(2);

// Format address
const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

export default function ClaimDetailPage() {
    const params = useParams();
    const claimId = params.id as string;

    const { isConnected } = useAccount();
    const { claim, isLoading, error } = useClaimDetails(claimId as `0x${string}`);
    const { data: economicsData } = useReadContracts({
        contracts: [
            {
                address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
                abi: TRUTH_STAKE_ABI,
                functionName: 'slashPercent',
            },
            {
                address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
                abi: TRUTH_STAKE_ABI,
                functionName: 'rewardBonusBps',
            },
            {
                address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
                abi: TRUTH_STAKE_ABI,
                functionName: 'rewardSlashBps',
            },
            {
                address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
                abi: TRUTH_STAKE_ABI,
                functionName: 'protocolSlashBps',
            },
            {
                address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
                abi: TRUTH_STAKE_ABI,
                functionName: 'marketSlashBps',
            },
        ],
    });

    // Resolve transaction
    const {
        data: resolveHash,
        isPending: isResolving,
        writeContract: writeResolve,
        error: resolveError
    } = useWriteContract();

    const { isLoading: isResolveConfirming, isSuccess: isResolveConfirmed } = useWaitForTransactionReceipt({
        hash: resolveHash,
    });

    const [localResolved, setLocalResolved] = useState(false);

    useEffect(() => {
        if (isResolveConfirmed) {
            setLocalResolved(true);
        }
    }, [isResolveConfirmed]);

    const handleResolve = () => {
        writeResolve({
            address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
            abi: TRUTH_STAKE_ABI,
            functionName: 'resolve',
            args: [claimId as `0x${string}`],
        });
    };

    // Determine claim status
    const resolvesAtDate = claim ? new Date(Number(claim.resolvesAt) * 1000) : null;
    const canResolve = claim && !claim.resolved && resolvesAtDate && isPast(resolvesAtDate);
    const isResolved = claim?.resolved || localResolved;
    const slashPercent = Number((economicsData?.[0]?.result as bigint | undefined) ?? 50n);
    const rewardBonusBps = Number((economicsData?.[1]?.result as bigint | undefined) ?? 500n);
    const rewardSlashBps = Number((economicsData?.[2]?.result as bigint | undefined) ?? 5000n);
    const protocolSlashBps = Number((economicsData?.[3]?.result as bigint | undefined) ?? 5000n);
    const marketSlashBps = Number((economicsData?.[4]?.result as bigint | undefined) ?? 0n);

    return (
        <div className="min-h-screen bg-[#09090b] text-zinc-200 font-sans">
            {/* Navigation */}
            <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-[#09090b]/80 backdrop-blur-xl h-16 flex items-center justify-between px-6 lg:px-12">
                <div className="flex items-center gap-6">
                    <Link href="/dashboard" className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors">
                        <ArrowLeft size={16} />
                        <span className="text-xs font-medium">Back</span>
                    </Link>
                </div>
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded border border-zinc-800 bg-zinc-900 flex items-center justify-center">
                        <Cpu className="w-4 h-4 text-teal-500" />
                    </div>
                    <span className="font-mono font-bold text-lg tracking-tight text-zinc-100">
                        VeriBond<span className="text-zinc-600">_Claim</span>
                    </span>
                </div>
                <ConnectButton.Custom>
                    {({ account, chain, openConnectModal, openAccountModal, mounted }) => {
                        const connected = mounted && account && chain;
                        return (
                            <button
                                onClick={connected ? openAccountModal : openConnectModal}
                                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${connected
                                        ? 'bg-teal-950/30 border border-teal-900/50 text-teal-500'
                                        : 'bg-teal-600 text-white'
                                    }`}
                            >
                                {connected ? account.displayName : 'Connect'}
                            </button>
                        );
                    }}
                </ConnectButton.Custom>
            </nav>

            {/* Main Content */}
            <main className="pt-24 px-6 lg:px-12 pb-12 max-w-3xl mx-auto">
                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
                    </div>
                ) : error || !claim ? (
                    <div className="p-8 rounded-xl border border-red-900/30 bg-red-950/10 text-center">
                        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-zinc-300 mb-2">Claim Not Found</h3>
                        <p className="text-zinc-500">The claim ID may be invalid or the claim doesn&apos;t exist.</p>
                        <div className="mt-4 text-xs font-mono text-zinc-600 break-all">
                            ID: {claimId}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Header */}
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                {isResolved ? (
                                    claim.wasCorrect ? (
                                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-950/30 border border-teal-900/50 text-teal-400 text-xs font-semibold">
                                            <CheckCircle2 size={12} /> CORRECT
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-950/30 border border-red-900/50 text-red-400 text-xs font-semibold">
                                            <XCircle size={12} /> SLASHED
                                        </span>
                                    )
                                ) : canResolve ? (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-yellow-950/30 border border-yellow-900/50 text-yellow-400 text-xs font-semibold">
                                        <Clock size={12} /> READY TO RESOLVE
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-950/30 border border-blue-900/50 text-blue-400 text-xs font-semibold">
                                        <Clock size={12} /> PENDING
                                    </span>
                                )}
                            </div>
                            <h1 className="text-2xl font-bold text-zinc-100">Claim Details</h1>
                        </div>

                        {/* Claim Info Card */}
                        <div className="p-6 rounded-xl border border-white/5 bg-zinc-900/30 space-y-4">
                            {/* Claim Hash */}
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Claim Hash</div>
                                <div className="text-sm font-mono text-zinc-300 break-all">{claim.claimHash}</div>
                            </div>

                            {/* Agent & Submitter */}
                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Agent ID</div>
                                    <div className="text-lg font-mono text-zinc-200">#{claim.agentId.toString()}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Submitter</div>
                                    <div className="flex items-center gap-2 text-sm text-zinc-300">
                                        <User size={14} className="text-zinc-500" />
                                        {formatAddress(claim.submitter)}
                                    </div>
                                </div>
                            </div>

                            {/* Stake & Prediction */}
                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Stake Amount</div>
                                    <div className="text-xl font-mono font-semibold text-teal-400">
                                        ${formatUSDC(claim.stake)} USDC
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Predicted Outcome</div>
                                    <div className={`text-lg font-semibold ${claim.predictedOutcome ? 'text-teal-400' : 'text-red-400'}`}>
                                        {claim.predictedOutcome ? '✓ TRUE' : '✗ FALSE'}
                                    </div>
                                </div>
                            </div>

                            {/* Times */}
                            <div className="grid grid-cols-2 gap-6 pt-4 border-t border-white/5">
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Submitted</div>
                                    <div className="text-sm text-zinc-300">
                                        {new Date(Number(claim.submittedAt) * 1000).toLocaleString()}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Resolves At</div>
                                    <div className="text-sm text-zinc-300">
                                        {resolvesAtDate?.toLocaleString()}
                                        {resolvesAtDate && !isPast(resolvesAtDate) && (
                                            <span className="text-zinc-500 ml-2">
                                                ({formatDistanceToNow(resolvesAtDate, { addSuffix: true })})
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Resolution Section */}
                        {!isResolved && (
                            <div className={`p-6 rounded-xl border ${canResolve ? 'border-yellow-900/30 bg-yellow-950/10' : 'border-white/5 bg-zinc-900/20'}`}>
                                {canResolve ? (
                                    <>
                                        <h3 className="text-lg font-semibold text-zinc-100 mb-2">Ready for Resolution</h3>
                                        <p className="text-sm text-zinc-400 mb-4">
                                            The resolution time has passed. Anyone can trigger the resolution to verify the oracle outcome.
                                        </p>

                                        {resolveError && (
                                            <div className="p-3 rounded-lg border border-red-900/50 bg-red-950/20 text-sm text-red-400 mb-4">
                                                {resolveError.message}
                                            </div>
                                        )}

                                        <button
                                            onClick={handleResolve}
                                            disabled={!isConnected || isResolving || isResolveConfirming}
                                            className="px-6 py-3 rounded-lg bg-yellow-600 text-white font-semibold hover:bg-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                                        >
                                            {(isResolving || isResolveConfirming) ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Resolving...
                                                </>
                                            ) : (
                                                'Resolve Claim'
                                            )}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-3 mb-2">
                                            <Lock className="w-5 h-5 text-zinc-500" />
                                            <h3 className="text-lg font-semibold text-zinc-400">Awaiting Resolution Time</h3>
                                        </div>
                                        <p className="text-sm text-zinc-500">
                                            This claim will be resolvable {resolvesAtDate ? formatDistanceToNow(resolvesAtDate, { addSuffix: true }) : 'soon'}.
                                        </p>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Resolved Result */}
                        {isResolved && (
                            <div className={`p-6 rounded-xl border ${claim.wasCorrect ? 'border-teal-900/30 bg-teal-950/10' : 'border-red-900/30 bg-red-950/10'}`}>
                                <div className="flex items-center gap-3 mb-2">
                                    {claim.wasCorrect ? (
                                        <CheckCircle2 className="w-6 h-6 text-teal-500" />
                                    ) : (
                                        <XCircle className="w-6 h-6 text-red-500" />
                                    )}
                                    <h3 className={`text-xl font-bold ${claim.wasCorrect ? 'text-teal-400' : 'text-red-400'}`}>
                                        {claim.wasCorrect ? 'Prediction Correct!' : 'Prediction Incorrect - Slashed'}
                                    </h3>
                                </div>
                                <p className={`text-sm ${claim.wasCorrect ? 'text-teal-500/70' : 'text-red-500/70'}`}>
                                    {claim.wasCorrect
                                        ? `Stake was returned. Bonus can be paid from the reward vault (up to ${(rewardBonusBps / 100).toFixed(2)}% of stake).`
                                        : `${slashPercent}% of stake was slashed. Current split: reward ${(rewardSlashBps / 100).toFixed(2)}% / protocol ${(protocolSlashBps / 100).toFixed(2)}% / market ${(marketSlashBps / 100).toFixed(2)}%.`
                                    }
                                </p>
                            </div>
                        )}

                        {/* Claim ID Footer */}
                        <div className="text-center text-xs font-mono text-zinc-600 pt-4">
                            Claim ID: {claimId}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
