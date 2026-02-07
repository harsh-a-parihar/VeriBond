import {
    createAppSessionMessage,
    createAuthRequestMessage,
    createAuthVerifyMessageFromChallenge,
    createCloseAppSessionMessage,
    createECDSAMessageSigner,
    createSubmitAppStateMessage,
    parseAnyRPCResponse,
    RPCAppStateIntent,
    RPCMethod,
    RPCProtocolVersion,
    type CreateAppSessionResponse,
    type SubmitAppStateResponse,
} from '@erc7824/nitrolite';
import { isAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

type RpcResponse = ReturnType<typeof parseAnyRPCResponse>;

export type YellowSessionInitResult = {
    enabled: boolean;
    created: boolean;
    appSessionId?: Hex;
    protocol?: RPCProtocolVersion;
    asset?: string;
    version?: number;
    status?: string;
    operatorAddress?: Address;
    error?: string;
};

export type YellowSettlementResult = {
    enabled: boolean;
    ok: boolean;
    appSessionId?: Hex;
    version?: number;
    status?: string;
    error?: string;
};

const DEFAULT_YELLOW_WS_URL = 'wss://clearnet.yellow.com/ws';
const DEFAULT_APPLICATION = 'veribond-agent-chat';
const DEFAULT_SCOPE = 'veribond:chat';
const DEFAULT_ASSET = 'USDC';
const REQUEST_TIMEOUT_MS = Math.max(1200, Number(process.env.YELLOW_RPC_TIMEOUT_MS ?? '6000'));
const DEFAULT_CHALLENGE_SECONDS = Math.max(60, Number(process.env.YELLOW_APP_CHALLENGE_SECONDS ?? '3600'));

function getYellowWsUrl(): string | null {
    const raw = process.env.YELLOW_WS_URL?.trim() || DEFAULT_YELLOW_WS_URL;
    if (!raw) return null;
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

function normalizePrivateKey(raw: string | undefined): Hex | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const withPrefix = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) return null;
    return withPrefix as Hex;
}

function getOperatorKey(): Hex | null {
    return normalizePrivateKey(process.env.YELLOW_OPERATOR_PRIVATE_KEY);
}

function extractRequestId(rawMessage: string): number {
    const parsed = JSON.parse(rawMessage) as { req?: [number, string, unknown, number?] };
    const reqId = parsed.req?.[0];
    if (typeof reqId !== 'number') {
        throw new Error('Yellow request missing requestId');
    }
    return reqId;
}

async function openSocket(wsUrl: string): Promise<WebSocket> {
    return await new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => {
            cleanup();
            try {
                ws.close();
            } catch {
                // no-op
            }
            reject(new Error('Yellow WS connect timeout'));
        }, REQUEST_TIMEOUT_MS);

        const cleanup = () => {
            clearTimeout(timeout);
            ws.removeEventListener('open', onOpen);
            ws.removeEventListener('error', onError);
        };

        const onOpen = () => {
            cleanup();
            resolve(ws);
        };
        const onError = () => {
            cleanup();
            reject(new Error('Yellow WS connection error'));
        };

        ws.addEventListener('open', onOpen);
        ws.addEventListener('error', onError);
    });
}

async function sendRpc(ws: WebSocket, requestMessage: string): Promise<RpcResponse> {
    const requestId = extractRequestId(requestMessage);

    return await new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
            finishError(new Error('Yellow RPC timeout'));
        }, REQUEST_TIMEOUT_MS);

        const finishError = (error: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            ws.removeEventListener('message', onMessage);
            ws.removeEventListener('error', onError);
            ws.removeEventListener('close', onClose);
            reject(error);
        };
        const finishOk = (response: RpcResponse) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            ws.removeEventListener('message', onMessage);
            ws.removeEventListener('error', onError);
            ws.removeEventListener('close', onClose);
            resolve(response);
        };

        const onMessage = (event: MessageEvent) => {
            try {
                const raw = typeof event.data === 'string' ? event.data : String(event.data);
                const parsed = parseAnyRPCResponse(raw);
                if (parsed.requestId !== requestId) return;
                if (parsed.method === RPCMethod.Error) {
                    const err = (parsed.params as { error?: string }).error ?? 'Yellow RPC error';
                    finishError(new Error(err));
                    return;
                }
                finishOk(parsed);
            } catch {
                // ignore unrelated frames
            }
        };
        const onError = () => finishError(new Error('Yellow WS error'));
        const onClose = () => finishError(new Error('Yellow WS closed'));

        ws.addEventListener('message', onMessage);
        ws.addEventListener('error', onError);
        ws.addEventListener('close', onClose);

        try {
            ws.send(requestMessage);
        } catch (error) {
            finishError(error instanceof Error ? error : new Error('Failed to send Yellow RPC message'));
        }
    });
}

