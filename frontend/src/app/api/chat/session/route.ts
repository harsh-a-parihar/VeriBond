import { NextResponse } from 'next/server';
import { createChatSession, listChatMessages, parseUsdcToMicro } from '@/lib/chatRail';

function isHttpUrl(value: string): boolean {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json() as {
            agentId?: string;
            payer?: string;
            endpointType?: string;
            endpointUrl?: string;
            prepayUsdc?: string;
        };

        if (!body.agentId?.trim()) {
            return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
        }
        if (!body.payer?.trim()) {
            return NextResponse.json({ error: 'payer is required' }, { status: 400 });
        }
        if (!body.endpointUrl?.trim() || !isHttpUrl(body.endpointUrl)) {
            return NextResponse.json({ error: 'Valid endpointUrl is required' }, { status: 400 });
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

        const session = await createChatSession({
            agentId: body.agentId.trim(),
            payer: body.payer.trim(),
            endpointType: body.endpointType,
            endpointUrl: body.endpointUrl.trim(),
            prepayMicroUsdc,
        });

        const messages = await listChatMessages(session.id, 100);
        return NextResponse.json({ session, messages });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to open chat session';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
