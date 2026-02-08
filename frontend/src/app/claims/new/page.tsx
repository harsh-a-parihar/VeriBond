'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useReadContracts } from 'wagmi';
import { parseUnits, keccak256, toBytes } from 'viem';
import { useUSDCBalance, useUSDCAllowance, useMinStake } from '@/hooks';
import { CONTRACTS } from '@/lib/contracts';
import { TRUTH_STAKE_ABI, ERC20_ABI } from '@/lib/abis';
import { useAdaptiveWrite } from '@/hooks/useAdaptiveWrite';
import {
    ArrowLeft, Cpu, AlertCircle, CheckCircle2, Loader2, Lock, ChevronDown
} from 'lucide-react';

// Agent type for dropdown
interface Agent {
    id: string;
    name: string;
    owner?: string;
}

const formatUSDC = (amount: bigint) => (Number(amount) / 1e6).toFixed(2);

// Wrapper component with Suspense for useSearchParams
export default function SubmitClaimPageWrapper() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-[#09090b] text-zinc-200 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
            </div>
        }>
            <SubmitClaimPage />
        </Suspense>
    );
}

function SubmitClaimPage() {
    const searchParams = useSearchParams();
    const preselectedAgentId = searchParams.get('agentId');

    const { isConnected, address } = useAccount();
    const { balance: usdcBalance, balanceFormatted, refetch: refetchBalance } = useUSDCBalance();
    const { allowance, refetch: refetchAllowance } = useUSDCAllowance(CONTRACTS.TRUTH_STAKE);
    const { minStake } = useMinStake();
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
                functionName: 'maxBonusPerClaim',
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

    // Form state
    const [selectedAgentId, setSelectedAgentId] = useState<string>(preselectedAgentId || '');
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loadingAgents, setLoadingAgents] = useState(true);
    const [claimDescription, setClaimDescription] = useState('');
    const [stakeAmount, setStakeAmount] = useState('1');
    const [resolutionMinutes, setResolutionMinutes] = useState('5');
    const [predictedOutcome, setPredictedOutcome] = useState<boolean>(true);

    // Fetch user's agents
    useEffect(() => {
        const fetchAgents = async () => {
            if (!address) {
                setAgents([]);
                setLoadingAgents(false);
                return;
            }
            try {
                const res = await fetch('/api/agents');
                if (res.ok) {
                    const data = await res.json() as { agents?: Agent[] };
                    // Filter agents owned by the connected wallet
                    const ownedAgents = (data.agents || []).filter(
                        (agent) => agent.owner?.toLowerCase() === address.toLowerCase()
                    );
                    setAgents(ownedAgents);
                    // Auto-select if coming from agent page or only one agent
                    if (preselectedAgentId) {
                        setSelectedAgentId(preselectedAgentId);
                    } else if (ownedAgents.length === 1) {
                        setSelectedAgentId(ownedAgents[0].id);
                    }
                }
            } catch (e) {
                console.error('[Claims] Failed to fetch agents:', e);
            } finally {
                setLoadingAgents(false);
            }
        };
        fetchAgents();
    }, [address, preselectedAgentId]);

    // Transaction states
    const [step, setStep] = useState<'form' | 'approve' | 'submit' | 'success'>('form');

    const approveWrite = useAdaptiveWrite({ allowAA: true, fallbackToStandard: true });
    const submitWrite = useAdaptiveWrite({ allowAA: true, fallbackToStandard: true });

    // Calculate values
    const stakeInUsdc = parseUnits(stakeAmount || '0', 6);
    const needsApproval = allowance !== undefined && stakeInUsdc > allowance;
    const hasEnoughBalance = usdcBalance !== undefined && stakeInUsdc <= usdcBalance;
    const minStakeFormatted = minStake ? (Number(minStake) / 1e6).toString() : '1';
    const slashPercent = Number((economicsData?.[0]?.result as bigint | undefined) ?? BigInt(50));
    const rewardBonusBps = Number((economicsData?.[1]?.result as bigint | undefined) ?? BigInt(500));
    const maxBonusPerClaim = (economicsData?.[2]?.result as bigint | undefined) ?? BigInt(50_000_000);
    const rewardSlashBps = Number((economicsData?.[3]?.result as bigint | undefined) ?? BigInt(5000));
    const protocolSlashBps = Number((economicsData?.[4]?.result as bigint | undefined) ?? BigInt(5000));
    const marketSlashBps = Number((economicsData?.[5]?.result as bigint | undefined) ?? BigInt(0));

    // Generate claim hash from description
    const claimHash = claimDescription
        ? keccak256(toBytes(claimDescription))
        : '0x0000000000000000000000000000000000000000000000000000000000000000';

    // Calculate resolution timestamp
    const resolvesAt = Math.floor(Date.now() / 1000) + (parseInt(resolutionMinutes || '5') * 60);

    // Handle approve when confirmed
    useEffect(() => {
        if (approveWrite.isConfirmed) {
            refetchAllowance();
            setStep('submit');
        }
    }, [approveWrite.isConfirmed, refetchAllowance]);

    // Handle submit when confirmed
    useEffect(() => {
        if (submitWrite.isConfirmed) {
            refetchBalance();
            setStep('success');
        }
    }, [submitWrite.isConfirmed, refetchBalance]);

    useEffect(() => {
        if (submitWrite.error) console.error('Submit Error:', submitWrite.error);
        if (approveWrite.error) console.error('Approve Error:', approveWrite.error);
    }, [submitWrite.error, approveWrite.error]);

    const handleApprove = () => {
        console.log('Approving USDC:', { spender: CONTRACTS.TRUTH_STAKE, amount: stakeInUsdc });
        approveWrite.writeContract({
            address: CONTRACTS.USDC as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [CONTRACTS.TRUTH_STAKE as `0x${string}`, stakeInUsdc],
        });
        setStep('approve');
    };

    const handleSubmit = async () => {
        console.log('Submitting claim:', {
            agentId: selectedAgentId,
            claimHash,
            stake: stakeInUsdc,
            resolvesAt,
            outcome: predictedOutcome
        });

        if (!selectedAgentId) {
            alert('Please select an agent first.');
            return;
        }

        submitWrite.writeContract({
            address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
            abi: TRUTH_STAKE_ABI,
            functionName: 'submitClaim',
            args: [BigInt(selectedAgentId), claimHash as `0x${string}`, stakeInUsdc, BigInt(resolvesAt), predictedOutcome],
        });
        if (step === 'form') setStep('submit');
    };

    const canSubmit = selectedAgentId &&
        claimDescription.trim() &&
        parseFloat(stakeAmount) >= parseFloat(minStakeFormatted) &&
        hasEnoughBalance &&
        parseInt(resolutionMinutes) > 0;

    return (
        <div className="min-h-screen bg-[#09090b] text-zinc-200 font-sans">
            {/* Navigation */}
            <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-[#09090b]/80 backdrop-blur-xl h-16 flex items-center justify-between px-6 lg:px-12">
                <div className="flex items-center gap-6">
                    <Link href="/marketplace" className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors">
                        <ArrowLeft size={16} />
                        <span className="text-xs font-medium">Back</span>
                    </Link>
                </div>
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded border border-zinc-800 bg-zinc-900 flex items-center justify-center">
                        <Cpu className="w-4 h-4 text-teal-500" />
                    </div>
                    <span className="font-mono font-bold text-lg tracking-tight text-zinc-100">
                        VeriBond<span className="text-zinc-600">_Submit</span>
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
                                {connected ? account.displayName : 'Connect Wallet'}
                            </button>
                        );
                    }}
                </ConnectButton.Custom>
            </nav>

            {/* Main Content */}
            <main className="pt-24 px-6 lg:px-12 pb-12 max-w-2xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-zinc-100 mb-2">Submit Prediction Claim</h1>
                    <p className="text-zinc-500">
                        Stake USDC on a verifiable prediction.
                        {selectedAgentId && <span className="text-teal-400 ml-1">Agent #{selectedAgentId}</span>}
                    </p>
                </div>

                <div className="mb-6 p-3 rounded-lg border border-zinc-800 bg-zinc-900/20 text-xs">
                    <p className="text-zinc-300 font-semibold">Execution Mode: {submitWrite.modeLabel}</p>
                    {submitWrite.warning && (
                        <p className="text-amber-400 mt-1">{submitWrite.warning}</p>
                    )}
                </div>

                <div className="mb-6 p-4 rounded-lg border border-blue-900/30 bg-blue-950/10 text-xs text-zinc-400 space-y-1">
                    <p className="text-blue-300 font-semibold uppercase tracking-wider">Current Economics</p>
                    <p>
                        Correct claim: stake returned + up to {(rewardBonusBps / 100).toFixed(2)}% bonus from reward vault (cap {formatUSDC(maxBonusPerClaim)} USDC).
                    </p>
                    <p>
                        Wrong claim: {slashPercent}% slash split as reward {(rewardSlashBps / 100).toFixed(2)}% / protocol {(protocolSlashBps / 100).toFixed(2)}% / market {(marketSlashBps / 100).toFixed(2)}%.
                    </p>
                </div>

                {!isConnected ? (
                    <div className="p-8 rounded-xl border border-zinc-800 bg-zinc-900/30 text-center">
                        <Lock className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-zinc-300 mb-2">Wallet Required</h3>
                        <p className="text-zinc-500 mb-6">Connect your wallet to submit claims</p>
                        <ConnectButton />
                    </div>
                ) : step === 'success' ? (
                    <div className="p-8 rounded-xl border border-teal-900/30 bg-teal-950/10 text-center">
                        <CheckCircle2 className="w-16 h-16 text-teal-500 mx-auto mb-4" />
                        <h3 className="text-2xl font-bold text-zinc-100 mb-2">Claim Submitted!</h3>
                        <p className="text-zinc-400 mb-6">Your prediction has been recorded on-chain.</p>
                        <div className="text-xs font-mono text-zinc-500 mb-6 break-all">
                            TX: {submitWrite.txHash ?? submitWrite.callsId ?? '--'}
                        </div>
                        <div className="flex gap-4 justify-center">
                            <Link
                                href="/marketplace"
                                className="px-6 py-3 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-500 transition-all"
                            >
                                View Marketplace
                            </Link>
                            <button
                                onClick={() => { setStep('form'); setClaimDescription(''); }}
                                className="px-6 py-3 rounded-lg border border-zinc-700 text-zinc-300 font-semibold hover:bg-zinc-900 transition-all"
                            >
                                Submit Another
                            </button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={(e) => {
                        e.preventDefault();
                        console.log('Form submitted. Needs approval:', needsApproval);
                        if (needsApproval) {
                            console.log('Triggering approval...');
                            handleApprove();
                        } else {
                            console.log('Triggering submit...');
                            handleSubmit();
                        }
                    }} className="space-y-6">
                        {/* Agent Selector */}
                        <div>
                            <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
                                Select Agent
                            </label>
                            {loadingAgents ? (
                                <div className="flex items-center gap-2 text-zinc-500">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Loading your agents...
                                </div>
                            ) : agents.length === 0 ? (
                                <div className="p-4 rounded-lg bg-yellow-950/20 border border-yellow-900/50 text-sm text-yellow-400">
                                    No agents found for your wallet. <Link href="/register-agent" className="underline">Register an agent first</Link>.
                                </div>
                            ) : (
                                <div className="relative">
                                    <select
                                        value={selectedAgentId}
                                        onChange={(e) => setSelectedAgentId(e.target.value)}
                                        disabled={step !== 'form'}
                                        className="w-full p-4 rounded-lg bg-zinc-900/50 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-teal-900/50 appearance-none cursor-pointer"
                                    >
                                        <option value="">-- Select an agent --</option>
                                        {agents.map((agent) => (
                                            <option key={agent.id} value={agent.id}>
                                                #{agent.id} - {agent.name}
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                                </div>
                            )}
                        </div>

                        {/* Claim Description */}
                        <div>
                            <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
                                Prediction Statement
                            </label>
                            <textarea
                                value={claimDescription}
                                onChange={(e) => setClaimDescription(e.target.value)}
                                placeholder="e.g., ETH will be above $3,000 by Friday 5pm UTC"
                                className="w-full p-4 rounded-lg bg-zinc-900/50 border border-zinc-800 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-900/50 resize-none"
                                rows={3}
                                disabled={step !== 'form'}
                            />
                            <div className="text-[10px] font-mono text-zinc-600 mt-1 break-all">
                                Hash: {claimHash.slice(0, 20)}...{claimHash.slice(-8)}
                            </div>
                        </div>

                        {/* Stake Amount */}
                        <div>
                            <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
                                Stake Amount (USDC)
                            </label>
                            <div className="relative">
                                <input
                                    type="number"
                                    min={minStakeFormatted}
                                    step="0.01"
                                    value={stakeAmount}
                                    onChange={(e) => setStakeAmount(e.target.value)}
                                    className="w-full p-4 rounded-lg bg-zinc-900/50 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-teal-900/50 font-mono"
                                    disabled={step !== 'form'}
                                />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
                                    Balance: ${balanceFormatted}
                                </div>
                            </div>
                            <div className="text-[10px] text-zinc-600 mt-1">
                                Minimum stake: {minStakeFormatted} USDC
                            </div>
                        </div>

                        {/* Resolution Time */}
                        <div>
                            <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
                                Resolution Time (minutes from now)
                            </label>
                            <input
                                type="number"
                                min="1"
                                value={resolutionMinutes}
                                onChange={(e) => setResolutionMinutes(e.target.value)}
                                className="w-full p-4 rounded-lg bg-zinc-900/50 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-teal-900/50 font-mono"
                                disabled={step !== 'form'}
                            />
                        </div>

                        {/* Predicted Outcome */}
                        <div>
                            <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
                                Predicted Outcome
                            </label>
                            <div className="flex gap-4">
                                <button
                                    type="button"
                                    onClick={() => setPredictedOutcome(true)}
                                    disabled={step !== 'form'}
                                    className={`flex-1 p-4 rounded-lg border text-sm font-semibold transition-all ${predictedOutcome
                                        ? 'border-teal-500 bg-teal-950/30 text-teal-400'
                                        : 'border-zinc-800 bg-zinc-900/30 text-zinc-500 hover:border-zinc-700'
                                        }`}
                                >
                                    ✓ TRUE
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPredictedOutcome(false)}
                                    disabled={step !== 'form'}
                                    className={`flex-1 p-4 rounded-lg border text-sm font-semibold transition-all ${!predictedOutcome
                                        ? 'border-red-500 bg-red-950/30 text-red-400'
                                        : 'border-zinc-800 bg-zinc-900/30 text-zinc-500 hover:border-zinc-700'
                                        }`}
                                >
                                    ✗ FALSE
                                </button>
                            </div>
                        </div>

                        {/* Error display */}
                        {(approveWrite.error || submitWrite.error) && (
                            <div className="p-4 rounded-lg border border-red-900/50 bg-red-950/20 flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                                <div className="text-sm text-red-400">
                                    {(submitWrite.error?.message?.includes('UnauthorizedAgentWallet')
                                        ? 'Agent wallet authorization mismatch. Set this wallet as the agent wallet first, then retry.'
                                        : (approveWrite.error?.message || submitWrite.error?.message))}
                                </div>
                            </div>
                        )}

                        {/* Balance warning */}
                        {!hasEnoughBalance && stakeAmount && (
                            <div className="p-4 rounded-lg border border-yellow-900/50 bg-yellow-950/20 flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                                <div className="text-sm text-yellow-400">
                                    Insufficient USDC balance. You have {balanceFormatted}.
                                </div>
                            </div>
                        )}

                        {/* Submit button */}
                        <button
                            type="submit"
                            disabled={
                                !canSubmit
                                || approveWrite.isPending
                                || approveWrite.isConfirming
                                || submitWrite.isPending
                                || submitWrite.isConfirming
                            }
                            className="w-full p-4 rounded-lg bg-teal-600 text-white font-semibold text-lg hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                        >
                            {(approveWrite.isPending || approveWrite.isConfirming) && (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Approving USDC...
                                </>
                            )}
                            {(submitWrite.isPending || submitWrite.isConfirming) && (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Submitting Claim...
                                </>
                            )}
                            {step === 'form' && !approveWrite.isPending && !submitWrite.isPending && (
                                needsApproval ? 'Approve USDC & Submit' : 'Submit Claim'
                            )}
                        </button>

                        {needsApproval && step === 'form' && (
                            <p className="text-xs text-zinc-500 text-center">
                                You&apos;ll need to approve USDC spending first (2 transactions total)
                            </p>
                        )}
                    </form>
                )}
            </main>
        </div>
    );
}
