import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
    try {
        const client = await pool.connect();
        try {
            const tableCheck = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_schema = 'public'
                      AND table_name = 'auctions'
                ) AS exists;
            `);

            if (!tableCheck.rows[0]?.exists) {
                return NextResponse.json({
                    status: 'success',
                    launched: 0,
                });
            }

            const result = await client.query(`
                SELECT COUNT(*)::int AS launched
                FROM auctions
                WHERE auction_address IS NOT NULL;
            `);

            return NextResponse.json({
                status: 'success',
                launched: Number(result.rows[0]?.launched ?? 0),
            });
        } finally {
            client.release();
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to fetch auction stats';
        return NextResponse.json(
            {
                status: 'error',
                error: message,
            },
            { status: 500 },
        );
    }
}
