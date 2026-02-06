
import { NextResponse, NextRequest } from 'next/server';
import pool from '@/lib/db';

// Resolve ENS name to address via public API
async function resolveENS(name: string): Promise<string | null> {
    try {
        const res = await fetch(`https://api.ensideas.com/ens/resolve/${name}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data.address || null;
    } catch {
        return null;
    }
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        let query = searchParams.get('q')?.trim() || '';

        const client = await pool.connect();

        // Check if table exists first (to avoid error on first load)
        const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'agents'
      );
    `);

        if (!tableCheck.rows[0].exists) {
            client.release();
            return NextResponse.json({ agents: [], status: 'init_needed' });
        }

        // If query looks like ENS, resolve it first
        if (query.endsWith('.eth')) {
            const resolved = await resolveENS(query);
            if (resolved) {
                query = resolved; // Use resolved address for search
            }
        }

        let res;
        if (query) {
            // Multi-field search
            res = await client.query(`
                SELECT 
                    a.id, a.owner, a.wallet, a.name, a.ticker, a.image, a.description, 
                    a.trust_score, a.total_claims, a.total_revenue, a.total_slashed, 
                    a.is_active, a.status, a.created_at,
                    auc.auction_address, auc.status as auction_status, auc.total_cleared
                FROM agents a
                LEFT JOIN auctions auc ON a.id = auc.agent_id
                WHERE 
                    a.id::TEXT = $1
                    OR LOWER(a.name) LIKE LOWER($2)
                    OR LOWER(a.owner) LIKE LOWER($3)
                    OR LOWER(a.wallet) LIKE LOWER($3)
                    OR LOWER(a.claimed_name) LIKE LOWER($2)
                ORDER BY a.id DESC
            `, [query, `%${query}%`, `${query}%`]);
        } else {
            // No search, return all
            res = await client.query(`
                SELECT 
                    a.id, a.owner, a.wallet, a.name, a.ticker, a.image, a.description, 
                    a.trust_score, a.total_claims, a.total_revenue, a.total_slashed, 
                    a.is_active, a.status, a.created_at,
                    auc.auction_address, auc.status as auction_status, auc.total_cleared
                FROM agents a
                LEFT JOIN auctions auc ON a.id = auc.agent_id
                ORDER BY a.id DESC
            `);
        }
        client.release();

        return NextResponse.json({ agents: res.rows, status: 'success' });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
