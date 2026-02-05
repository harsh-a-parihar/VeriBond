
import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
    try {
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

        const res = await client.query('SELECT * FROM agents ORDER BY id DESC');
        client.release();

        return NextResponse.json({ agents: res.rows, status: 'success' });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
