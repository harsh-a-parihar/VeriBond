import { randomUUID } from 'crypto';
import { parseUnits } from 'viem';
import pool from '@/lib/db';
import type { ChatSignatureType } from '@/lib/chatAuth';

const DEFAULT_MESSAGE_FEE_MICRO_USDC = BigInt(process.env.YELLOW_MESSAGE_FEE_MICRO_USDC ?? '20000'); // 0.02 USDC
const DEFAULT_SETTLE_THRESHOLD_MICRO_USDC = BigInt(process.env.YELLOW_SETTLE_THRESHOLD_MICRO_USDC ?? '100000'); // 0.10 USDC
const DEFAULT_PREPAY_MICRO_USDC = BigInt(process.env.YELLOW_DEFAULT_PREPAY_MICRO_USDC ?? '1000000'); // 1.00 USDC

export type ChatSession = {
    id: string;
    agentId: string;
    payer: string;
    agentRecipient: string;
    endpointType: string;
    endpointUrl: string;
    messageFeeMicroUsdc: string;
    settleThresholdMicroUsdc: string;
    prepaidBalanceMicroUsdc: string;
    unsettledMicroUsdc: string;
    totalSettledMicroUsdc: string;
    messageCount: number;
    status: string;
    yellowAppSessionId: string | null;
    yellowAsset: string | null;
    yellowProtocol: string | null;
    yellowVersion: number;
    yellowStatus: string | null;
    yellowLastError: string | null;
    yellowUpdatedAt: string | null;
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

export type AgentEarnings = {
    agentId: string;
    recipient: string;
    totalEarnedMicroUsdc: string;
    totalSettledMicroUsdc: string;
    pendingMicroUsdc: string;
    updatedAt: string;
};

type SessionRow = {
    id: string;
    agent_id: string;
    payer: string;
    agent_recipient: string;
    endpoint_type: string;
    endpoint_url: string;
    message_fee_micro: string;
    settle_threshold_micro: string;
    prepaid_balance_micro: string;
    unsettled_micro: string;
    total_settled_micro: string;
    message_count: number;
    status: string;
    auth_nonce: string | null;
    auth_signature_type: string | null;
    auth_issued_at: string | null;
    auth_expires_at: string | null;
    yellow_app_session_id: string | null;
    yellow_asset: string | null;
    yellow_protocol: string | null;
    yellow_version: number | null;
    yellow_status: string | null;
    yellow_last_error: string | null;
    yellow_updated_at: string | null;
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
        agentRecipient: row.agent_recipient,
        endpointType: row.endpoint_type,
        endpointUrl: row.endpoint_url,
        messageFeeMicroUsdc: row.message_fee_micro,
        settleThresholdMicroUsdc: row.settle_threshold_micro,
        prepaidBalanceMicroUsdc: row.prepaid_balance_micro,
        unsettledMicroUsdc: row.unsettled_micro,
        totalSettledMicroUsdc: row.total_settled_micro,
        messageCount: Number(row.message_count ?? 0),
        status: row.status,
        yellowAppSessionId: row.yellow_app_session_id,
        yellowAsset: row.yellow_asset,
        yellowProtocol: row.yellow_protocol,
        yellowVersion: Number(row.yellow_version ?? 0),
        yellowStatus: row.yellow_status,
        yellowLastError: row.yellow_last_error,
        yellowUpdatedAt: row.yellow_updated_at,
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
                    agent_recipient TEXT NOT NULL,
                    endpoint_type TEXT NOT NULL,
                    endpoint_url TEXT NOT NULL,
                    message_fee_micro BIGINT NOT NULL,
                    settle_threshold_micro BIGINT NOT NULL,
                    prepaid_balance_micro BIGINT NOT NULL,
                    unsettled_micro BIGINT NOT NULL DEFAULT 0,
                    total_settled_micro BIGINT NOT NULL DEFAULT 0,
                    message_count INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'open',
                    auth_nonce TEXT,
                    auth_signature_type TEXT,
                    auth_issued_at BIGINT,
                    auth_expires_at BIGINT,
                    yellow_app_session_id TEXT,
                    yellow_asset TEXT,
                    yellow_protocol TEXT,
                    yellow_version INTEGER NOT NULL DEFAULT 0,
                    yellow_status TEXT,
                    yellow_last_error TEXT,
                    yellow_updated_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_settled_at TIMESTAMPTZ
                );
            `);

            await client.query(`
                ALTER TABLE chat_sessions
                ADD COLUMN IF NOT EXISTS auth_nonce TEXT;
            `);

            await client.query(`
                ALTER TABLE chat_sessions
                ADD COLUMN IF NOT EXISTS agent_recipient TEXT;
            `);

            await client.query(`
                UPDATE chat_sessions
                SET agent_recipient = payer
                WHERE agent_recipient IS NULL;
            `);

            await client.query(`
                ALTER TABLE chat_sessions
                ALTER COLUMN agent_recipient SET NOT NULL;
            `);

            await client.query(`
                ALTER TABLE chat_sessions
                ADD COLUMN IF NOT EXISTS auth_signature_type TEXT;
            `);

            await client.query(`
                ALTER TABLE chat_sessions
                ADD COLUMN IF NOT EXISTS auth_issued_at BIGINT;
            `);

            await client.query(`
                ALTER TABLE chat_sessions
                ADD COLUMN IF NOT EXISTS auth_expires_at BIGINT;
            `);
            await client.query(`
                ALTER TABLE chat_sessions
                ADD COLUMN IF NOT EXISTS yellow_app_session_id TEXT;
            `);
            await client.query(`
                ALTER TABLE chat_sessions
                ADD COLUMN IF NOT EXISTS yellow_asset TEXT;
            `);
            await client.query(`
                ALTER TABLE chat_sessions
                ADD COLUMN IF NOT EXISTS yellow_protocol TEXT;
            `);
            await client.query(`
                ALTER TABLE chat_sessions
                ADD COLUMN IF NOT EXISTS yellow_version INTEGER NOT NULL DEFAULT 0;
            `);
            await client.query(`
                ALTER TABLE chat_sessions
                ADD COLUMN IF NOT EXISTS yellow_status TEXT;
            `);
            await client.query(`
                ALTER TABLE chat_sessions
                ADD COLUMN IF NOT EXISTS yellow_last_error TEXT;
            `);
            await client.query(`
                ALTER TABLE chat_sessions
                ADD COLUMN IF NOT EXISTS yellow_updated_at TIMESTAMPTZ;
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

            await client.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_sessions_payer_auth_nonce
                ON chat_sessions(payer, auth_nonce)
                WHERE auth_nonce IS NOT NULL;
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS agent_chat_earnings (
                    agent_id TEXT NOT NULL,
                    recipient TEXT NOT NULL,
                    total_earned_micro BIGINT NOT NULL DEFAULT 0,
                    total_settled_micro BIGINT NOT NULL DEFAULT 0,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (agent_id, recipient)
                );
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
    agentRecipient: string;
    endpointType?: string;
    endpointUrl: string;
    prepayMicroUsdc?: bigint;
    messageFeeMicroUsdc?: bigint;
    settleThresholdMicroUsdc?: bigint;
    authNonce?: string;
    authSignatureType?: ChatSignatureType;
    authIssuedAtMs?: number;
    authExpiresAtMs?: number;
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
                id, agent_id, payer, agent_recipient, endpoint_type, endpoint_url,
                message_fee_micro, settle_threshold_micro, prepaid_balance_micro,
                auth_nonce, auth_signature_type, auth_issued_at, auth_expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *;
        `, [
            sessionId,
            params.agentId,
            params.payer.toLowerCase(),
            params.agentRecipient.toLowerCase(),
            (params.endpointType ?? 'REST').toUpperCase(),
            params.endpointUrl,
            messageFee.toString(),
            settleThreshold.toString(),
            prepay.toString(),
            params.authNonce ?? null,
            params.authSignatureType ?? null,
            params.authIssuedAtMs ?? null,
            params.authExpiresAtMs ?? null,
        ]);

        return toChatSession(result.rows[0]);
    } finally {
        client.release();
    }
}

function toAgentEarnings(row: {
    agent_id: string;
    recipient: string;
    total_earned_micro: string;
    total_settled_micro: string;
    updated_at: string;
}): AgentEarnings {
    const totalEarned = BigInt(row.total_earned_micro);
    const totalSettled = BigInt(row.total_settled_micro);
    const pending = totalEarned > totalSettled ? totalEarned - totalSettled : BigInt(0);
    return {
        agentId: row.agent_id,
        recipient: row.recipient,
        totalEarnedMicroUsdc: totalEarned.toString(),
        totalSettledMicroUsdc: totalSettled.toString(),
        pendingMicroUsdc: pending.toString(),
        updatedAt: row.updated_at,
    };
}

export async function getAgentEarnings(agentId: string, recipient: string): Promise<AgentEarnings> {
    await ensureChatRailSchema();
    const client = await pool.connect();
    try {
        const result = await client.query<{
            agent_id: string;
            recipient: string;
            total_earned_micro: string;
            total_settled_micro: string;
            updated_at: string;
        }>(
            `SELECT agent_id, recipient, total_earned_micro::text, total_settled_micro::text, updated_at::text
             FROM agent_chat_earnings
             WHERE agent_id = $1 AND recipient = $2
             LIMIT 1`,
            [agentId, recipient.toLowerCase()]
        );

        if (result.rowCount === 0) {
            return {
                agentId,
                recipient: recipient.toLowerCase(),
                totalEarnedMicroUsdc: '0',
                totalSettledMicroUsdc: '0',
                pendingMicroUsdc: '0',
                updatedAt: new Date(0).toISOString(),
            };
        }
        return toAgentEarnings(result.rows[0]);
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

export async function updateChatSessionYellowState(params: {
    sessionId: string;
    yellowAppSessionId?: string | null;
    yellowAsset?: string | null;
    yellowProtocol?: string | null;
    yellowVersion?: number;
    yellowStatus?: string | null;
    yellowLastError?: string | null;
}): Promise<ChatSession | null> {
    await ensureChatRailSchema();
    const client = await pool.connect();
    try {
        const result = await client.query<SessionRow>(
            `UPDATE chat_sessions
             SET
                yellow_app_session_id = COALESCE($2, yellow_app_session_id),
                yellow_asset = COALESCE($3, yellow_asset),
                yellow_protocol = COALESCE($4, yellow_protocol),
                yellow_version = COALESCE($5, yellow_version),
                yellow_status = COALESCE($6, yellow_status),
                yellow_last_error = $7,
                yellow_updated_at = NOW(),
                updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [
                params.sessionId,
                params.yellowAppSessionId ?? null,
                params.yellowAsset ?? null,
                params.yellowProtocol ?? null,
                params.yellowVersion ?? null,
                params.yellowStatus ?? null,
                params.yellowLastError ?? null,
            ]
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

        await client.query(
            `INSERT INTO agent_chat_earnings (agent_id, recipient, total_earned_micro, total_settled_micro, updated_at)
             VALUES ($1, $2, $3, 0, NOW())
             ON CONFLICT (agent_id, recipient)
             DO UPDATE SET
                total_earned_micro = agent_chat_earnings.total_earned_micro + EXCLUDED.total_earned_micro,
                updated_at = NOW()`,
            [row.agent_id, row.agent_recipient, fee.toString()]
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

        await client.query(
            `INSERT INTO agent_chat_earnings (agent_id, recipient, total_earned_micro, total_settled_micro, updated_at)
             VALUES ($1, $2, 0, $3, NOW())
             ON CONFLICT (agent_id, recipient)
             DO UPDATE SET
                total_settled_micro = LEAST(
                    agent_chat_earnings.total_earned_micro,
                    agent_chat_earnings.total_settled_micro + EXCLUDED.total_settled_micro
                ),
                updated_at = NOW()`,
            [row.agent_id, row.agent_recipient, unsettled.toString()]
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

export async function rollbackChatSessionSettlement(params: {
    sessionId: string;
    payer: string;
    settledMicroUsdc: string;
}): Promise<{ session: ChatSession; restoredMicroUsdc: string }> {
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

        const requestedRestore = BigInt(params.settledMicroUsdc || '0');
        const availableSettled = BigInt(row.total_settled_micro);
        const restore = requestedRestore <= availableSettled ? requestedRestore : availableSettled;

        await client.query(
            `UPDATE chat_sessions
             SET total_settled_micro = total_settled_micro - $2,
                 unsettled_micro = unsettled_micro + $2,
                 updated_at = NOW()
             WHERE id = $1`,
            [params.sessionId, restore.toString()]
        );

        await client.query(
            `INSERT INTO agent_chat_earnings (agent_id, recipient, total_earned_micro, total_settled_micro, updated_at)
             VALUES ($1, $2, 0, 0, NOW())
             ON CONFLICT (agent_id, recipient)
             DO UPDATE SET
                total_settled_micro = GREATEST(0, agent_chat_earnings.total_settled_micro - $3),
                updated_at = NOW()`,
            [row.agent_id, row.agent_recipient, restore.toString()]
        );

        const updatedResult = await client.query<SessionRow>(
            `SELECT * FROM chat_sessions WHERE id = $1 LIMIT 1`,
            [params.sessionId]
        );

        await client.query('COMMIT');

        return {
            session: toChatSession(updatedResult.rows[0]),
            restoredMicroUsdc: restore.toString(),
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function closeChatSession(params: {
    sessionId: string;
    payer: string;
}): Promise<ChatSession> {
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
        if (row.status !== 'open') {
            throw new Error('Session is not open');
        }
        if (BigInt(row.unsettled_micro) > BigInt(0)) {
            throw new Error('Session has unsettled usage. Settle before closing.');
        }

        const updatedResult = await client.query<SessionRow>(
            `UPDATE chat_sessions
             SET status = 'closed',
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [params.sessionId]
        );

        await client.query('COMMIT');
        return toChatSession(updatedResult.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
