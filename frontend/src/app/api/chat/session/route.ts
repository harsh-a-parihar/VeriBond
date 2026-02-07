import { NextResponse } from 'next/server';
import type { Address } from 'viem';
import { isAddress, verifyMessage, verifyTypedData } from 'viem';
import { createChatSession, getAgentEarnings, getChatSession, listChatMessages, parseUsdcToMicro, updateChatSessionYellowState } from '@/lib/chatRail';
import {
    buildChatSessionAuthMessage,
    buildChatSessionTypedData,
    isFreshChatSessionAuthPayload,
    normalizeChatSessionAuthPayload,
    type ChatSessionAuthPayload,
    type ChatSignatureType,
} from '@/lib/chatAuth';
import { isAllowedChatEndpointUrl, isValidENSEndpoint } from '@/lib/chatEndpointSecurity';
import { getYellowRailSnapshot } from '@/lib/yellowRail';
import { initializeYellowAppSession } from '@/lib/yellowSession';
import { getYellowChainIdOrDefault } from '@/lib/yellowConfig';


type SessionAuthRequest = {
    signatureType?: ChatSignatureType;
    signature?: Address | `0x${string}` | string;
    payload?: ChatSessionAuthPayload;
};

function sameString(a: string, b: string): boolean {
    return a.trim() === b.trim();
}

function sameAddress(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function sameEndpointType(a: string, b: string): boolean {
    return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function coerceHexSignature(value: string | undefined): `0x${string}` | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!/^0x[0-9a-fA-F]+$/.test(trimmed)) return null;
    return trimmed as `0x${string}`;
}

function coerceAuthPayload(value: unknown): ChatSessionAuthPayload | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<ChatSessionAuthPayload>;
    if (
        typeof candidate.version !== 'string'
        || typeof candidate.agentId !== 'string'
        || typeof candidate.payer !== 'string'
        || typeof candidate.endpointType !== 'string'
        || typeof candidate.endpointUrl !== 'string'
        || typeof candidate.chainId !== 'number'
        || typeof candidate.issuedAt !== 'number'
        || typeof candidate.expiresAt !== 'number'
        || typeof candidate.nonce !== 'string'
    ) {
        return null;
    }

    return {
        version: candidate.version,
        agentId: candidate.agentId,
        payer: candidate.payer as Address,
        endpointType: candidate.endpointType,
        endpointUrl: candidate.endpointUrl,
        chainId: candidate.chainId,
        issuedAt: candidate.issuedAt,
        expiresAt: candidate.expiresAt,
        nonce: candidate.nonce,
    };
}

async function verifySessionAuth(params: {
    auth: SessionAuthRequest | undefined;
    agentId: string;
    payer: Address;
    endpointType: string;
    endpointUrl: string;
}): Promise<{ ok: boolean; reason?: string; payload?: ChatSessionAuthPayload; signatureType?: ChatSignatureType }> {
    if (!params.auth) return { ok: false, reason: 'auth is required' };
    const signatureType = params.auth.signatureType ?? 'eip191';
    if (signatureType !== 'eip191' && signatureType !== 'eip712') {
        return { ok: false, reason: 'Unsupported signatureType' };
    }

    const signature = coerceHexSignature(typeof params.auth.signature === 'string' ? params.auth.signature : undefined);
    if (!signature) {
        return { ok: false, reason: 'Valid auth signature is required' };
    }

    const payload = coerceAuthPayload(params.auth.payload);
    if (!payload) {
        return { ok: false, reason: 'Valid auth payload is required' };
    }

    const normalized = normalizeChatSessionAuthPayload(payload);
    if (!isFreshChatSessionAuthPayload(normalized)) {
        return { ok: false, reason: 'Auth payload expired or invalid' };
    }

    if (!sameString(normalized.agentId, params.agentId)) {
        return { ok: false, reason: 'Auth payload agentId mismatch' };
    }
    if (!sameAddress(normalized.payer, params.payer)) {
        return { ok: false, reason: 'Auth payload payer mismatch' };
    }
    if (!sameEndpointType(normalized.endpointType, params.endpointType)) {
        return { ok: false, reason: 'Auth payload endpointType mismatch' };
    }
    if (!sameString(normalized.endpointUrl, params.endpointUrl)) {
        return { ok: false, reason: 'Auth payload endpointUrl mismatch' };
    }

    if (signatureType === 'eip712') {
        const typedData = buildChatSessionTypedData(normalized);
        const isValid = await verifyTypedData({
            address: params.payer,
            domain: typedData.domain,
            types: typedData.types,
            primaryType: typedData.primaryType,
            message: typedData.message,
            signature,
        });
        if (!isValid) {
            return { ok: false, reason: 'Invalid auth signature' };
        }
        return { ok: true, payload: normalized, signatureType };
    }

    const message = buildChatSessionAuthMessage(normalized);
    const isValid = await verifyMessage({
        address: params.payer,
        message,
        signature,
    });
    if (!isValid) {
        return { ok: false, reason: 'Invalid auth signature' };
    }

    return { ok: true, payload: normalized, signatureType };
}

