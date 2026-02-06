'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContracts, useReadContract } from 'wagmi';
import { formatDistanceToNow, isPast, addSeconds } from 'date-fns';
import { useClaimDetails } from '@/hooks';
import { CONTRACTS, UMA_RESOLVER, UMA_TESTNET_ERC20 } from '@/lib/contracts';
import { TRUTH_STAKE_ABI, UMA_RESOLVER_ABI, ERC20_ABI } from '@/lib/abis';
import {
    ArrowLeft, Cpu, Clock, CheckCircle2, XCircle,
    Loader2, AlertTriangle, User, Lock, Zap, Timer, Shield
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

    // UMA assertion status
    const { data: umaStatus, refetch: refetchUmaStatus } = useReadContract({
        address: UMA_RESOLVER as `0x${string}`,
        abi: UMA_RESOLVER_ABI,
        functionName: 'getAssertionStatus',
        args: [claimId as `0x${string}`],
    });

    // UMA liveness period (5 minutes = 300 seconds)
    const { data: umaLiveness } = useReadContract({
        address: UMA_RESOLVER as `0x${string}`,
        abi: UMA_RESOLVER_ABI,
        functionName: 'liveness',
    });

    // Resolve transaction (TruthStake.resolve)
    const {
        data: resolveHash,
        isPending: isResolving,
        writeContractAsync: writeResolveAsync,
        error: resolveError
    } = useWriteContract();

    // Request Resolution transaction (UMAResolver.requestResolution)
    const {
        data: requestHash,
        isPending: isRequesting,
        writeContract: writeRequest,
        error: requestError
    } = useWriteContract();

    // Settle transaction (UMAResolver.settleAssertion)
    const {
        data: settleHash,
        isPending: isSettling,
        writeContract: writeSettle,
        error: settleError
    } = useWriteContract();

    const { isLoading: isResolveConfirming, isSuccess: isResolveConfirmed } = useWaitForTransactionReceipt({
        hash: resolveHash,
    });

    const { isLoading: isRequestConfirming, isSuccess: isRequestConfirmed } = useWaitForTransactionReceipt({
        hash: requestHash,
    });

    const { isLoading: isSettleConfirming, isSuccess: isSettleConfirmed } = useWaitForTransactionReceipt({
        hash: settleHash,
    });

    useEffect(() => {
        if (isRequestConfirmed) console.log('Request Resolution Confirmed!');
        if (isSettleConfirmed) console.log('Settle Confirmed!');
        if (isResolveConfirmed) console.log('Final Resolve Confirmed!');
    }, [isRequestConfirmed, isSettleConfirmed, isResolveConfirmed]);

    useEffect(() => {
        if (requestError) console.error('Request Error:', requestError);
        if (settleError) console.error('Settle Error:', settleError);
        if (resolveError) console.error('Resolve Error:', resolveError);
    }, [requestError, settleError, resolveError]);

    const [localResolved, setLocalResolved] = useState(false);

    useEffect(() => {
        if (isResolveConfirmed) {
            setLocalResolved(true);
        }
    }, [isResolveConfirmed]);

    useEffect(() => {
        if (isRequestConfirmed || isSettleConfirmed) {
            refetchUmaStatus();
        }
    }, [isRequestConfirmed, isSettleConfirmed, refetchUmaStatus]);

    // UMA status parsing
    const umaPending = (umaStatus as [boolean, boolean, boolean, `0x${string}`] | undefined)?.[0] ?? false;
    const umaResolved = (umaStatus as [boolean, boolean, boolean, `0x${string}`] | undefined)?.[1] ?? false;
    const umaOutcome = (umaStatus as [boolean, boolean, boolean, `0x${string}`] | undefined)?.[2] ?? false;
    const umaAssertionId = (umaStatus as [boolean, boolean, boolean, `0x${string}`] | undefined)?.[3];

    const handleRequestResolution = () => {
        console.log('Requesting Resolution...');
        // For demo, use a simple claim text - in production would fetch from IPFS or storage
        const claimText = `Agent prediction claim ${claimId.slice(0, 10)}...`;
        writeRequest({
            address: UMA_RESOLVER as `0x${string}`,
            abi: UMA_RESOLVER_ABI,
            functionName: 'requestResolution',
            args: [claimId as `0x${string}`, claimText, claim?.predictedOutcome ?? true],
        });
    };

    const handleSettle = () => {
        console.log('Settling Assertion...');
        writeSettle({
            address: UMA_RESOLVER as `0x${string}`,
            abi: UMA_RESOLVER_ABI,
            functionName: 'settleAssertion',
            args: [claimId as `0x${string}`],
        });
    };

    const handleResolve = async () => {
        console.log('Finalizing Resolution...');
        try {
            const txHash = await writeResolveAsync({
                address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
                abi: TRUTH_STAKE_ABI,
                functionName: 'resolve',
                args: [claimId as `0x${string}`],
            });
            console.log('Resolve Tx Sent:', txHash);
        } catch (e: any) {
            console.error('Resolve Failed Immediately:', e);
            alert(`Resolve Failed: ${e.message || e}`);
        }
    };

    // Determine claim status
    const resolvesAtDate = claim ? new Date(Number(claim.resolvesAt) * 1000) : null;
    const canStartResolution = claim && !claim.resolved && resolvesAtDate && isPast(resolvesAtDate) && !umaPending && !umaResolved;
    const canSettle = umaPending; // After liveness, user can settle
    const canFinalResolve = umaResolved && !claim?.resolved;
    const isResolved = claim?.resolved || localResolved;
    const slashPercent = Number((economicsData?.[0]?.result as bigint | undefined) ?? BigInt(50));
    const rewardBonusBps = Number((economicsData?.[1]?.result as bigint | undefined) ?? BigInt(500));
    const rewardSlashBps = Number((economicsData?.[2]?.result as bigint | undefined) ?? BigInt(5000));
    const protocolSlashBps = Number((economicsData?.[3]?.result as bigint | undefined) ?? BigInt(5000));
    const marketSlashBps = Number((economicsData?.[4]?.result as bigint | undefined) ?? BigInt(0));
    const livenessSeconds = Number(umaLiveness ?? BigInt(300));

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
                                ) : canStartResolution ? (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-yellow-950/30 border border-yellow-900/50 text-yellow-400 text-xs font-semibold">
                                        <Clock size={12} /> READY TO RESOLVE
                                    </span>
                                ) : umaPending ? (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-950/30 border border-purple-900/50 text-purple-400 text-xs font-semibold">
                                        <Timer size={12} /> UMA LIVENESS
                                    </span>
                                ) : canFinalResolve ? (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-950/30 border border-teal-900/50 text-teal-400 text-xs font-semibold">
                                        <CheckCircle2 size={12} /> READY TO FINALIZE
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

                        {/* Resolution Section - UMA Flow */}
                        {!isResolved && (
                            <div className="p-6 rounded-xl border border-white/5 bg-zinc-900/20 space-y-4">
                                <h3 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
                                    <Shield className="w-5 h-5 text-purple-500" />
                                    UMA Oracle Resolution
                                </h3>

                                {/* Step 1: Wait for resolution time */}
                                {resolvesAtDate && !isPast(resolvesAtDate) && (
                                    <div className="p-4 rounded-lg border border-white/5 bg-zinc-800/30">
                                        <div className="flex items-center gap-3 mb-2">
                                            <Lock className="w-5 h-5 text-zinc-500" />
                                            <span className="font-medium text-zinc-300">Awaiting Resolution Time</span>
                                        </div>
                                        <p className="text-sm text-zinc-500">
                                            This claim will be resolvable {formatDistanceToNow(resolvesAtDate, { addSuffix: true })}.
                                        </p>
                                    </div>
                                )}

                                {/* Step 2: Request UMA Resolution */}
                                {canStartResolution && (
                                    <div className="p-4 rounded-lg border border-yellow-900/30 bg-yellow-950/10">
                                        <div className="flex items-center gap-3 mb-2">
                                            <Zap className="w-5 h-5 text-yellow-500" />
                                            <span className="font-medium text-yellow-400">Step 1: Request Resolution</span>
                                        </div>
                                        <p className="text-sm text-zinc-400 mb-4">
                                            Submit this claim to UMA&apos;s Optimistic Oracle. The predicted outcome will be asserted and verified.
                                        </p>

                                        {requestError && (
                                            <div className="p-3 rounded-lg border border-red-900/50 bg-red-950/20 text-sm text-red-400 mb-4">
                                                {requestError.message}
                                            </div>
                                        )}

                                        <button
                                            onClick={handleRequestResolution}
                                            disabled={!isConnected || isRequesting || isRequestConfirming}
                                            className="px-6 py-3 rounded-lg bg-yellow-600 text-white font-semibold hover:bg-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                                        >
                                            {(isRequesting || isRequestConfirming) ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Requesting...
                                                </>
                                            ) : (
                                                <>
                                                    <Zap className="w-4 h-4" />
                                                    Request UMA Resolution
                                                </>
                                            )}
                                        </button>
                                    </div>
                                )}

                                {/* Step 3: Liveness Period / Settle */}
                                {canSettle && (
                                    <div className="p-4 rounded-lg border border-purple-900/30 bg-purple-950/10">
                                        <div className="flex items-center gap-3 mb-2">
                                            <Timer className="w-5 h-5 text-purple-500" />
                                            <span className="font-medium text-purple-400">Step 2: Liveness Period</span>
                                        </div>
                                        <p className="text-sm text-zinc-400 mb-2">
                                            Assertion submitted to UMA. Anyone can dispute during the {livenessSeconds / 60} minute liveness window.
                                        </p>
                                        <p className="text-xs text-zinc-500 mb-4">
                                            After the liveness period ends, click &quot;Settle&quot; to finalize the result.
                                        </p>

                                        {settleError && (
                                            <div className="p-3 rounded-lg border border-red-900/50 bg-red-950/20 text-sm text-red-400 mb-4">
                                                {settleError.message}
                                            </div>
                                        )}

                                        <button
                                            onClick={handleSettle}
                                            disabled={!isConnected || isSettling || isSettleConfirming}
                                            className="px-6 py-3 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                                        >
                                            {(isSettling || isSettleConfirming) ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Settling...
                                                </>
                                            ) : (
                                                <>
                                                    <Timer className="w-4 h-4" />
                                                    Settle Assertion
                                                </>
                                            )}
                                        </button>
                                    </div>
                                )}

                                {/* Step 4: Final Resolve */}
                                {canFinalResolve && (
                                    <div className="p-4 rounded-lg border border-teal-900/30 bg-teal-950/10">
                                        <div className="flex items-center gap-3 mb-2">
                                            <CheckCircle2 className="w-5 h-5 text-teal-500" />
                                            <span className="font-medium text-teal-400">Step 3: Finalize Resolution</span>
                                        </div>
                                        <p className="text-sm text-zinc-400 mb-2">
                                            UMA has verified the outcome: <strong className={umaOutcome ? 'text-teal-400' : 'text-red-400'}>{umaOutcome ? 'TRUE' : 'FALSE'}</strong>
                                        </p>
                                        <p className="text-xs text-zinc-500 mb-4">
                                            Click to finalize and execute the stake return or slash.
                                        </p>

                                        {resolveError && (
                                            <div className="p-3 rounded-lg border border-red-900/50 bg-red-950/20 text-sm text-red-400 mb-4">
                                                {resolveError.message}
                                            </div>
                                        )}

                                        <button
                                            onClick={handleResolve}
                                            disabled={!isConnected || isResolving || isResolveConfirming}
                                            className="px-6 py-3 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                                        >
                                            {(isResolving || isResolveConfirming) ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Finalizing...
                                                </>
                                            ) : (
                                                <>
                                                    <CheckCircle2 className="w-4 h-4" />
                                                    Finalize Resolution
                                                </>
                                            )}
                                        </button>
                                        {resolveHash && (
                                            <div className="mt-2 text-xs font-mono text-teal-500/70 break-all">
                                                Tx: {resolveHash}
                                            </div>
                                        )}
                                    </div>
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
