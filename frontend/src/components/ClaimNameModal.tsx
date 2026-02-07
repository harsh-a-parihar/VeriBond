'use client';

import { useState } from 'react';
import { X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

type ClaimNameModalProps = {
    isOpen: boolean;
    onClose: () => void;
    agentId: string;
    agentWallet: string;
    trustScore: number;
    onSuccess: (name: string) => void;
};

export default function ClaimNameModal({
    isOpen,
    onClose,
    agentId,
    agentWallet,
    trustScore,
    onSuccess,
}: ClaimNameModalProps) {
    const [label, setLabel] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const [txHash, setTxHash] = useState('');

    const fullName = label ? `${label.toLowerCase()}.veribond.basetest.eth` : '';

    const isValidLabel = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]{3,}$/.test(label.toLowerCase()) && label.length >= 3 && label.length <= 32;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValidLabel) return;

        setStatus('loading');
        setMessage('Claiming your VeriBond name on-chain...');

        try {
            const response = await fetch('/api/claim-name', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentId,
                    label: label.toLowerCase(),
                    agentWallet,
                    trustScore,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                setStatus('error');
                setMessage(data.error || 'Failed to claim name');
                return;
            }

            setStatus('success');
            setMessage(data.message);
            setTxHash(data.transactionHash);
            onSuccess(label.toLowerCase());

        } catch (err) {
            setStatus('error');
            setMessage(err instanceof Error ? err.message : 'Network error');
        }
    };

    const handleClose = () => {
        if (status !== 'loading') {
            setLabel('');
            setStatus('idle');
            setMessage('');
            setTxHash('');
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/5">
                    <h2 className="text-xl font-bold text-white">Claim VeriBond Name</h2>
                    <button
                        onClick={handleClose}
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                        disabled={status === 'loading'}
                    >
                        <X size={20} className="text-zinc-400" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {status === 'success' ? (
                        <div className="text-center space-y-4">
                            <div className="w-16 h-16 mx-auto bg-green-900/30 rounded-full flex items-center justify-center">
                                <CheckCircle size={32} className="text-green-400" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white mb-2">Name Claimed!</h3>
                                <p className="text-zinc-400 text-sm">{message}</p>
                            </div>
                            <div className="p-4 bg-purple-900/20 border border-purple-900/40 rounded-lg">
                                <p className="text-purple-300 font-mono text-lg font-bold">{fullName}</p>
                            </div>
                            {txHash && (
                                <a
                                    href={`https://sepolia.basescan.org/tx/${txHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-400 hover:text-blue-300 text-sm underline"
                                >
                                    View Transaction ↗
                                </a>
                            )}
                            <button
                                onClick={handleClose}
                                className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg transition-colors"
                            >
                                Done
                            </button>
                        </div>
                    ) : status === 'error' ? (
                        <div className="text-center space-y-4">
                            <div className="w-16 h-16 mx-auto bg-red-900/30 rounded-full flex items-center justify-center">
                                <AlertCircle size={32} className="text-red-400" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white mb-2">Claim Failed</h3>
                                <p className="text-zinc-400 text-sm">{message}</p>
                            </div>
                            <button
                                onClick={() => { setStatus('idle'); setMessage(''); }}
                                className="w-full py-3 bg-zinc-700 hover:bg-zinc-600 text-white font-medium rounded-lg transition-colors"
                            >
                                Try Again
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-6">
                            {/* Info */}
                            <div className="p-4 bg-zinc-800/50 border border-white/5 rounded-lg space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-zinc-500">Agent ID</span>
                                    <span className="text-zinc-300 font-mono">#{agentId}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-zinc-500">Trust Score</span>
                                    <span className="text-green-400 font-bold">{trustScore}/100</span>
                                </div>
                            </div>

                            {/* Name Input */}
                            <div className="space-y-2">
                                <label className="block text-sm text-zinc-400">Choose your name</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={label}
                                        onChange={(e) => setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                                        placeholder="myagent"
                                        maxLength={32}
                                        className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-lg text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500 font-mono"
                                        disabled={status === 'loading'}
                                    />
                                </div>
                            </div>

                            {/* Preview */}
                            {label && (
                                <div className="p-4 bg-purple-900/20 border border-purple-900/40 rounded-lg">
                                    <p className="text-zinc-500 text-xs mb-1">Your VeriBond Name</p>
                                    <p className={`font-mono text-lg font-bold ${isValidLabel ? 'text-purple-300' : 'text-red-400'}`}>
                                        {fullName}
                                    </p>
                                    {!isValidLabel && label.length > 0 && (
                                        <p className="text-red-400 text-xs mt-1">
                                            Must be 3-32 chars, lowercase letters, numbers, and hyphens only
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Submit */}
                            <button
                                type="submit"
                                disabled={!isValidLabel || status === 'loading'}
                                className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                                {status === 'loading' ? (
                                    <>
                                        <Loader2 size={18} className="animate-spin" />
                                        <span>Claiming...</span>
                                    </>
                                ) : (
                                    <span>Claim Name</span>
                                )}
                            </button>

                            <p className="text-xs text-zinc-500 text-center">
                                This name will be stored on-chain and linked to your agent's identity.
                            </p>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
