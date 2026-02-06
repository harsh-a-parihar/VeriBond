import { randomUUID } from 'crypto';
import { parseUnits } from 'viem';
import pool from '@/lib/db';

const DEFAULT_MESSAGE_FEE_MICRO_USDC = BigInt(process.env.YELLOW_MESSAGE_FEE_MICRO_USDC ?? '20000'); // 0.02 USDC
const DEFAULT_SETTLE_THRESHOLD_MICRO_USDC = BigInt(process.env.YELLOW_SETTLE_THRESHOLD_MICRO_USDC ?? '100000'); // 0.10 USDC
const DEFAULT_PREPAY_MICRO_USDC = BigInt(process.env.YELLOW_DEFAULT_PREPAY_MICRO_USDC ?? '1000000'); // 1.00 USDC

export type ChatSession = {
    id: string;
    agentId: string;
    payer: string;
    endpointType: string;
    endpointUrl: string;
    messageFeeMicroUsdc: string;
    settleThresholdMicroUsdc: string;
    prepaidBalanceMicroUsdc: string;
    unsettledMicroUsdc: string;
    totalSettledMicroUsdc: string;
    messageCount: number;
    status: string;
    createdAt: string;
    updatedAt: string;
    lastSettledAt: string | null;
};

export type ChatMessage = {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    feeMicroUsdc: string;
    createdAt: string;
};

type SessionRow = {
    id: string;
    agent_id: string;
    payer: string;
    endpoint_type: string;
    endpoint_url: string;
    message_fee_micro: string;
    settle_threshold_micro: string;
    prepaid_balance_micro: string;
    unsettled_micro: string;
    total_settled_micro: string;
    message_count: number;
    status: string;
    created_at: string;
    updated_at: string;
    last_settled_at: string | null;
};

type MessageRow = {
    id: string;
    session_id: string;
    role: 'user' | 'assistant';
    content: string;
    fee_micro: string;
    created_at: string;
};

let schemaReadyPromise: Promise<void> | null = null;

function toChatSession(row: SessionRow): ChatSession {
    return {
        id: row.id,
        agentId: row.agent_id,
        payer: row.payer,
        endpointType: row.endpoint_type,
        endpointUrl: row.endpoint_url,
        messageFeeMicroUsdc: row.message_fee_micro,
        settleThresholdMicroUsdc: row.settle_threshold_micro,
        prepaidBalanceMicroUsdc: row.prepaid_balance_micro,
        unsettledMicroUsdc: row.unsettled_micro,
        totalSettledMicroUsdc: row.total_settled_micro,
        messageCount: Number(row.message_count ?? 0),
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastSettledAt: row.last_settled_at,
    };
}

function toChatMessage(row: MessageRow): ChatMessage {
    return {
        id: row.id,
        sessionId: row.session_id,
        role: row.role,
        content: row.content,
        feeMicroUsdc: row.fee_micro,
        createdAt: row.created_at,
    };
}

export function parseUsdcToMicro(value: string | undefined): bigint {
    if (!value || !value.trim()) return DEFAULT_PREPAY_MICRO_USDC;
    return parseUnits(value.trim(), 6);
}

export async function ensureChatRailSchema(): Promise<void> {
    if (schemaReadyPromise) return schemaReadyPromise;

    schemaReadyPromise = (async () => {
        const client = await pool.connect();
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL,
                    payer TEXT NOT NULL,
                    endpoint_type TEXT NOT NULL,
                    endpoint_url TEXT NOT NULL,
                    message_fee_micro BIGINT NOT NULL,
                    settle_threshold_micro BIGINT NOT NULL,
                    prepaid_balance_micro BIGINT NOT NULL,
                    unsettled_micro BIGINT NOT NULL DEFAULT 0,
                    total_settled_micro BIGINT NOT NULL DEFAULT 0,
                    message_count INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'open',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_settled_at TIMESTAMPTZ
                );
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id BIGSERIAL PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                    content TEXT NOT NULL,
                    fee_micro BIGINT NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            `);

            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created_at
                ON chat_messages(session_id, created_at DESC);
            `);
        } finally {
            client.release();
        }
    })();

    return schemaReadyPromise;
}

export async function createChatSession(params: {
    agentId: string;
    payer: string;
    endpointType?: string;
    endpointUrl: string;
    prepayMicroUsdc?: bigint;
    messageFeeMicroUsdc?: bigint;
    settleThresholdMicroUsdc?: bigint;
}): Promise<ChatSession> {
    await ensureChatRailSchema();

    const prepay = params.prepayMicroUsdc ?? DEFAULT_PREPAY_MICRO_USDC;
    const messageFee = params.messageFeeMicroUsdc ?? DEFAULT_MESSAGE_FEE_MICRO_USDC;
    const settleThreshold = params.settleThresholdMicroUsdc ?? DEFAULT_SETTLE_THRESHOLD_MICRO_USDC;
    const sessionId = `ys_${randomUUID().replace(/-/g, '')}`;

    const client = await pool.connect();
    try {
        const result = await client.query<SessionRow>(`
            INSERT INTO chat_sessions (
                id, agent_id, payer, endpoint_type, endpoint_url,
                message_fee_micro, settle_threshold_micro, prepaid_balance_micro
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *;
        `, [
            sessionId,
            params.agentId,
            params.payer.toLowerCase(),
            (params.endpointType ?? 'REST').toUpperCase(),
            params.endpointUrl,
            messageFee.toString(),
            settleThreshold.toString(),
            prepay.toString(),
        ]);

        return toChatSession(result.rows[0]);
    } finally {
        client.release();
    }
}

