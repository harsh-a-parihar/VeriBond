
import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');

    try {
        const client = await pool.connect();

        // Simple query builder
        let query = `
            SELECT 
                id, agent_id, submitter, stake, predicted_outcome, 
                resolved, outcome, created_at, resolved_at 
            FROM claims
        `;
        const values: any[] = [];

        if (agentId) {
            query += ` WHERE agent_id = $1`;
            values.push(agentId);
        }

        query += ` ORDER BY created_at DESC LIMIT 50`;

        const res = await client.query(query, values);
        client.release();

        return NextResponse.json({ claims: res.rows, status: 'success' });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