export async function POST(request: Request) {
    try {
        const body = await request.json() as {
            agentId?: string;
            payer?: string;
            agentRecipient?: string;
            endpointType?: string;
            endpointUrl?: string;
            prepayUsdc?: string;
            auth?: SessionAuthRequest;
        };

        const agentId = body.agentId?.trim();
        const payer = body.payer?.trim().toLowerCase() as Address | undefined;
        const agentRecipient = body.agentRecipient?.trim().toLowerCase() as Address | undefined;
        const endpointType = (body.endpointType ?? 'REST').trim().toUpperCase();
        const endpointUrl = body.endpointUrl?.trim();

        if (!agentId) {
            return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
        }
        if (!payer) {
            return NextResponse.json({ error: 'payer is required' }, { status: 400 });
        }
        if (!agentRecipient || !isAddress(agentRecipient)) {
            return NextResponse.json({ error: 'Valid agentRecipient is required' }, { status: 400 });
        }
        // Allow ENS names (*.eth) when endpoint type is ENS, or valid URLs otherwise
        const isValidEndpoint = endpointUrl && (
            isAllowedChatEndpointUrl(endpointUrl) ||
            (endpointType === 'ENS' && isValidENSEndpoint(endpointUrl))
        );
        if (!isValidEndpoint) {
            return NextResponse.json({ error: 'Valid endpointUrl is required (URL or .eth name for ENS type)' }, { status: 400 });
        }

        let prepayMicroUsdc: bigint;
        try {
            prepayMicroUsdc = parseUsdcToMicro(body.prepayUsdc);
        } catch {
            return NextResponse.json({ error: 'Invalid prepayUsdc' }, { status: 400 });
        }

        if (prepayMicroUsdc <= BigInt(0)) {
            return NextResponse.json({ error: 'prepayUsdc must be greater than 0' }, { status: 400 });
        }

        const authResult = await verifySessionAuth({
            auth: body.auth,
            agentId,
            payer,
            endpointType,
            endpointUrl,
        });
        if (!authResult.ok) {
            return NextResponse.json({ error: authResult.reason ?? 'Auth verification failed' }, { status: 401 });
        }

        const created = await createChatSession({
            agentId,
            payer,
            agentRecipient,
            endpointType,
            endpointUrl,
            prepayMicroUsdc,
            authNonce: authResult.payload?.nonce,
            authSignatureType: authResult.signatureType,
            authIssuedAtMs: authResult.payload?.issuedAt,
            authExpiresAtMs: authResult.payload?.expiresAt,
        });

        const yellowInit = await initializeYellowAppSession({
            sessionId: created.id,
            payer,
            agentRecipient,
            existingAppSessionId: created.yellowAppSessionId,
        });

        if (yellowInit.enabled) {
            await updateChatSessionYellowState({
                sessionId: created.id,
                yellowAppSessionId: yellowInit.appSessionId ?? null,
                yellowAsset: yellowInit.asset ?? null,
                yellowProtocol: yellowInit.protocol ?? null,
                yellowVersion: yellowInit.version ?? 0,
                yellowStatus: yellowInit.status ?? (yellowInit.created ? 'open' : 'init-error'),
                yellowLastError: yellowInit.error ?? null,
            });
        }

        const session = await getChatSession(created.id);
        if (!session) {
            return NextResponse.json({ error: 'Failed to load created chat session' }, { status: 500 });
        }

        const messages = await listChatMessages(session.id, 100);
        const earnings = await getAgentEarnings(session.agentId, session.agentRecipient);
        const yellow = await getYellowRailSnapshot(getYellowChainIdOrDefault());

        return NextResponse.json({
            session,
            messages,
            earnings,
            yellow,
            yellowSessionInit: yellowInit,
        });
    } catch (error) {
        const pgCode = (error as { code?: string } | null)?.code;
        if (pgCode === '23505') {
            return NextResponse.json({ error: 'Auth nonce already used. Please sign again.' }, { status: 409 });
        }

        const message = error instanceof Error ? error.message : 'Failed to open chat session';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
