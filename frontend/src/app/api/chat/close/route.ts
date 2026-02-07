import { NextResponse } from 'next/server';
import { closeChatSession, getAgentEarnings, getChatSession, updateChatSessionYellowState } from '@/lib/chatRail';
import { closeYellowAppSession } from '@/lib/yellowSession';

export async function POST(request: Request) {
    try {
        const body = await request.json() as {
            sessionId?: string;
            payer?: string;
        };

        const sessionId = body.sessionId?.trim();
        const payer = body.payer?.trim();

        if (!sessionId) {
            return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
        }
        if (!payer) {
            return NextResponse.json({ error: 'payer is required' }, { status: 400 });
        }

        const session = await getChatSession(sessionId);
        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }
        if (session.payer.toLowerCase() !== payer.toLowerCase()) {
            return NextResponse.json({ error: 'Session payer mismatch' }, { status: 403 });
        }
        if (session.status !== 'open') {
            const earnings = await getAgentEarnings(session.agentId, session.agentRecipient);
            return NextResponse.json({ session, earnings, yellowClose: null });
        }

        if (BigInt(session.unsettledMicroUsdc || '0') > BigInt(0)) {
            return NextResponse.json(
                { error: 'Session has unsettled usage. Settle usage before closing.' },
                { status: 400 },
            );
        }

        let yellowClose: {
            enabled: boolean;
            ok: boolean;
            appSessionId?: `0x${string}`;
            version?: number;
            status?: string;
            error?: string;
        } | null = null;

        if (session.yellowAppSessionId) {
            yellowClose = await closeYellowAppSession({
                sessionId: session.id,
                appSessionId: session.yellowAppSessionId as `0x${string}`,
                currentVersion: session.yellowVersion ?? 0,
                agentRecipient: session.agentRecipient as `0x${string}`,
                totalSettledMicroUsdc: session.totalSettledMicroUsdc,
                asset: session.yellowAsset,
            });

            if (yellowClose.enabled) {
                await updateChatSessionYellowState({
                    sessionId: session.id,
                    yellowAppSessionId: yellowClose.appSessionId ?? session.yellowAppSessionId,
                    yellowVersion: yellowClose.version ?? session.yellowVersion,
                    yellowStatus: yellowClose.status ?? (yellowClose.ok ? 'closed' : 'close-error'),
                    yellowLastError: yellowClose.error ?? null,
                });
            }

            if (yellowClose.enabled && !yellowClose.ok) {
                return NextResponse.json(
                    { error: yellowClose.error ?? 'Failed to close Yellow app session', yellowClose },
                    { status: 502 },
                );
            }
        }

        const closed = await closeChatSession({ sessionId: session.id, payer });
        const earnings = await getAgentEarnings(closed.agentId, closed.agentRecipient);
        return NextResponse.json({ session: closed, earnings, yellowClose });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to close session';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