async function authenticate(ws: WebSocket, operatorPrivateKey: Hex, application: string, scope: string, asset: string): Promise<{
    operatorAddress: Address;
}> {
    const account = privateKeyToAccount(operatorPrivateKey);
    const signer = createECDSAMessageSigner(operatorPrivateKey);

    const authRequest = await createAuthRequestMessage({
        address: account.address,
        session_key: account.address,
        application,
        allowances: [{ asset, amount: `${2 ** 31}` }],
        expires_at: BigInt(Date.now() + (2 * 60 * 60 * 1000)),
        scope,
    });
    const authChallenge = await sendRpc(ws, authRequest);
    if (authChallenge.method !== RPCMethod.AuthRequest && authChallenge.method !== RPCMethod.AuthChallenge) {
        throw new Error(`Unexpected auth challenge method: ${authChallenge.method}`);
    }

    const challengeMessage = (
        authChallenge.params as { challengeMessage?: string; challenge_message?: string }
    ).challengeMessage
        ?? (authChallenge.params as { challenge_message?: string }).challenge_message;
    if (!challengeMessage) {
        throw new Error('Yellow auth challenge missing challenge message');
    }

    const authVerify = await createAuthVerifyMessageFromChallenge(signer, challengeMessage);
    const authVerified = await sendRpc(ws, authVerify);
    if (authVerified.method !== RPCMethod.AuthVerify) {
        throw new Error(`Unexpected auth verify method: ${authVerified.method}`);
    }
    const success = Boolean((authVerified.params as { success?: boolean }).success);
    if (!success) {
        throw new Error('Yellow auth verify failed');
    }

    return { operatorAddress: account.address };
}

function getAssetName(): string {
    return process.env.YELLOW_APP_ASSET?.trim() || DEFAULT_ASSET;
}

function getApplicationName(): string {
    return process.env.YELLOW_APPLICATION?.trim() || DEFAULT_APPLICATION;
}

function getScope(sessionId: string): string {
    const scopePrefix = process.env.YELLOW_AUTH_SCOPE?.trim() || DEFAULT_SCOPE;
    return `${scopePrefix}:${sessionId}`;
}

export function isYellowSettlementEnabled(): boolean {
    return !!getYellowWsUrl() && !!getOperatorKey();
}

export async function initializeYellowAppSession(params: {
    sessionId: string;
    payer: Address;
    agentRecipient: Address;
    existingAppSessionId?: string | null;
}): Promise<YellowSessionInitResult> {
    const wsUrl = getYellowWsUrl();
    const operatorPrivateKey = getOperatorKey();
    if (!wsUrl || !operatorPrivateKey) {
        return { enabled: false, created: false, error: 'Yellow settlement not configured (missing WS URL or operator key)' };
    }
    if (!isAddress(params.agentRecipient)) {
        return { enabled: true, created: false, error: 'Invalid agent recipient address for Yellow session' };
    }

    if (params.existingAppSessionId) {
        return {
            enabled: true,
            created: false,
            appSessionId: params.existingAppSessionId as Hex,
            protocol: RPCProtocolVersion.NitroRPC_0_4,
            asset: getAssetName(),
            status: 'open',
            version: 0,
        };
    }

    const ws = await openSocket(wsUrl);
    try {
        const application = getApplicationName();
        const asset = getAssetName();
        const scope = getScope(params.sessionId);
        const { operatorAddress } = await authenticate(ws, operatorPrivateKey, application, scope, asset);
        const signer = createECDSAMessageSigner(operatorPrivateKey);

        const createMessage = await createAppSessionMessage(signer, {
            definition: {
                application,
                protocol: RPCProtocolVersion.NitroRPC_0_4,
                participants: [operatorAddress, params.agentRecipient],
                weights: [1, 1],
                quorum: 2,
                challenge: DEFAULT_CHALLENGE_SECONDS,
                nonce: Date.now(),
            },
            allocations: [
                { participant: operatorAddress, asset, amount: '0' },
                { participant: params.agentRecipient, asset, amount: '0' },
            ],
            session_data: JSON.stringify({
                sessionId: params.sessionId,
                payer: params.payer,
                recipient: params.agentRecipient,
            }),
        });

        const created = await sendRpc(ws, createMessage) as CreateAppSessionResponse;
        if (created.method !== RPCMethod.CreateAppSession) {
            return {
                enabled: true,
                created: false,
                error: `Unexpected create app session response: ${created.method}`,
            };
        }

        return {
            enabled: true,
            created: true,
            appSessionId: created.params.appSessionId,
            protocol: RPCProtocolVersion.NitroRPC_0_4,
            asset,
            version: created.params.version,
            status: created.params.status,
            operatorAddress,
        };
    } catch (error) {
        return {
            enabled: true,
            created: false,
            error: error instanceof Error ? error.message : 'Failed to create Yellow app session',
        };
    } finally {
        try {
            ws.close();
        } catch {
            // no-op
        }
    }
}

