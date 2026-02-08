import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import pool from '@/lib/db';

type ExistsRow = { exists: boolean };

async function tableExists(client: PoolClient, table: string): Promise<boolean> {
    const res = await client.query<ExistsRow>(
        `SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1
        ) AS exists`,
        [table],
    );
    return Boolean(res.rows[0]?.exists);
}

export async function GET() {
    const client = await pool.connect();
    try {
        const hasAgents = await tableExists(client, 'agents');
        const hasEarnings = await tableExists(client, 'agent_chat_earnings');

        let agentsRegistered = 0;
        let ensClaimed = 0;
        if (hasAgents) {
            const agentRes = await client.query<{ agents_registered: string }>(
                `SELECT COUNT(*)::text AS agents_registered FROM agents`,
            );
            agentsRegistered = Number(agentRes.rows[0]?.agents_registered ?? '0');

            const ensRes = await client.query<{ ens_claimed: string }>(
                `SELECT COUNT(*)::text AS ens_claimed
                 FROM agents
                 WHERE claimed_name IS NOT NULL AND btrim(claimed_name) <> ''`,
            );
            ensClaimed = Number(ensRes.rows[0]?.ens_claimed ?? '0');
        }

        let yellowEarnedMicroUsdc = '0';
        let yellowSettledMicroUsdc = '0';
        if (hasEarnings) {
            const yellowRes = await client.query<{
                total_earned_micro: string;
                total_settled_micro: string;
            }>(
                `SELECT
                    COALESCE(SUM(total_earned_micro), 0)::text AS total_earned_micro,
                    COALESCE(SUM(total_settled_micro), 0)::text AS total_settled_micro
                 FROM agent_chat_earnings`,
            );
            yellowEarnedMicroUsdc = yellowRes.rows[0]?.total_earned_micro ?? '0';
            yellowSettledMicroUsdc = yellowRes.rows[0]?.total_settled_micro ?? '0';
        }

        return NextResponse.json({
            agentsRegistered,
            ensClaimed,
            yellowEarnedMicroUsdc,
            yellowSettledMicroUsdc,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load summary stats';
        return NextResponse.json({ error: message }, { status: 500 });
    } finally {
        client.release();
    }
}
