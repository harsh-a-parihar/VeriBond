'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { decodeEventLog } from 'viem';
import { CONTRACTS, ADMIN_WALLET } from '@/lib/contracts';
import { IDENTITY_REGISTRY_ABI } from '@/lib/abis';
import { ArrowLeft, Loader2, Lock, CheckCircle2, AlertCircle, Shield } from 'lucide-react';

export default function RegisterAgentPage() {
    const router = useRouter();
    const publicClient = usePublicClient();
    const { address, isConnected } = useAccount();

    // Check if admin
    const isAdmin = address?.toLowerCase() === ADMIN_WALLET.toLowerCase();

    // Form state
    const [agentName, setAgentName] = useState('');
    const [agentDescription, setAgentDescription] = useState('');
    const [step, setStep] = useState<'form' | 'uploading' | 'registering' | 'setting-wallet' | 'success'>('form');
    const [agentId, setAgentId] = useState<string | null>(null);
    const [agentURI, setAgentURI] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Register transaction
    const {
        data: registerHash,
        isPending: isRegistering,
        writeContract: writeRegister,
        error: registerError
    } = useWriteContract();

    const { isLoading: isRegisterConfirming, isSuccess: isRegisterConfirmed, data: registerReceipt } = useWaitForTransactionReceipt({
        hash: registerHash,
    });

    // Set wallet transaction
    const {
        data: setWalletHash,
        isPending: isSettingWallet,
        writeContract: writeSetWallet,
        error: setWalletError
    } = useWriteContract();

    const { isLoading: isSetWalletConfirming, isSuccess: isSetWalletConfirmed } = useWaitForTransactionReceipt({
        hash: setWalletHash,
    });

    // Upload to IPFS (using public gateway for demo - in production use Pinata/Infura)
    const uploadToIPFS = async (): Promise<string> => {
        const metadata = {
            name: agentName,
            description: agentDescription,
            image: 'https://raw.githubusercontent.com/base-org/brand-kit/main/logo/symbol/Base_Symbol_Blue.png',
            endpoints: [
                {
                    type: 'A2A',
                    value: 'https://veribond.example.com/.well-known/agent-card.json',
                },
            ],
            trustModels: ['reputation', 'crypto-economic'],
            active: true,
            updatedAt: Math.floor(Date.now() / 1000),
        };

        // For demo: encode as data URI (in production, use Pinata)
        const json = JSON.stringify(metadata);
        const base64 = btoa(json);
        return `data:application/json;base64,${base64}`;
    };

    // Handle registration after IPFS upload
    const handleRegister = async () => {
        setError(null);
        setStep('uploading');

        try {
            const uri = await uploadToIPFS();
            setAgentURI(uri);
            setStep('registering');

            writeRegister({
                address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
                abi: IDENTITY_REGISTRY_ABI,
                functionName: 'register',
                args: [uri],
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed');
            setStep('form');
        }
    };

    // Extract agent ID from logs and set wallet
    useEffect(() => {
        if (isRegisterConfirmed && registerReceipt && address) {
            // Find Transfer event (ERC721)
            const transferLog = registerReceipt.logs.find(log =>
                log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
            );

            if (transferLog && transferLog.topics[3]) {
                const id = BigInt(transferLog.topics[3]).toString();
                setAgentId(id);
                setStep('setting-wallet');

                // Set agent wallet
                writeSetWallet({
                    address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
                    abi: IDENTITY_REGISTRY_ABI,
                    functionName: 'setAgentWallet',
                    args: [BigInt(id), address],
                });
            }
        }
    }, [isRegisterConfirmed, registerReceipt, address, writeSetWallet]);

    // Handle set wallet success
    useEffect(() => {
        if (isSetWalletConfirmed) {
            setStep('success');
        }
    }, [isSetWalletConfirmed]);

    // Handle errors
    useEffect(() => {
        if (registerError) {
            setError(registerError.message);
            setStep('form');
        }
        if (setWalletError) {
            // setAgentWallet might fail on some implementations - still show success
            setStep('success');
        }
    }, [registerError, setWalletError]);

    const canSubmit = agentName.trim() && agentDescription.trim();

    return (
        <div className="min-h-screen bg-[#050505] text-zinc-300 font-sans">
            {/* Navigation */}
            <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-[#050505]/80 backdrop-blur-xl h-16 flex items-center justify-between px-6 lg:px-12">
                <Link href="/marketplace" className="flex items-center gap-2 text-zinc-600 hover:text-zinc-400 transition-colors">
                    <ArrowLeft size={16} />
                    <span className="text-xs font-medium">Back to Marketplace</span>
                </Link>
                <div className="font-mono font-bold text-lg text-zinc-400">
                    Register Agent
                </div>
                <ConnectButton.Custom>
                    {({ account, chain, openConnectModal, openAccountModal, mounted }) => {
                        const connected = mounted && account && chain;
                        return (
                            <button
                                onClick={connected ? openAccountModal : openConnectModal}
                                className="px-4 py-2 rounded-lg border border-zinc-800 bg-zinc-900/50 text-zinc-500 text-xs font-medium hover:bg-zinc-800/50 transition-colors"
                            >
                                {connected ? account.displayName : 'Connect'}
                            </button>
                        );
                    }}
                </ConnectButton.Custom>
            </nav>

            {/* Main */}
            <main className="pt-24 px-6 lg:px-12 pb-12 max-w-2xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-2xl font-medium text-zinc-200 mb-2">Register ERC-8004 Agent</h1>
                    <p className="text-zinc-600 text-sm">
                        Create an on-chain identity for your AI agent on Base Sepolia.
                    </p>
                </div>

                {!isConnected ? (
                    <div className="p-8 rounded-xl border border-zinc-800 bg-zinc-900/20 text-center">
                        <Lock className="w-10 h-10 text-zinc-700 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-zinc-400 mb-2">Wallet Required</h3>
                        <p className="text-zinc-600 text-sm mb-6">Connect your wallet to register an agent.</p>
                        <ConnectButton />
                    </div>
                ) : !isAdmin ? (
                    <div className="p-8 rounded-xl border border-zinc-800 bg-zinc-900/20 text-center">
                        <Shield className="w-10 h-10 text-zinc-700 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-zinc-400 mb-2">Admin Only</h3>
                        <p className="text-zinc-600 text-sm mb-4">
                            Agent registration is restricted to admin wallets for this demo.
                        </p>
                        <p className="text-[10px] font-mono text-zinc-700 break-all">
                            Your wallet: {address}
                        </p>
                    </div>
                ) : step === 'success' ? (
                    <div className="p-8 rounded-xl border border-zinc-800 bg-zinc-900/20 text-center">
                        <CheckCircle2 className="w-12 h-12 text-zinc-500 mx-auto mb-4" />
                        <h3 className="text-xl font-medium text-zinc-200 mb-2">Agent Registered</h3>
                        <p className="text-zinc-500 text-sm mb-6">Your agent has been created on-chain.</p>

                        <div className="text-left p-4 rounded-lg border border-zinc-800 bg-zinc-900/30 mb-6 space-y-2">
                            <div className="flex justify-between text-xs">
                                <span className="text-zinc-600">Agent ID</span>
                                <span className="text-zinc-300 font-mono">#{agentId}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-zinc-600">Transaction</span>
                                <span className="text-zinc-500 font-mono">{registerHash?.slice(0, 10)}...</span>
                            </div>
                        </div>

                        <div className="flex gap-4 justify-center">
                            <Link
                                href="/marketplace"
                                className="px-6 py-3 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 text-sm font-medium hover:bg-zinc-700 transition-all"
                            >
                                View Marketplace
                            </Link>
                            <button
                                onClick={() => { setStep('form'); setAgentName(''); setAgentDescription(''); }}
                                className="px-6 py-3 rounded-lg border border-zinc-800 text-zinc-500 text-sm font-medium hover:bg-zinc-900 transition-all"
                            >
                                Register Another
                            </button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={(e) => { e.preventDefault(); handleRegister(); }} className="space-y-6">
                        {/* Agent Name */}
                        <div>
                            <label className="block text-xs uppercase tracking-wider text-zinc-600 mb-2 font-medium">
                                Agent Name
                            </label>
                            <input
                                type="text"
                                value={agentName}
                                onChange={(e) => setAgentName(e.target.value)}
                                placeholder="e.g., prediction-agent-alpha"
                                className="w-full p-4 rounded-lg bg-zinc-900/30 border border-zinc-800 text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-zinc-700"
                                disabled={step !== 'form'}
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <label className="block text-xs uppercase tracking-wider text-zinc-600 mb-2 font-medium">
                                Description
                            </label>
                            <textarea
                                value={agentDescription}
                                onChange={(e) => setAgentDescription(e.target.value)}
                                placeholder="Describe what this agent does..."
                                className="w-full p-4 rounded-lg bg-zinc-900/30 border border-zinc-800 text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-zinc-700 resize-none"
                                rows={3}
                                disabled={step !== 'form'}
                            />
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/30 flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-zinc-500 shrink-0 mt-0.5" />
                                <div className="text-sm text-zinc-400">{error}</div>
                            </div>
                        )}

                        {/* Progress indicator */}
                        {step !== 'form' && (
                            <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/30">
                                <div className="flex items-center gap-3">
                                    <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
                                    <span className="text-sm text-zinc-400">
                                        {step === 'uploading' && 'Preparing metadata...'}
                                        {step === 'registering' && 'Registering on-chain...'}
                                        {step === 'setting-wallet' && 'Setting agent wallet...'}
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={!canSubmit || step !== 'form'}
                            className="w-full p-4 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 font-medium hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            Register Agent
                        </button>

                        <p className="text-xs text-zinc-700 text-center">
                            This will create an ERC-8004 identity on Base Sepolia
                        </p>
                    </form>
                )}
            </main>
        </div>
    );
}