export async function getChatSession(sessionId: string): Promise<ChatSession | null> {
    await ensureChatRailSchema();
    const client = await pool.connect();
    try {
        const result = await client.query<SessionRow>(
            `SELECT * FROM chat_sessions WHERE id = $1 LIMIT 1`,
            [sessionId]
        );
        if (result.rowCount === 0) return null;
        return toChatSession(result.rows[0]);
    } finally {
        client.release();
    }
}

export async function listChatMessages(sessionId: string, limit = 100): Promise<ChatMessage[]> {
    await ensureChatRailSchema();
    const client = await pool.connect();
    try {
        const result = await client.query<MessageRow>(
            `SELECT id::text, session_id, role, content, fee_micro::text, created_at::text
             FROM chat_messages
             WHERE session_id = $1
             ORDER BY created_at ASC
             LIMIT $2`,
            [sessionId, limit]
        );
        return result.rows.map(toChatMessage);
    } finally {
        client.release();
    }
}

export async function appendMessagesAndDebit(params: {
    sessionId: string;
    payer: string;
    userMessage: string;
    assistantMessage: string;
}): Promise<{ session: ChatSession; shouldSettle: boolean }> {
    await ensureChatRailSchema();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const sessionResult = await client.query<SessionRow>(
            `SELECT * FROM chat_sessions WHERE id = $1 FOR UPDATE`,
            [params.sessionId]
        );

        if (sessionResult.rowCount === 0) {
            throw new Error('Session not found');
        }

        const row = sessionResult.rows[0];
        if (row.status !== 'open') {
            throw new Error('Session is not open');
        }

        if (row.payer.toLowerCase() !== params.payer.toLowerCase()) {
            throw new Error('Session payer mismatch');
        }

        const fee = BigInt(row.message_fee_micro);
        const balance = BigInt(row.prepaid_balance_micro);
        const unsettled = BigInt(row.unsettled_micro);
        const settleThreshold = BigInt(row.settle_threshold_micro);

        if (balance < fee) {
            throw new Error('Insufficient prepaid balance. Settle/fund before sending more messages.');
        }

        const nextBalance = balance - fee;
        const nextUnsettled = unsettled + fee;

        await client.query(
            `UPDATE chat_sessions
             SET prepaid_balance_micro = $2,
                 unsettled_micro = $3,
                 message_count = message_count + 1,
                 updated_at = NOW()
             WHERE id = $1`,
            [params.sessionId, nextBalance.toString(), nextUnsettled.toString()]
        );

        await client.query(
            `INSERT INTO chat_messages (session_id, role, content, fee_micro)
             VALUES ($1, 'user', $2, 0),
                    ($1, 'assistant', $3, $4)`,
            [params.sessionId, params.userMessage, params.assistantMessage, fee.toString()]
        );

        const updatedResult = await client.query<SessionRow>(
            `SELECT * FROM chat_sessions WHERE id = $1 LIMIT 1`,
            [params.sessionId]
        );

        await client.query('COMMIT');

        return {
            session: toChatSession(updatedResult.rows[0]),
            shouldSettle: nextUnsettled >= settleThreshold,
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function settleChatSession(params: {
    sessionId: string;
    payer: string;
}): Promise<{ session: ChatSession; settledMicroUsdc: string }> {
    await ensureChatRailSchema();
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const sessionResult = await client.query<SessionRow>(
            `SELECT * FROM chat_sessions WHERE id = $1 FOR UPDATE`,
            [params.sessionId]
        );

        if (sessionResult.rowCount === 0) {
            throw new Error('Session not found');
        }

        const row = sessionResult.rows[0];

        if (row.payer.toLowerCase() !== params.payer.toLowerCase()) {
            throw new Error('Session payer mismatch');
        }

        const unsettled = BigInt(row.unsettled_micro);

        await client.query(
            `UPDATE chat_sessions
             SET total_settled_micro = total_settled_micro + $2,
                 unsettled_micro = 0,
                 last_settled_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1`,
            [params.sessionId, unsettled.toString()]
        );

        const updatedResult = await client.query<SessionRow>(
            `SELECT * FROM chat_sessions WHERE id = $1 LIMIT 1`,
            [params.sessionId]
        );

        await client.query('COMMIT');

        return {
            session: toChatSession(updatedResult.rows[0]),
            settledMicroUsdc: unsettled.toString(),
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
