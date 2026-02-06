'use client';

import { useMemo, useState } from 'react';
import type { Address } from 'viem';
import { MessageSquare, Send, Wallet, Zap, RefreshCw } from 'lucide-react';

type Endpoint = {
    type?: string;
    value?: string;
};

type ChatSession = {
    id: string;
    agentId: string;
    payer: string;
    endpointType: string;
    endpointUrl: string;
    messageFeeMicroUsdc: string;
    settleThresholdMicroUsdc: string;
    prepaidBalanceMicroUsdc: string;
    unsettledMicroUsdc: string;
    totalSettledMicroUsdc: string;
    messageCount: number;
    status: string;
    createdAt: string;
    updatedAt: string;
    lastSettledAt: string | null;
};

type ChatMessage = {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    feeMicroUsdc: string;
    createdAt: string;
};

function microToUsdc(value: string | number | bigint): string {
    const micro = typeof value === 'bigint' ? Number(value) : Number(value || 0);
    if (!Number.isFinite(micro)) return '0.000000';
    return (micro / 1e6).toFixed(6);
}

function safeTrim(value: string | undefined): string {
    return (value ?? '').trim();
}

function prioritizeEndpoints(endpoints: Endpoint[]): Endpoint[] {
    const weighted = [...endpoints]
        .filter((e) => safeTrim(e.value).length > 0)
        .sort((a, b) => {
            const ta = safeTrim(a.type).toUpperCase();
            const tb = safeTrim(b.type).toUpperCase();
            const wa = ta === 'A2A' ? 0 : ta === 'REST' ? 1 : 2;
            const wb = tb === 'A2A' ? 0 : tb === 'REST' ? 1 : 2;
            return wa - wb;
        });
    return weighted;
}

