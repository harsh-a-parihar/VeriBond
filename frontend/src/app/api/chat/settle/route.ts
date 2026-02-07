import { NextResponse } from 'next/server';
import { getAgentEarnings, getChatSession, settleChatSession, updateChatSessionYellowState } from '@/lib/chatRail';
import { submitYellowUsage } from '@/lib/yellowSession';

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

        let yellowSettlement: {
            enabled: boolean;
            ok: boolean;
            appSessionId?: `0x${string}`;
            version?: number;
            status?: string;
            error?: string;
        } | null = null;

        if (result.session.yellowAppSessionId && BigInt(result.settledMicroUsdc || '0') > BigInt(0)) {
            yellowSettlement = await submitYellowUsage({
                sessionId: result.session.id,
                appSessionId: result.session.yellowAppSessionId as `0x${string}`,
                currentVersion: result.session.yellowVersion ?? 0,
                agentRecipient: result.session.agentRecipient as `0x${string}`,
                settledMicroUsdc: result.settledMicroUsdc,
                asset: result.session.yellowAsset,
            });

            if (yellowSettlement.enabled) {
                await updateChatSessionYellowState({
                    sessionId: result.session.id,
                    yellowAppSessionId: yellowSettlement.appSessionId ?? result.session.yellowAppSessionId,
                    yellowVersion: yellowSettlement.version ?? result.session.yellowVersion,
                    yellowStatus: yellowSettlement.status ?? (yellowSettlement.ok ? 'settled' : 'settle-error'),
                    yellowLastError: yellowSettlement.error ?? null,
                });
            }
        }

        const latestSession = await getChatSession(result.session.id);
        const session = latestSession ?? result.session;
        const earnings = await getAgentEarnings(session.agentId, session.agentRecipient);
        return NextResponse.json({ ...result, session, earnings, yellowSettlement });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to settle session';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
