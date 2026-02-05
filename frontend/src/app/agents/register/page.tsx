'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { CONTRACTS } from '@/lib/contracts';
import { IDENTITY_REGISTRY_ABI, OWNER_BADGE_ABI } from '@/lib/abis';
import { extractAgentIdFromReceipt } from '@/utils/contracts';
import {
    ArrowLeft, Loader2, Lock, CheckCircle2, AlertCircle, Shield,
    Plus, X, Globe, Server, Wallet, FileCheck, Tag, Power, Settings, Ban, Award
} from 'lucide-react';

// ============================================================================
// CONSTANTS
// ============================================================================

const ENDPOINT_TYPES = [
    { value: 'A2A', label: 'A2A', placeholder: 'https://a2a.example.com/agent-card.json' },
    { value: 'MCP', label: 'MCP', placeholder: 'https://mcp.example.com/' },
    { value: 'x402', label: 'x402', placeholder: 'https://pay.example.com/x402' },
    { value: 'ENS', label: 'ENS', placeholder: 'myagent.eth' },
    { value: 'DID', label: 'DID', placeholder: 'did:web:agent.example.com' },
    { value: 'WALLET', label: 'Wallet', placeholder: '0x...' },
];

const TRUST_MODELS = [
    { value: 'reputation', label: 'Reputation', description: 'Score-based trust' },
    { value: 'cryptoEconomic', label: 'Crypto-Economic', description: 'Stake/slash' },
    { value: 'teeAttestation', label: 'TEE', description: 'Hardware proofs' },
];

const SKILL_CATEGORIES = {
    'data_engineering': ['data_transformation', 'etl_processing', 'data_quality'],
    'natural_language_processing': ['summarization', 'sentiment_analysis', 'translation', 'question_answering'],
    'machine_learning': ['prediction', 'classification', 'model_training'],
    'code_generation': ['code_completion', 'code_review', 'refactoring'],
    'blockchain': ['smart_contract_analysis', 'defi_analysis', 'wallet_tracking'],
};

const DOMAIN_CATEGORIES = {
    'finance_and_business': ['investment', 'trading', 'risk_management', 'market_analysis'],
    'technology': ['data_science', 'software_development', 'cybersecurity'],
    'research': ['academic', 'market_research', 'competitive_analysis'],
};

const AGENT_CATEGORIES = ['ai-assistant', 'prediction-agent', 'trading-bot', 'research-agent', 'defi-agent', 'custom'];

// ============================================================================
// TYPES
// ============================================================================

interface Endpoint { id: string; type: string; value: string; }

interface AgentMetadata {
    name: string;
    description: string;
    image?: string;
    endpoints: Array<{ type: string; value: string }>;
    trustModels: { reputation: boolean; cryptoEconomic: boolean; teeAttestation: boolean };
    skills: string[];
    domains: string[];
    metadata: { version: string; category: string;[key: string]: string };
    active: boolean;
    evm_address?: string;
    updatedAt: number;
}

// ============================================================================
// IPFS UPLOAD
// ============================================================================