export async function submitYellowUsage(params: {
    sessionId: string;
    appSessionId: Hex;
    currentVersion: number;
    agentRecipient: Address;
    settledMicroUsdc: string;
    asset?: string | null;
}): Promise<YellowSettlementResult> {
    const wsUrl = getYellowWsUrl();
    const operatorPrivateKey = getOperatorKey();
    if (!wsUrl || !operatorPrivateKey) {
        return { enabled: false, ok: false, error: 'Yellow settlement not configured (missing WS URL or operator key)' };
    }

    const ws = await openSocket(wsUrl);
    try {
        const application = getApplicationName();
        const asset = params.asset?.trim() || getAssetName();
        const scope = getScope(params.sessionId);
        const { operatorAddress } = await authenticate(ws, operatorPrivateKey, application, scope, asset);
        const signer = createECDSAMessageSigner(operatorPrivateKey);

        const amount = BigInt(params.settledMicroUsdc || '0');
        if (amount <= BigInt(0)) {
            return { enabled: true, ok: true, appSessionId: params.appSessionId, version: params.currentVersion, status: 'noop' };
        }

        const message = await createSubmitAppStateMessage(signer, {
            app_session_id: params.appSessionId,
            intent: RPCAppStateIntent.Operate,
            version: params.currentVersion + 1,
            allocations: [
                { participant: operatorAddress, asset, amount: '0' },
                { participant: params.agentRecipient, asset, amount: amount.toString() },
            ],
            session_data: JSON.stringify({
                sessionId: params.sessionId,
                settledMicroUsdc: amount.toString(),
                submittedAt: Date.now(),
            }),
        });

        const response = await sendRpc(ws, message) as SubmitAppStateResponse;
        if (response.method !== RPCMethod.SubmitAppState) {
            return { enabled: true, ok: false, error: `Unexpected submit response: ${response.method}` };
        }

        return {
            enabled: true,
            ok: true,
            appSessionId: response.params.appSessionId,
            version: response.params.version,
            status: response.params.status,
        };
    } catch (error) {
        return {
            enabled: true,
            ok: false,
            error: error instanceof Error ? error.message : 'Failed to submit Yellow usage',
        };
    } finally {
        try {
            ws.close();
        } catch {
            // no-op
        }
    }
}

export async function closeYellowAppSession(params: {
    sessionId: string;
    appSessionId: Hex;
    currentVersion: number;
    agentRecipient: Address;
    asset?: string | null;
}): Promise<YellowSettlementResult> {
    const wsUrl = getYellowWsUrl();
    const operatorPrivateKey = getOperatorKey();
    if (!wsUrl || !operatorPrivateKey) {
        return { enabled: false, ok: false, error: 'Yellow settlement not configured (missing WS URL or operator key)' };
    }

    const ws = await openSocket(wsUrl);
    try {
        const application = getApplicationName();
        const asset = params.asset?.trim() || getAssetName();
        const scope = getScope(params.sessionId);
        const { operatorAddress } = await authenticate(ws, operatorPrivateKey, application, scope, asset);
        const signer = createECDSAMessageSigner(operatorPrivateKey);

        const message = await createCloseAppSessionMessage(signer, {
            app_session_id: params.appSessionId,
            allocations: [
                { participant: operatorAddress, asset, amount: '0' },
                { participant: params.agentRecipient, asset, amount: '0' },
            ],
            session_data: JSON.stringify({
                sessionId: params.sessionId,
                closedAt: Date.now(),
            }),
        });

        const response = await sendRpc(ws, message);
        if (response.method !== RPCMethod.CloseAppSession) {
            return { enabled: true, ok: false, error: `Unexpected close response: ${response.method}` };
        }

        return {
            enabled: true,
            ok: true,
            appSessionId: params.appSessionId,
            version: (response.params as { version?: number }).version ?? params.currentVersion,
            status: (response.params as { status?: string }).status ?? 'closed',
        };
    } catch (error) {
        return {
            enabled: true,
            ok: false,
            error: error instanceof Error ? error.message : 'Failed to close Yellow app session',
        };
    } finally {
        try {
            ws.close();
        } catch {
            // no-op
        }
    }
}
