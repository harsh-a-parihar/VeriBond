import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getYellowRailSnapshot } from '@/lib/yellowRail';
import { getYellowChainIdOrDefault, getYellowWsUrlOrDefault, getYellowAssetOrDefault } from '@/lib/yellowConfig';
import { getAAHealthSummary } from '@/lib/aa/config';

function isSet(value: string | undefined): boolean {
    return !!value && value.trim().length > 0;
}

export async function GET() {
    const now = new Date().toISOString();

    let dbOk = false;
    let dbError: string | null = null;
    try {
        const client = await pool.connect();
        try {
            await client.query('SELECT 1');
            dbOk = true;
        } finally {
            client.release();
        }
    } catch (error) {
        dbError = error instanceof Error ? error.message : 'Database check failed';
    }

    const yellowConfig = {
        wsUrl: getYellowWsUrlOrDefault(),
        chainId: getYellowChainIdOrDefault(),
        appAsset: getYellowAssetOrDefault(),
        operatorKeyConfigured: isSet(process.env.YELLOW_OPERATOR_PRIVATE_KEY),
        signerRpcConfigured: isSet(process.env.YELLOW_SIGNER_RPC_URL) || isSet(process.env.NEXT_PUBLIC_RPC_URL),
    };
    const aaConfig = getAAHealthSummary();

    let yellowSnapshot: Awaited<ReturnType<typeof getYellowRailSnapshot>> | null = null;
    let yellowSnapshotError: string | null = null;
    if (yellowConfig.operatorKeyConfigured) {
        try {
            yellowSnapshot = await getYellowRailSnapshot(yellowConfig.chainId);
        } catch (error) {
            yellowSnapshotError = error instanceof Error ? error.message : 'Yellow snapshot check failed';
        }
    }

    const ok = dbOk;
    return NextResponse.json({
        ok,
        timestamp: now,
        checks: {
            database: {
                ok: dbOk,
                error: dbError,
            },
            yellow: {
                configured: yellowConfig.operatorKeyConfigured && yellowConfig.signerRpcConfigured,
                config: yellowConfig,
                rail: yellowSnapshot,
                snapshotError: yellowSnapshotError,
            },
            aa: {
                enabled: aaConfig.enabled,
                chainId: aaConfig.chainId,
                paymasterProxyUrl: aaConfig.paymasterProxyUrl,
                bundlerUrl: aaConfig.bundlerUrl,
                pimlicoConfigured: aaConfig.pimlicoConfigured,
            },
        },
    }, { status: 200 });
}