async function uploadToIPFS(metadata: AgentMetadata): Promise<string> {
    const pinataJwt = process.env.NEXT_PUBLIC_PINATA_JWT;

    if (!pinataJwt) {
        const json = JSON.stringify(metadata);
        const base64 = btoa(json);
        return `data:application/json;base64,${base64}`;
    }

    const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pinataJwt}` },
        body: JSON.stringify({ pinataContent: metadata, pinataMetadata: { name: `${metadata.name}-erc8004.json` } }),
    });

    if (!response.ok) throw new Error(`Pinata upload failed: ${await response.text()}`);
    const result = await response.json();
    return `ipfs://${result.IpfsHash}`;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function RegisterAgentPage() {
    const { address, isConnected } = useAccount();

    // ========== Owner Badge Check (Frictionless) ==========
    const { data: hasBadge, isLoading: badgeLoading, refetch: refetchBadge } = useReadContract({
        address: CONTRACTS.OWNER_BADGE as `0x${string}`,
        abi: OWNER_BADGE_ABI,
        functionName: 'hasBadge',
        args: address ? [address] : undefined,
        query: { enabled: !!address }
    });

    const { data: isBlacklisted, isLoading: blacklistLoading } = useReadContract({
        address: CONTRACTS.OWNER_BADGE as `0x${string}`,
        abi: OWNER_BADGE_ABI,
        functionName: 'isBlacklisted',
        args: address ? [address] : undefined,
        query: { enabled: !!address }
    });

    const { data: badgeId } = useReadContract({
        address: CONTRACTS.OWNER_BADGE as `0x${string}`,
        abi: OWNER_BADGE_ABI,
        functionName: 'ownerToBadge',
        args: address ? [address] : undefined,
        query: { enabled: !!address && hasBadge === true }
    });

    const { data: slashCount } = useReadContract({
        address: CONTRACTS.OWNER_BADGE as `0x${string}`,
        abi: OWNER_BADGE_ABI,
        functionName: 'slashCount',
        args: badgeId ? [badgeId] : undefined,
        query: { enabled: !!badgeId }
    });

    // ========== Form State ==========
    const [agentName, setAgentName] = useState('');
    const [agentDescription, setAgentDescription] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [endpoints, setEndpoints] = useState<Endpoint[]>([{ id: '1', type: 'A2A', value: '' }, { id: '2', type: 'MCP', value: '' }]);
    const [reputation, setReputation] = useState(true);
    const [cryptoEconomic, setCryptoEconomic] = useState(true);
    const [teeAttestation, setTeeAttestation] = useState(false);
    const [skills, setSkills] = useState<string[]>([]);
    const [skillCategory, setSkillCategory] = useState('natural_language_processing');
    const [domains, setDomains] = useState<string[]>([]);
    const [domainCategory, setDomainCategory] = useState('finance_and_business');
    const [version, setVersion] = useState('1.0.0');
    const [category, setCategory] = useState('ai-assistant');
    const [customMeta, setCustomMeta] = useState<Record<string, string>>({});
    const [customMetaKey, setCustomMetaKey] = useState('');
    const [customMetaValue, setCustomMetaValue] = useState('');
    const [isActive, setIsActive] = useState(true);
    const [evmAddress, setEvmAddress] = useState('');

    // ========== Transaction State ==========
    const [step, setStep] = useState<'form' | 'minting-badge' | 'uploading' | 'registering' | 'success'>('form');
    const [agentId, setAgentId] = useState<string | null>(null);
    const [agentURI, setAgentURI] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { if (address && !evmAddress) setEvmAddress(address); }, [address, evmAddress]);

    // Logging state changes
    useEffect(() => {
        console.log('[Register] Step changed:', step);
    }, [step]);

    // ========== Badge Mint Transaction ==========
    const { data: mintBadgeHash, writeContract: writeMintBadge, error: mintBadgeError } = useWriteContract();
    const { isSuccess: isBadgeMinted } = useWaitForTransactionReceipt({ hash: mintBadgeHash });

    // ========== Register Transaction ==========
    const { data: registerHash, writeContract: writeRegister, error: registerError } = useWriteContract();
    const { isSuccess: isRegisterConfirmed, data: registerReceipt } = useWaitForTransactionReceipt({ hash: registerHash });



    // ========== Handlers ==========
    const addEndpoint = () => setEndpoints([...endpoints, { id: Date.now().toString(), type: 'A2A', value: '' }]);
    const removeEndpoint = (id: string) => endpoints.length > 1 && setEndpoints(endpoints.filter(e => e.id !== id));
    const updateEndpoint = (id: string, field: 'type' | 'value', value: string) => setEndpoints(endpoints.map(e => e.id === id ? { ...e, [field]: value } : e));
    const addSkill = (skill: string) => { const full = `${skillCategory}/${skill}`; if (!skills.includes(full)) setSkills([...skills, full]); };
    const addDomain = (domain: string) => { const full = `${domainCategory}/${domain}`; if (!domains.includes(full)) setDomains([...domains, full]); };
    const addCustomMeta = () => { if (customMetaKey && customMetaValue) { setCustomMeta({ ...customMeta, [customMetaKey]: customMetaValue }); setCustomMetaKey(''); setCustomMetaValue(''); } };

    // ========== Registration Flow ==========
    const handleRegister = async () => {
        console.log('[Register] Handle Register Clicked. Badge:', hasBadge);
        setError(null);

        // Step 1: Check if need to mint badge first
        if (!hasBadge) {
            console.log('[Register] No badge found. Initiating mint...');
            setStep('minting-badge');
            writeMintBadge({
                address: CONTRACTS.OWNER_BADGE as `0x${string}`,
                abi: OWNER_BADGE_ABI,
                functionName: 'mint',
                args: [],
            });
            return;
        }

        // Step 2: Proceed with registration
        await proceedWithRegistration();
    };

    const proceedWithRegistration = async () => {
        console.log('[Register] Starting registration process...');
        setStep('uploading');
        try {
            const metadata: AgentMetadata = {
                name: agentName,
                description: agentDescription,
                image: imageUrl || 'https://raw.githubusercontent.com/base-org/brand-kit/main/logo/symbol/Base_Symbol_Blue.png',
                endpoints: endpoints.filter(e => e.value.trim()).map(e => ({ type: e.type, value: e.value })),
                trustModels: { reputation, cryptoEconomic, teeAttestation },
                skills,
                domains,
                metadata: { version, category, ...customMeta },
                active: isActive,
                evm_address: evmAddress,
                updatedAt: Math.floor(Date.now() / 1000),
            };

            console.log('[Register] Uploading metadata to IPFS:', metadata);
            const uri = await uploadToIPFS(metadata);
            console.log('[Register] IPFS Upload success:', uri);

            setAgentURI(uri);
            setStep('registering');

            console.log('[Register] Submitting register transaction...');
            writeRegister({
                address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
                abi: IDENTITY_REGISTRY_ABI,
                functionName: 'register',
                args: [uri],
            });
        } catch (err) {
            console.error('[Register] Registration flow failed:', err);
            setError(err instanceof Error ? err.message : 'Failed');
            setStep('form');
        }
    };

    // After badge minted, proceed with registration
    useEffect(() => {
        if (isBadgeMinted && step === 'minting-badge') {
            console.log('[Register] Badge minted successfully. Proceeding to registration...');
            refetchBadge();
            proceedWithRegistration();
        }
    }, [isBadgeMinted, step, refetchBadge]);

    // Extract agent ID and set wallet
    useEffect(() => {
        if (isRegisterConfirmed && registerReceipt && address && step === 'registering') {
            const id = extractAgentIdFromReceipt(registerReceipt);
            console.log('[Register] Registration confirmed. Receipt:', registerReceipt);
            console.log('[Register] Extracted Agent ID:', id);

            if (id) {
                setAgentId(id.toString());
                setStep('success'); // Direct success
            } else {
                console.error('[Register] Failed to extract Agent ID from receipt!');
                setError('Failed to extract Agent ID from transaction receipt.');
            }
        }
    }, [isRegisterConfirmed, registerReceipt, address, step]);



    // Error handling
    useEffect(() => {
        if (mintBadgeError && step === 'minting-badge') {
            console.error('[Register] Mint Badge Error:', mintBadgeError);
            setError(mintBadgeError.message);
            setStep('form');
        }
        if (registerError && step === 'registering') {
            console.error('[Register] Registration Error:', registerError);
            setError(registerError.message);
            setStep('form');
        }
    }, [mintBadgeError, registerError, step]);




    const canSubmit = agentName.trim() && agentDescription.trim() && endpoints.some(e => e.value.trim());
    const isLoading = badgeLoading || blacklistLoading;

    // ========== RENDER ==========
    return (
        <div className="min-h-screen bg-[#050505] text-zinc-300 font-sans">
            {/* Nav */}
            <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-[#050505]/80 backdrop-blur-xl h-16 flex items-center justify-between px-6 lg:px-12">
                <Link href="/marketplace" className="flex items-center gap-2 text-zinc-600 hover:text-zinc-400">
                    <ArrowLeft size={16} /><span className="text-xs">Marketplace</span>
                </Link>
                <span className="font-mono font-bold text-zinc-400">Register Agent</span>
                <ConnectButton.Custom>
                    {({ account, openConnectModal, openAccountModal, mounted }) => (
                        <button onClick={mounted && account ? openAccountModal : openConnectModal}
                            className="px-4 py-2 rounded-lg border border-zinc-800 bg-zinc-900/50 text-zinc-500 text-xs hover:bg-zinc-800/50">
                            {mounted && account ? account.displayName : 'Connect'}
                        </button>
                    )}
                </ConnectButton.Custom>
            </nav>

            <main className="pt-24 px-6 lg:px-12 pb-12 max-w-4xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-2xl font-medium text-zinc-200 mb-2">Register ERC-8004 Agent</h1>
                    <p className="text-zinc-600 text-sm">Full metadata configuration based on Agent0 SDK</p>
                </div>

                {!isConnected ? (
                    <div className="p-8 rounded-xl border border-zinc-800 bg-zinc-900/20 text-center">
                        <Lock className="w-10 h-10 text-zinc-700 mx-auto mb-4" />
                        <p className="text-zinc-500 mb-4">Connect wallet to register</p>
                        <ConnectButton />
                    </div>
                ) : isLoading ? (
                    <div className="p-8 rounded-xl border border-zinc-800 bg-zinc-900/20 text-center">
                        <Loader2 className="w-8 h-8 text-zinc-600 mx-auto mb-4 animate-spin" />
                        <p className="text-zinc-500">Checking owner status...</p>
                    </div>
                ) : isBlacklisted ? (
                    <div className="p-8 rounded-xl border border-zinc-800 bg-zinc-900/20 text-center">
                        <Ban className="w-12 h-12 text-red-500/50 mx-auto mb-4" />
                        <h3 className="text-xl font-medium text-zinc-300 mb-2">Account Blacklisted</h3>
                        <p className="text-zinc-500 text-sm mb-4">
                            This address has been flagged for rug pull or scam activity and cannot register new agents.
                        </p>
                        <p className="text-[10px] font-mono text-zinc-700">{address}</p>
                    </div>
                ) : step === 'success' ? (
                    <div className="p-8 rounded-xl border border-zinc-800 bg-zinc-900/20 text-center">
                        <CheckCircle2 className="w-12 h-12 text-zinc-500 mx-auto mb-4" />
                        <h3 className="text-xl font-medium text-zinc-200 mb-2">Agent Registered</h3>
                        <div className="text-left p-4 rounded-lg border border-zinc-800 bg-zinc-900/30 mb-6 space-y-2 text-xs">
                            <div className="flex justify-between"><span className="text-zinc-600">Agent ID</span><span className="text-zinc-300 font-mono">#{agentId}</span></div>
                            <div className="flex justify-between"><span className="text-zinc-600">Owner Badge</span><span className="text-zinc-400">#{badgeId?.toString()}</span></div>
                            <div className="flex justify-between"><span className="text-zinc-600">Skills</span><span className="text-zinc-400">{skills.length}</span></div>
                        </div>
                        <div className="flex gap-4 justify-center">
                            <Link href="/marketplace" className="px-6 py-3 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 text-sm hover:bg-zinc-700">Marketplace</Link>
                            <button onClick={() => window.location.reload()} className="px-6 py-3 rounded-lg border border-zinc-800 text-zinc-500 text-sm hover:bg-zinc-900">Register Another</button>
                        </div>
                    </div>

                ) : (
                    <form onSubmit={(e) => { e.preventDefault(); handleRegister(); }} className="space-y-6">

                        {/* Owner Badge Status */}
                        <div className={`p-4 rounded-xl border flex items-center gap-4 ${hasBadge ? 'border-zinc-800 bg-zinc-900/20' : 'border-zinc-700 bg-zinc-900/40'}`}>
                            <Award className={`w-8 h-8 ${hasBadge ? 'text-zinc-500' : 'text-zinc-600'}`} />
                            <div className="flex-1">
                                <div className="text-sm font-medium text-zinc-300">
                                    {hasBadge ? 'Owner Badge Active' : 'Owner Badge Required'}
                                </div>
                                <div className="text-xs text-zinc-600">
                                    {hasBadge
                                        ? `Badge #${badgeId?.toString()} • ${slashCount?.toString() || '0'} slashes`
                                        : 'Badge will be auto-minted when you register (free, soulbound)'}
                                </div>
                            </div>
                            {hasBadge && <Shield className="w-5 h-5 text-zinc-600" />}
                        </div>

                        {/* Basic Info */}
                        <section className="space-y-4 p-5 rounded-xl border border-zinc-800 bg-zinc-900/10">
                            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-2"><FileCheck size={14} /> Basic Info</h2>
                            <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-zinc-600 mb-1">Agent Name *</label>
                                    <input type="text" value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="my-prediction-agent" disabled={step !== 'form'}
                                        className="w-full p-3 rounded-lg bg-zinc-900/30 border border-zinc-800 text-zinc-300 placeholder-zinc-700 text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs text-zinc-600 mb-1">Image URL</label>
                                    <input type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." disabled={step !== 'form'}
                                        className="w-full p-3 rounded-lg bg-zinc-900/30 border border-zinc-800 text-zinc-300 placeholder-zinc-700 text-sm" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs text-zinc-600 mb-1">Description *</label>
                                <textarea value={agentDescription} onChange={(e) => setAgentDescription(e.target.value)} placeholder="An intelligent assistant..." rows={2} disabled={step !== 'form'}
                                    className="w-full p-3 rounded-lg bg-zinc-900/30 border border-zinc-800 text-zinc-300 placeholder-zinc-700 text-sm resize-none" />
                            </div>
                        </section>

                        {/* Endpoints */}
                        <section className="space-y-4 p-5 rounded-xl border border-zinc-800 bg-zinc-900/10">
                            <div className="flex items-center justify-between">
                                <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-2"><Globe size={14} /> Endpoints</h2>
                                <button type="button" onClick={addEndpoint} disabled={step !== 'form'} className="text-xs text-zinc-600 hover:text-zinc-400 flex items-center gap-1"><Plus size={12} /> Add</button>
                            </div>
                            <div className="space-y-2">
                                {endpoints.map((ep) => (
                                    <div key={ep.id} className="flex gap-2">
                                        <select value={ep.type} onChange={(e) => updateEndpoint(ep.id, 'type', e.target.value)} disabled={step !== 'form'}
                                            className="w-24 p-2.5 rounded-lg bg-zinc-900/30 border border-zinc-800 text-zinc-400 text-xs">
                                            {ENDPOINT_TYPES.map(t => <option key={t.value} value={t.value}>{t.value}</option>)}
                                        </select>
                                        <input type="text" value={ep.value} onChange={(e) => updateEndpoint(ep.id, 'value', e.target.value)}
                                            placeholder={ENDPOINT_TYPES.find(t => t.value === ep.type)?.placeholder} disabled={step !== 'form'}
                                            className="flex-1 p-2.5 rounded-lg bg-zinc-900/30 border border-zinc-800 text-zinc-300 placeholder-zinc-700 text-xs" />
                                        {endpoints.length > 1 && <button type="button" onClick={() => removeEndpoint(ep.id)} className="p-2.5 rounded-lg border border-zinc-800 text-zinc-600 hover:text-zinc-400"><X size={12} /></button>}
                                    </div>
                                ))}
                            </div>
                        </section>

                        {/* Trust Models */}
                        <section className="space-y-4 p-5 rounded-xl border border-zinc-800 bg-zinc-900/10">
                            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-2"><Shield size={14} /> Trust Models</h2>
                            <div className="grid grid-cols-3 gap-3">
                                {TRUST_MODELS.map(model => {
                                    const isChecked = model.value === 'reputation' ? reputation : model.value === 'cryptoEconomic' ? cryptoEconomic : teeAttestation;
                                    const toggle = () => { if (model.value === 'reputation') setReputation(!reputation); else if (model.value === 'cryptoEconomic') setCryptoEconomic(!cryptoEconomic); else setTeeAttestation(!teeAttestation); };
                                    return (
                                        <button key={model.value} type="button" onClick={toggle} disabled={step !== 'form'}
                                            className={`p-3 rounded-lg border text-left ${isChecked ? 'border-zinc-600 bg-zinc-900/50' : 'border-zinc-800 hover:bg-zinc-900/30'}`}>
                                            <div className="flex items-center justify-between"><span className="text-xs font-medium text-zinc-300">{model.label}</span><div className={`w-3 h-3 rounded border ${isChecked ? 'border-zinc-500 bg-zinc-500' : 'border-zinc-700'}`} /></div>
                                            <p className="text-[10px] text-zinc-600 mt-1">{model.description}</p>
                                        </button>
                                    );
                                })}
                            </div>
                        </section>

                        {/* Skills & Domains */}
                        <div className="grid md:grid-cols-2 gap-6">
                            <section className="space-y-3 p-5 rounded-xl border border-zinc-800 bg-zinc-900/10">
                                <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-2"><Server size={14} /> Skills</h2>
                                <select value={skillCategory} onChange={(e) => setSkillCategory(e.target.value)} disabled={step !== 'form'}
                                    className="w-full p-2 rounded-lg bg-zinc-900/30 border border-zinc-800 text-zinc-400 text-xs">
                                    {Object.keys(SKILL_CATEGORIES).map(cat => <option key={cat} value={cat}>{cat.replace(/_/g, ' ')}</option>)}
                                </select>
                                <div className="flex flex-wrap gap-1">
                                    {SKILL_CATEGORIES[skillCategory as keyof typeof SKILL_CATEGORIES]?.map(skill => (
                                        <button key={skill} type="button" onClick={() => addSkill(skill)} disabled={step !== 'form' || skills.includes(`${skillCategory}/${skill}`)}
                                            className="px-2 py-1 rounded border border-zinc-800 text-[10px] text-zinc-600 hover:text-zinc-400 hover:bg-zinc-900 disabled:opacity-30">+ {skill}</button>
                                    ))}
                                </div>
                                {skills.length > 0 && <div className="flex flex-wrap gap-1">{skills.map(s => <span key={s} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-900/30 border border-zinc-800 text-[10px] text-zinc-400">{s.split('/')[1]} <button type="button" onClick={() => setSkills(skills.filter(x => x !== s))}><X size={8} /></button></span>)}</div>}
                            </section>
                            <section className="space-y-3 p-5 rounded-xl border border-zinc-800 bg-zinc-900/10">
                                <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-2"><Tag size={14} /> Domains</h2>
                                <select value={domainCategory} onChange={(e) => setDomainCategory(e.target.value)} disabled={step !== 'form'}
                                    className="w-full p-2 rounded-lg bg-zinc-900/30 border border-zinc-800 text-zinc-400 text-xs">
                                    {Object.keys(DOMAIN_CATEGORIES).map(cat => <option key={cat} value={cat}>{cat.replace(/_/g, ' ')}</option>)}
                                </select>
                                <div className="flex flex-wrap gap-1">
                                    {DOMAIN_CATEGORIES[domainCategory as keyof typeof DOMAIN_CATEGORIES]?.map(domain => (
                                        <button key={domain} type="button" onClick={() => addDomain(domain)} disabled={step !== 'form' || domains.includes(`${domainCategory}/${domain}`)}
                                            className="px-2 py-1 rounded border border-zinc-800 text-[10px] text-zinc-600 hover:text-zinc-400 hover:bg-zinc-900 disabled:opacity-30">+ {domain}</button>
                                    ))}
                                </div>
                                {domains.length > 0 && <div className="flex flex-wrap gap-1">{domains.map(d => <span key={d} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-900/30 border border-zinc-800 text-[10px] text-zinc-400">{d.split('/')[1]} <button type="button" onClick={() => setDomains(domains.filter(x => x !== d))}><X size={8} /></button></span>)}</div>}
                            </section>
                        </div>

                        {/* Metadata & Status */}
                        <section className="space-y-4 p-5 rounded-xl border border-zinc-800 bg-zinc-900/10">
                            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-2"><Settings size={14} /> Metadata & Status</h2>
                            <div className="grid md:grid-cols-4 gap-4">
                                <div>
                                    <label className="block text-xs text-zinc-600 mb-1">Version</label>
                                    <input type="text" value={version} onChange={(e) => setVersion(e.target.value)} disabled={step !== 'form'}
                                        className="w-full p-2.5 rounded-lg bg-zinc-900/30 border border-zinc-800 text-zinc-300 text-xs" />
                                </div>
                                <div>
                                    <label className="block text-xs text-zinc-600 mb-1">Category</label>
                                    <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={step !== 'form'}
                                        className="w-full p-2.5 rounded-lg bg-zinc-900/30 border border-zinc-800 text-zinc-400 text-xs">
                                        {AGENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-zinc-600 mb-1">Agent Wallet</label>
                                    <input type="text" value={evmAddress} onChange={(e) => setEvmAddress(e.target.value)} disabled={step !== 'form'}
                                        className="w-full p-2.5 rounded-lg bg-zinc-900/30 border border-zinc-800 text-zinc-300 font-mono text-[10px]" />
                                </div>
                                <div>
                                    <label className="block text-xs text-zinc-600 mb-1">Status</label>
                                    <button type="button" onClick={() => setIsActive(!isActive)} disabled={step !== 'form'}
                                        className={`w-full p-2.5 rounded-lg border text-xs ${isActive ? 'border-zinc-600 bg-zinc-900/50 text-zinc-300' : 'border-zinc-800 text-zinc-600'}`}>
                                        <Power size={12} className="inline mr-1" />{isActive ? 'Active' : 'Inactive'}
                                    </button>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <input type="text" value={customMetaKey} onChange={(e) => setCustomMetaKey(e.target.value)} placeholder="custom key" disabled={step !== 'form'}
                                    className="w-28 p-2 rounded-lg bg-zinc-900/30 border border-zinc-800 text-zinc-300 placeholder-zinc-700 text-xs" />
                                <input type="text" value={customMetaValue} onChange={(e) => setCustomMetaValue(e.target.value)} placeholder="value" disabled={step !== 'form'}
                                    className="flex-1 p-2 rounded-lg bg-zinc-900/30 border border-zinc-800 text-zinc-300 placeholder-zinc-700 text-xs" />
                                <button type="button" onClick={addCustomMeta} disabled={step !== 'form'} className="px-3 rounded-lg border border-zinc-800 text-zinc-600 hover:text-zinc-400"><Plus size={12} /></button>
                            </div>
                            {Object.keys(customMeta).length > 0 && <div className="flex flex-wrap gap-1">{Object.entries(customMeta).map(([k, v]) => <span key={k} className="px-2 py-1 rounded bg-zinc-900/30 border border-zinc-800 text-[10px] text-zinc-400">{k}:{v} <button onClick={() => { const m = { ...customMeta }; delete m[k]; setCustomMeta(m); }}><X size={8} /></button></span>)}</div>}
                        </section>

                        {/* Error/Progress */}
                        {error && <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/30 flex items-start gap-3"><AlertCircle className="w-5 h-5 text-zinc-500 shrink-0" /><span className="text-sm text-zinc-400">{error}</span></div>}
                        {step !== 'form' && (
                            <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/30 flex items-center gap-3">
                                <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
                                <span className="text-sm text-zinc-400">
                                    {step === 'minting-badge' && 'Minting Owner Badge (first time only)...'}
                                    {step === 'uploading' && 'Uploading to IPFS...'}
                                    {step === 'registering' && 'Registering on-chain...'}
                                </span>
                            </div>
                        )}

                        {/* Submit */}
                        <button type="submit" disabled={!canSubmit || step !== 'form'}
                            className="w-full p-4 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 font-medium hover:bg-zinc-700 disabled:opacity-50 transition-all">
                            {!hasBadge ? 'Mint Badge & Register Agent' : 'Register Agent on Base Sepolia'}
                        </button>
                    </form>
                )}
            </main>
        </div>
    );
}
