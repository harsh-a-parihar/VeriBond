'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { AGENT_TOKEN_FACTORY } from '@/lib/contracts';
import { AGENT_TOKEN_FACTORY_ABI } from '@/lib/abis';
import { useAgentIdentity } from '@/hooks/useAgentIdentity';
import { parseEther } from 'viem';
import { Loader2, AlertCircle, Rocket, ArrowLeft } from 'lucide-react';

export default function LaunchTokenPage() {
    const params = useParams();
    const router = useRouter();
    const { address } = useAccount();
    const agentId = params.id ? BigInt(params.id as string) : undefined;

    // Fetch agent identity
    const { owner: agentOwner, isLoading: isIdentityLoading } = useAgentIdentity(agentId);

    // Form State
    const [name, setName] = useState('');
    const [symbol, setSymbol] = useState('');
    const [tokensForSale, setTokensForSale] = useState('1000000');
    const [durationHours, setDurationHours] = useState('24');
    const [minPrice, setMinPrice] = useState('0.1');

    // Contract Write
    const { writeContract, data: hash, error: writeError, isPending: isWritePending } = useWriteContract();

    const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
        hash,
    });

    // --- DEBUG LOGGING ---
    useEffect(() => {
        console.log('[LaunchToken] Hash:', hash);
    }, [hash]);

    useEffect(() => {
        console.log('[LaunchToken] isConfirmed:', isConfirmed);
    }, [isConfirmed]);

    useEffect(() => {
        if (writeError) {
            console.error('[LaunchToken] Write Error:', writeError);
        }
    }, [writeError]);
    // --- END DEBUG LOGGING ---

    const handleLaunch = () => {
        if (!agentId || !name || !symbol) return;
        const durationBlocks = BigInt(Number(durationHours) * 1800); // ~2s blocks on Base
        const tokensAmount = parseEther(tokensForSale);

        // --- CCA Constants (from reference implementation) ---
        // Floor price in Q96 format (tick -299340, equivalent to ~$0.0001 per token)
        const FLOOR_PRICE = BigInt('7931558425297600');
        // Tick spacing (~1% of floor price in Q96)
        const CCA_TICK_SPACING = BigInt('79315584252976');
        // Total MPS (milli-bips) = 10,000,000 = 100% of tokens
        const TOTAL_MPS = BigInt(10_000_000);

        // --- Generate valid auctionStepsData ---
        // CCA expects: abi.encodePacked(bytes3(mps), bytes5(blocksDelta))
        // where mps = milli-bips per block, total mps * blocks = TOTAL_MPS
        const mpsPerBlock = TOTAL_MPS / durationBlocks;
        const remainder = TOTAL_MPS % durationBlocks;

        let auctionStepsData: `0x${string}`;
        if (remainder === BigInt(0)) {
            // Perfect division: single step
            // bytes3(mpsPerBlock) + bytes5(durationBlocks)
            const mpsHex = mpsPerBlock.toString(16).padStart(6, '0'); // 3 bytes = 6 hex chars
            const blocksHex = durationBlocks.toString(16).padStart(10, '0'); // 5 bytes = 10 hex chars
            auctionStepsData = `0x${mpsHex}${blocksHex}` as `0x${string}`;
        } else {
            // Two steps to distribute remainder
            const mpsPlus1 = mpsPerBlock + BigInt(1);
            const firstBlocks = remainder;
            const secondBlocks = durationBlocks - remainder;

            const mps1Hex = mpsPlus1.toString(16).padStart(6, '0');
            const blocks1Hex = firstBlocks.toString(16).padStart(10, '0');
            const mps2Hex = mpsPerBlock.toString(16).padStart(6, '0');
            const blocks2Hex = secondBlocks.toString(16).padStart(10, '0');

            auctionStepsData = `0x${mps1Hex}${blocks1Hex}${mps2Hex}${blocks2Hex}` as `0x${string}`;
        }

        console.log('[LaunchToken] Launching auction with:', {
            agentId: agentId.toString(),
            name,
            symbol,
            tokensForSale,
            minPrice,
            durationBlocks: durationBlocks.toString(),
            mpsPerBlock: mpsPerBlock.toString(),
            remainder: remainder.toString(),
            factoryAddress: AGENT_TOKEN_FACTORY,
            auctionStepsData
        });

        writeContract({
            address: AGENT_TOKEN_FACTORY,
            abi: AGENT_TOKEN_FACTORY_ABI,
            functionName: 'launchAuction',
            args: [
                agentId,
                name,
                symbol,
                tokensAmount,
                BigInt(0), // startPrice (unused, for display only)
                FLOOR_PRICE, // minPrice in Q96 format
                durationBlocks,
                CCA_TICK_SPACING, // tickSpacing in Q96 format
                auctionStepsData
            ],
        });
    };

    const isOwner = agentOwner === address;

    if (isIdentityLoading) {
        return <div className="flex h-screen items-center justify-center bg-[#050505] text-zinc-500 font-mono"><Loader2 className="animate-spin mr-2" /> Verifying Agent...</div>;
    }

    if (!isOwner) {
        return (
            <div className="min-h-screen bg-[#050505] p-12 text-zinc-200 font-mono flex flex-col items-center">
                <AlertCircle className="mb-4 text-red-500" />
                <h1 className="text-xl font-bold text-red-500">Access Denied</h1>
                <p className="text-zinc-500 mt-2">Only the owner of Agent #{agentId?.toString()} can launch a token.</p>
                <button onClick={() => router.push('/marketplace')} className="mt-8 text-xs underline text-zinc-400 hover:text-white">Return Home</button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#050505] text-zinc-200 font-sans selection:bg-teal-900/30 p-6 md:p-12">
            <div className="max-w-2xl mx-auto space-y-8">

                {/* Header */}
                <div>
                    <button onClick={() => router.back()} className="text-xs font-mono text-zinc-500 hover:text-white mb-6 flex items-center gap-2">
                        <ArrowLeft size={12} /> Back
                    </button>
                    <h1 className="text-2xl font-bold tracking-tight">Launch Agent Token</h1>
                    <p className="text-sm text-zinc-500 mt-2 font-mono">
                        Initiate a Continuous Clearing Auction (CCA) on Uniswap v4.
                    </p>
                </div>

                {/* Main Form */}
                <div className="border border-white/5 bg-[#0a0a0a] rounded-lg overflow-hidden">
                    <div className="p-4 border-b border-white/5 bg-zinc-900/20">
                        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Token Configuration</h2>
                    </div>
                    <div className="p-6 space-y-6">
                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs text-zinc-400 font-medium">Token Name</label>
                                <input
                                    className="w-full bg-[#050505] border border-zinc-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-600 transition-colors placeholder-zinc-700"
                                    placeholder="e.g. VeriBond Agent"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs text-zinc-400 font-medium">Symbol</label>
                                <input
                                    className="w-full bg-[#050505] border border-zinc-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-600 transition-colors placeholder-zinc-700 font-mono"
                                    placeholder="VBA"
                                    value={symbol}
                                    onChange={e => setSymbol(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="border border-white/5 bg-[#0a0a0a] rounded-lg overflow-hidden">
                    <div className="p-4 border-b border-white/5 bg-zinc-900/20">
                        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Auction Parameters</h2>
                    </div>
                    <div className="p-6 space-y-6">
                        <div className="space-y-2">
                            <label className="text-xs text-zinc-400 font-medium">Tokens for Sale</label>
                            <input
                                type="number"
                                className="w-full bg-[#050505] border border-zinc-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-600 transition-colors font-mono"
                                value={tokensForSale}
                                onChange={e => setTokensForSale(e.target.value)}
                            />
                            <p className="text-[10px] text-zinc-600">Total initial supply minted to auction contract.</p>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs text-zinc-400 font-medium">Duration (Hours)</label>
                                <input
                                    type="number"
                                    className="w-full bg-[#050505] border border-zinc-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-600 transition-colors font-mono"
                                    value={durationHours}
                                    onChange={e => setDurationHours(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs text-zinc-400 font-medium">Floor Price (USDC)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="w-full bg-[#050505] border border-zinc-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-600 transition-colors font-mono"
                                    value={minPrice}
                                    onChange={e => setMinPrice(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {writeError && (
                    <div className="p-4 border border-red-900/50 bg-red-950/10 rounded flex items-start gap-3">
                        <AlertCircle className="text-red-500 h-5 w-5 shrink-0" />
                        <div>
                            <h3 className="text-sm font-bold text-red-500">Error Launching Auction</h3>
                            <p className="text-xs text-red-400 mt-1 font-mono">{writeError.message}</p>
                        </div>
                    </div>
                )}

                {isConfirmed && (
                    <div className="p-4 border border-teal-900/50 bg-teal-950/10 rounded flex items-start gap-3">
                        <Rocket className="text-teal-500 h-5 w-5 shrink-0" />
                        <div>
                            <h3 className="text-sm font-bold text-teal-500">Launch Successful</h3>
                            <p className="text-xs text-teal-400 mt-1">Transaction confirmed. Redirecting to auction...</p>
                            <button onClick={() => router.push(`/agents/${agentId}/auction`)} className="mt-2 text-xs underline text-teal-300">Go to Auction Page</button>
                        </div>
                    </div>
                )}

                <button
                    onClick={handleLaunch}
                    disabled={!name || !symbol || isWritePending || isConfirming || isConfirmed}
                    className="w-full py-3 bg-zinc-100 hover:bg-white text-black font-bold uppercase tracking-wider text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {isWritePending || isConfirming ? <Loader2 className="animate-spin h-4 w-4" /> : null}
                    {isWritePending ? 'Confirm in Wallet...' : isConfirming ? 'Deploying...' : 'Launch Auction'}
                </button>
            </div>
        </div>
    );
}
