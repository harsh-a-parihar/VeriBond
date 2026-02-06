import { NextResponse } from 'next/server';
import { settleChatSession } from '@/lib/chatRail';

export async function POST(request: Request) {
    try {
        const body = await request.json() as {
            sessionId?: string;
            payer?: string;
        };

        if (!body.sessionId?.trim()) {
            return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
        }
        if (!body.payer?.trim()) {
            return NextResponse.json({ error: 'payer is required' }, { status: 400 });
        }

        const result = await settleChatSession({
            sessionId: body.sessionId.trim(),
            payer: body.payer.trim(),
        });

        return NextResponse.json(result);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to settle session';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