export default function AgentChatRailPanel({
    agentId,
    walletAddress,
    endpoints,
}: {
    agentId: string;
    walletAddress?: Address;
    endpoints?: Endpoint[];
}) {
    const availableEndpoints = useMemo(() => prioritizeEndpoints(endpoints ?? []), [endpoints]);
    const [selectedEndpoint, setSelectedEndpoint] = useState<string>(availableEndpoints[0]?.value ?? '');
    const [selectedEndpointType, setSelectedEndpointType] = useState<string>((availableEndpoints[0]?.type ?? 'REST').toUpperCase());
    const [prepayUsdc, setPrepayUsdc] = useState('1.0');
    const [session, setSession] = useState<ChatSession | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [statusMessage, setStatusMessage] = useState<string>('Open a rail session to start chat.');
    const [sessionLoading, setSessionLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [settling, setSettling] = useState(false);

    const hasWallet = !!walletAddress;

    const canOpenSession = hasWallet && safeTrim(selectedEndpoint).length > 0 && !sessionLoading;
    const canSend = !!session && hasWallet && safeTrim(input).length > 0 && !sending;

    const handleSelectEndpoint = (value: string) => {
        const match = availableEndpoints.find((e) => e.value === value);
        setSelectedEndpoint(value);
        setSelectedEndpointType((match?.type ?? 'REST').toUpperCase());
    };

    const openSession = async () => {
        if (!walletAddress || !selectedEndpoint.trim()) return;
        setSessionLoading(true);
        setStatusMessage('Opening Yellow rail session...');

        try {
            const res = await fetch('/api/chat/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentId,
                    payer: walletAddress,
                    endpointType: selectedEndpointType,
                    endpointUrl: selectedEndpoint,
                    prepayUsdc,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to open session');
            }

            setSession(data.session as ChatSession);
            setMessages((data.messages ?? []) as ChatMessage[]);
            setStatusMessage('Session opened. Micropayment rail is active.');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to open session';
            setStatusMessage(message);
        } finally {
            setSessionLoading(false);
        }
    };

    const settleSession = async () => {
        if (!session || !walletAddress) return;
        setSettling(true);
        setStatusMessage('Settling unsettled usage to network...');

        try {
            const res = await fetch('/api/chat/settle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: session.id,
                    payer: walletAddress,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Settle failed');
            }

            setSession(data.session as ChatSession);
            setStatusMessage(`Settlement complete: ${microToUsdc(data.settledMicroUsdc ?? '0')} USDC`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Settle failed';
            setStatusMessage(message);
        } finally {
            setSettling(false);
        }
    };

    const sendMessage = async () => {
        if (!session || !walletAddress || !input.trim()) return;

        const userContent = input.trim();
        setInput('');
        setSending(true);
        setStatusMessage('Sending message and debiting rail balance...');

        try {
            const res = await fetch('/api/chat/message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: session.id,
                    payer: walletAddress,
                    message: userContent,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Message failed');
            }

            setSession(data.session as ChatSession);
            setMessages((data.messages ?? []) as ChatMessage[]);

            if (data.shouldSettle) {
                setStatusMessage('Threshold reached. Auto-settling usage...');
                await settleSession();
            } else {
                setStatusMessage('Message delivered. Usage debited off-chain.');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Message failed';
            setStatusMessage(message);
        } finally {
            setSending(false);
        }
    };

    return (
        <section className="rounded-xl border border-yellow-900/30 bg-gradient-to-b from-yellow-950/15 to-black p-5 md:p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center">
                        <Zap className="h-4 w-4 text-yellow-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white tracking-tight">Agent Chat Rail</h3>
                        <p className="text-xs text-zinc-500">Yellow-style micropayment session for per-message billing</p>
                    </div>
                </div>
                {session && (
                    <span className="px-2.5 py-1 text-[10px] border rounded-full font-semibold uppercase tracking-wider text-yellow-300 border-yellow-800 bg-yellow-950/30">
                        Session Open
                    </span>
                )}
            </div>

            {!hasWallet && (
                <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-400 flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-zinc-500" /> Connect wallet to open chat rail.
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2 space-y-1.5">
                    <label className="text-[10px] uppercase tracking-wider text-zinc-500">Agent Endpoint</label>
                    <select
                        value={selectedEndpoint}
                        onChange={(event) => handleSelectEndpoint(event.target.value)}
                        className="w-full h-9 rounded-md border border-white/10 bg-black/40 px-3 text-sm text-zinc-100 outline-none focus:border-yellow-500"
                    >
                        {availableEndpoints.length === 0 && <option value="">No endpoint in metadata</option>}
                        {availableEndpoints.map((endpoint, idx) => (
                            <option key={`${endpoint.type}-${endpoint.value}-${idx}`} value={safeTrim(endpoint.value)}>
                                {(endpoint.type ?? 'REST').toUpperCase()} - {safeTrim(endpoint.value)}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-wider text-zinc-500">Prepay (USDC)</label>
                    <input
                        value={prepayUsdc}
                        onChange={(event) => setPrepayUsdc(event.target.value)}
                        placeholder="1.0"
                        className="w-full h-9 rounded-md border border-white/10 bg-black/40 px-3 text-sm text-zinc-100 outline-none focus:border-yellow-500"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <LedgerMetric label="Prepaid" value={`${microToUsdc(session?.prepaidBalanceMicroUsdc ?? '0')} USDC`} />
                <LedgerMetric label="Unsettled" value={`${microToUsdc(session?.unsettledMicroUsdc ?? '0')} USDC`} />
                <LedgerMetric label="Settled" value={`${microToUsdc(session?.totalSettledMicroUsdc ?? '0')} USDC`} />
            </div>

            <div className="flex flex-wrap gap-2">
                <button
                    onClick={openSession}
                    disabled={!canOpenSession || !!session}
                    className="h-10 px-4 rounded-md border border-yellow-700 bg-yellow-600/20 text-yellow-300 hover:bg-yellow-600/30 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-colors"
                >
                    {sessionLoading ? 'Opening...' : (session ? 'Session Active' : 'Open Session')}
                </button>

                <button
                    onClick={settleSession}
                    disabled={!session || settling || Number(session.unsettledMicroUsdc) <= 0}
                    className="h-10 px-4 rounded-md border border-white/10 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-colors flex items-center gap-2"
                >
                    {settling ? 'Settling...' : (<><RefreshCw className="h-3.5 w-3.5" /> Settle Usage</>)}
                </button>
            </div>

            <div className="rounded border border-white/10 bg-black/30 p-3 space-y-3">
                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                    {messages.length === 0 && (
                        <div className="text-xs text-zinc-500">No messages yet. Open session and start chatting.</div>
                    )}
                    {messages.map((message) => (
                        <div
                            key={message.id}
                            className={`rounded p-2 text-xs ${message.role === 'user'
                                ? 'bg-zinc-900 border border-zinc-800 text-zinc-200 ml-8'
                                : 'bg-yellow-950/20 border border-yellow-900/30 text-yellow-100 mr-8'
                                }`}
                        >
                            <div className="text-[10px] uppercase tracking-wider opacity-70 mb-1">{message.role}</div>
                            <div className="whitespace-pre-wrap break-words">{message.content}</div>
                        </div>
                    ))}
                </div>

                <div className="flex gap-2">
                    <input
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                void sendMessage();
                            }
                        }}
                        placeholder="Ask this agent..."
                        className="flex-1 h-10 rounded-md border border-white/10 bg-black/40 px-3 text-sm text-zinc-100 outline-none focus:border-yellow-500"
                    />
                    <button
                        onClick={() => void sendMessage()}
                        disabled={!canSend}
                        className="h-10 px-4 rounded-md border border-yellow-700 bg-yellow-600/20 text-yellow-300 hover:bg-yellow-600/30 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-colors flex items-center gap-2"
                    >
                        {sending ? 'Sending...' : (<><Send className="h-3.5 w-3.5" /> Send</>)}
                    </button>
                </div>
            </div>

            <div className="text-[11px] text-zinc-500 break-words flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5" />
                {statusMessage}
            </div>
        </section>
    );
}

function LedgerMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded border border-white/10 bg-black/40 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
            <div className="text-sm font-mono text-zinc-200 mt-1">{value}</div>
        </div>
    );
}
