import { NextResponse } from 'next/server';
import { appendMessagesAndDebit, getAgentEarnings, getChatSession, listChatMessages } from '@/lib/chatRail';
import { isAllowedChatEndpointUrl } from '@/lib/chatEndpointSecurity';

type EndpointRequestPayload = {
    agentId: string;
    sessionId: string;
    payer: string;
    message: string;
    timestamp: number;
};

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const AGENT_CHAT_TIMEOUT_MS = Number(process.env.AGENT_CHAT_TIMEOUT_MS ?? '15000');
const AGENT_CHAT_MAX_RETRIES = Math.max(0, Number(process.env.AGENT_CHAT_MAX_RETRIES ?? '2'));
const AGENT_CHAT_RETRY_BASE_MS = Math.max(100, Number(process.env.AGENT_CHAT_RETRY_BASE_MS ?? '350'));

class EndpointHttpError extends Error {
    status: number;
    retriable: boolean;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
        this.retriable = RETRYABLE_STATUS_CODES.has(status);
    }
}

function extractReplyFromJson(payload: unknown): string | null {
    if (typeof payload === 'string') return payload;
    if (!payload || typeof payload !== 'object') return null;

    const data = payload as Record<string, unknown>;
    const candidates: Array<unknown> = [
        data.reply,
        data.response,
        data.message,
        data.output,
        data.text,
        data.answer,
        (data.data as Record<string, unknown> | undefined)?.reply,
        (data.data as Record<string, unknown> | undefined)?.response,
        (data.result as Record<string, unknown> | undefined)?.reply,
        (data.result as Record<string, unknown> | undefined)?.response,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate;
    }

    return null;
}

function resolveRelativeUrl(baseUrl: string, candidate: string): string | null {
    try {
        const resolved = new URL(candidate, baseUrl);
        if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
        return resolved.toString();
    } catch {
        return null;
    }
}

async function resolveEndpointUrl(endpointType: string, endpointUrl: string): Promise<string> {
    if (endpointType.toUpperCase() !== 'A2A') {
        return endpointUrl;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        const res = await fetch(endpointUrl, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });

        if (!res.ok) return endpointUrl;

        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) return endpointUrl;

        const json = await res.json() as Record<string, unknown>;
        const endpoints = Array.isArray(json.endpoints) ? json.endpoints : [];

        const endpointFromCard =
            (typeof json.chatEndpoint === 'string' && json.chatEndpoint)
            || (typeof json.invoke === 'string' && json.invoke)
            || (typeof json.endpoint === 'string' && json.endpoint)
            || (typeof json.url === 'string' && json.url)
            || (endpoints.find((item) => {
                if (!item || typeof item !== 'object') return false;
                const row = item as Record<string, unknown>;
                const type = typeof row.type === 'string' ? row.type.toUpperCase() : '';
                const value = typeof row.value === 'string' ? row.value : '';
                return !!value && (type === 'REST' || type === 'CHAT' || type === 'A2A');
            }) as Record<string, unknown> | undefined)?.value;

        if (typeof endpointFromCard === 'string' && endpointFromCard.trim()) {
            const resolved = resolveRelativeUrl(endpointUrl, endpointFromCard.trim());
            if (resolved) return resolved;
        }

        return endpointUrl;
    } catch {
        return endpointUrl;
    } finally {
        clearTimeout(timeout);
    }
}

async function callAgentEndpoint(url: string, payload: EndpointRequestPayload): Promise<string> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= AGENT_CHAT_MAX_RETRIES; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), AGENT_CHAT_TIMEOUT_MS);

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });

            const rawText = await res.text();

            if (!res.ok) {
                const errorText = rawText.length > 300 ? `${rawText.slice(0, 300)}...` : rawText;
                throw new EndpointHttpError(res.status, `Agent endpoint failed (${res.status}): ${errorText || 'No response body'}`);
            }

            const contentType = res.headers.get('content-type') ?? '';
            if (contentType.includes('application/json')) {
                try {
                    const json = JSON.parse(rawText) as unknown;
                    const reply = extractReplyFromJson(json);
                    if (reply) return reply;
                    return rawText || 'Agent responded with an empty JSON payload.';
                } catch {
                    // Fall through to text return.
                }
            }

            return rawText?.trim() || 'Agent responded with an empty message.';
        } catch (error) {
            lastError = error;
            const isLastAttempt = attempt >= AGENT_CHAT_MAX_RETRIES;
            const isRetriable =
                (error instanceof EndpointHttpError && error.retriable)
                || (error instanceof DOMException && error.name === 'AbortError')
                || (error instanceof TypeError);

            if (isLastAttempt || !isRetriable) {
                throw error;
            }

            const backoffMs = AGENT_CHAT_RETRY_BASE_MS * (2 ** attempt);
            const jitterMs = Math.floor(Math.random() * 100);
            await new Promise((resolve) => setTimeout(resolve, backoffMs + jitterMs));
        } finally {
            clearTimeout(timeout);
        }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error('Agent endpoint request failed');
}

export async function POST(request: Request) {
    try {
        const body = await request.json() as {
            sessionId?: string;
            payer?: string;
            message?: string;
        };

        if (!body.sessionId?.trim()) {
            return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
        }
        if (!body.payer?.trim()) {
            return NextResponse.json({ error: 'payer is required' }, { status: 400 });
        }
        if (!body.message?.trim()) {
            return NextResponse.json({ error: 'message is required' }, { status: 400 });
        }

        const session = await getChatSession(body.sessionId.trim());
        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }
        if (session.payer.toLowerCase() !== body.payer.trim().toLowerCase()) {
            return NextResponse.json({ error: 'Session payer mismatch' }, { status: 403 });
        }
        if (session.status !== 'open') {
            return NextResponse.json({ error: 'Session is not open' }, { status: 400 });
        }

        if (!isAllowedChatEndpointUrl(session.endpointUrl)) {
            return NextResponse.json({ error: 'Invalid session endpoint URL' }, { status: 400 });
        }

        const resolvedEndpointUrl = await resolveEndpointUrl(session.endpointType, session.endpointUrl);
        if (!isAllowedChatEndpointUrl(resolvedEndpointUrl)) {
            return NextResponse.json({ error: 'Invalid resolved endpoint URL' }, { status: 400 });
        }

        const payload: EndpointRequestPayload = {
            agentId: session.agentId,
            sessionId: session.id,
            payer: session.payer,
            message: body.message.trim(),
            timestamp: Date.now(),
        };

        const assistantReply = await callAgentEndpoint(resolvedEndpointUrl, payload);

        const debitResult = await appendMessagesAndDebit({
            sessionId: session.id,
            payer: session.payer,
            userMessage: body.message.trim(),
            assistantMessage: assistantReply,
        });

        const messages = await listChatMessages(session.id, 100);
        const earnings = await getAgentEarnings(debitResult.session.agentId, debitResult.session.agentRecipient);

        return NextResponse.json({
            reply: assistantReply,
            session: debitResult.session,
            shouldSettle: debitResult.shouldSettle,
            resolvedEndpointUrl,
            earnings,
            messages,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send chat message';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
