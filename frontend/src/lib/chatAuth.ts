import type { Address } from 'viem';

export const CHAT_AUTH_VERSION = 'veribond-chat-session-v1';
export const CHAT_AUTH_DEFAULT_TTL_MS = 5 * 60 * 1000;
const CHAT_AUTH_MAX_LIFETIME_MS = 15 * 60 * 1000;
const CHAT_AUTH_MAX_CLOCK_SKEW_MS = 60 * 1000;

export type ChatSignatureType = 'eip191' | 'eip712';

export type ChatSessionAuthPayload = {
    version: string;
    agentId: string;
    payer: Address;
    endpointType: string;
    endpointUrl: string;
    chainId: number;
    issuedAt: number;
    expiresAt: number;
    nonce: string;
};

function sanitizeEndpointType(endpointType: string): string {
    return endpointType.trim().toUpperCase() || 'REST';
}

function sanitizeEndpointUrl(endpointUrl: string): string {
    return endpointUrl.trim();
}

function sanitizeAgentId(agentId: string): string {
    return agentId.trim();
}

function sanitizePayer(payer: Address): Address {
    return payer.trim().toLowerCase() as Address;
}

export function normalizeChatSessionAuthPayload(payload: ChatSessionAuthPayload): ChatSessionAuthPayload {
    return {
        version: payload.version.trim(),
        agentId: sanitizeAgentId(payload.agentId),
        payer: sanitizePayer(payload.payer),
        endpointType: sanitizeEndpointType(payload.endpointType),
        endpointUrl: sanitizeEndpointUrl(payload.endpointUrl),
        chainId: Number(payload.chainId),
        issuedAt: Number(payload.issuedAt),
        expiresAt: Number(payload.expiresAt),
        nonce: payload.nonce.trim(),
    };
}

function randomHexNonce(size = 16): string {
    try {
        if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
            const bytes = new Uint8Array(size);
            window.crypto.getRandomValues(bytes);
            return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
        }
    } catch {
        // Fall through to node/random fallback.
    }
    let out = '';
    for (let i = 0; i < size; i += 1) {
        out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    }
    return out;
}

export function createChatSessionAuthPayload(params: {
    agentId: string;
    payer: Address;
    endpointType: string;
    endpointUrl: string;
    chainId: number;
    ttlMs?: number;
}): ChatSessionAuthPayload {
    const issuedAt = Date.now();
    const ttlMs = Math.max(30_000, Math.min(params.ttlMs ?? CHAT_AUTH_DEFAULT_TTL_MS, CHAT_AUTH_MAX_LIFETIME_MS));
    const expiresAt = issuedAt + ttlMs;

    return normalizeChatSessionAuthPayload({
        version: CHAT_AUTH_VERSION,
        agentId: params.agentId,
        payer: params.payer,
        endpointType: params.endpointType,
        endpointUrl: params.endpointUrl,
        chainId: params.chainId,
        issuedAt,
        expiresAt,
        nonce: randomHexNonce(16),
    });
}

export function isFreshChatSessionAuthPayload(payload: ChatSessionAuthPayload, nowMs = Date.now()): boolean {
    const p = normalizeChatSessionAuthPayload(payload);
    if (p.version !== CHAT_AUTH_VERSION) return false;
    if (!Number.isFinite(p.issuedAt) || !Number.isFinite(p.expiresAt)) return false;
    if (p.expiresAt <= p.issuedAt) return false;
    if (p.expiresAt - p.issuedAt > CHAT_AUTH_MAX_LIFETIME_MS) return false;
    if (p.issuedAt > nowMs + CHAT_AUTH_MAX_CLOCK_SKEW_MS) return false;
    if (nowMs > p.expiresAt + CHAT_AUTH_MAX_CLOCK_SKEW_MS) return false;
    if (!p.nonce || p.nonce.length < 16) return false;
    if (!p.agentId || !p.endpointUrl) return false;
    return true;
}

export function buildChatSessionAuthMessage(payload: ChatSessionAuthPayload): string {
    const p = normalizeChatSessionAuthPayload(payload);

    return [
        'VeriBond Chat Session Authorization',
        `version:${p.version}`,
        `agentId:${p.agentId}`,
        `payer:${p.payer}`,
        `endpointType:${p.endpointType}`,
        `endpointUrl:${p.endpointUrl}`,
        `chainId:${p.chainId}`,
        `issuedAt:${p.issuedAt}`,
        `expiresAt:${p.expiresAt}`,
        `nonce:${p.nonce}`,
    ].join('\n');
}

export function buildChatSessionTypedData(payload: ChatSessionAuthPayload) {
    const p = normalizeChatSessionAuthPayload(payload);
    return {
        domain: {
            name: 'VeriBond Chat',
            version: '1',
            chainId: p.chainId,
        },
        primaryType: 'ChatSession',
        types: {
            ChatSession: [
                { name: 'version', type: 'string' },
                { name: 'agentId', type: 'string' },
                { name: 'payer', type: 'address' },
                { name: 'endpointType', type: 'string' },
                { name: 'endpointUrl', type: 'string' },
                { name: 'chainId', type: 'uint256' },
                { name: 'issuedAt', type: 'uint256' },
                { name: 'expiresAt', type: 'uint256' },
                { name: 'nonce', type: 'string' },
            ],
        },
        message: {
            version: p.version,
            agentId: p.agentId,
            payer: p.payer,
            endpointType: p.endpointType,
            endpointUrl: p.endpointUrl,
            chainId: BigInt(p.chainId),
            issuedAt: BigInt(p.issuedAt),
            expiresAt: BigInt(p.expiresAt),
            nonce: p.nonce,
        },
    } as const;
}
