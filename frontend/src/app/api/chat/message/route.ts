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

const RETRYABLE_STATUS_CODES = new Set([408, 425, 500, 502, 503, 504]);
const AGENT_CHAT_TIMEOUT_MS = Math.max(5000, Number(process.env.AGENT_CHAT_TIMEOUT_MS ?? '120000'));
const AGENT_CHAT_MAX_RETRIES = Math.max(0, Number(process.env.AGENT_CHAT_MAX_RETRIES ?? '0'));
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

function isAgentFailurePayload(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return true;
    return normalized.startsWith('llm error:')
        || normalized.includes('"status": "resource_exhausted"'.toLowerCase())
        || normalized.includes('quota exceeded')
        || normalized.includes('rate limit');
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

/**
 * Resolve ENS name to URL via public ENS API.
 * Looks for 'url' or 'veribond.endpoint' text records.
 */
async function resolveENSToUrl(ensName: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        // Try public ENS API to get text records
        const apiUrl = `https://api.ensideas.com/ens/resolve/${encodeURIComponent(ensName.toLowerCase())}`;
        const res = await fetch(apiUrl, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });

        if (!res.ok) {
            throw new Error(`ENS resolution failed: ${res.status}`);
        }

        const data = await res.json() as Record<string, unknown>;

        // Check for URL in text records or resolved data
        const textRecords = data.texts as Record<string, string> | undefined;
        const urlFromText =
            textRecords?.['veribond.endpoint'] ||
            textRecords?.['url'] ||
            textRecords?.['endpoint'] ||
            (typeof data.url === 'string' ? data.url : null);

        if (urlFromText && typeof urlFromText === 'string' && urlFromText.trim()) {
            // Validate it's a proper URL
            try {
                const parsed = new URL(urlFromText.trim());
                if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
                    return parsed.toString();
                }
            } catch {
                // Not a valid URL
            }
        }

        throw new Error(`No URL text record found for ${ensName}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'ENS resolution failed';
        throw new Error(`Failed to resolve ENS endpoint ${ensName}: ${message}`);
    } finally {
        clearTimeout(timeout);
    }
}

async function resolveEndpointUrl(endpointType: string, endpointUrl: string): Promise<string> {
    const type = endpointType.toUpperCase();

    // Handle ENS endpoints - resolve .eth name to URL from text records
    if (type === 'ENS') {
        return await resolveENSToUrl(endpointUrl);
    }

    // Handle A2A endpoints - fetch agent card to find chat endpoint
    if (type !== 'A2A') {
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
                    const output = reply || rawText || 'Agent responded with an empty JSON payload.';
                    if (isAgentFailurePayload(output)) {
                        throw new Error(`Agent backend error: ${output.slice(0, 280)}`);
                    }
                    return output;
                } catch {
                    // Fall through to text return.
                }
            }

            const output = rawText?.trim() || 'Agent responded with an empty message.';
            if (isAgentFailurePayload(output)) {
                throw new Error(`Agent backend error: ${output.slice(0, 280)}`);
            }
            return output;
        } catch (error) {
            lastError = error;
            const normalizedError = (error instanceof DOMException && error.name === 'AbortError')
                ? new Error(`Agent endpoint timeout after ${Math.floor(AGENT_CHAT_TIMEOUT_MS / 1000)}s (${url})`)
                : error;
            const isLastAttempt = attempt >= AGENT_CHAT_MAX_RETRIES;
            const isRetriable =
                (normalizedError instanceof EndpointHttpError && normalizedError.retriable)
                || (normalizedError instanceof Error && normalizedError.message.includes('timeout'))
                || (normalizedError instanceof TypeError);

            if (isLastAttempt || !isRetriable) {
                throw normalizedError;
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
