import {
    createAppSessionMessage,
    createAuthRequestMessage,
    createAuthVerifyMessageFromChallenge,
    createCloseAppSessionMessage,
    createECDSAMessageSigner,
    createEIP712AuthMessageSigner,
    createGetAssetsMessageV2,
    createSubmitAppStateMessage,
    parseAnyRPCResponse,
    RPCAppStateIntent,
    RPCMethod,
    RPCProtocolVersion,
    type CreateAppSessionResponse,
    type SubmitAppStateResponse,
} from '@erc7824/nitrolite';
import { createWalletClient, http, isAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getYellowAssetOrDefault, getYellowChainIdOrDefault, getYellowWsUrlOrDefault } from '@/lib/yellowConfig';

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

const DEFAULT_APPLICATION = 'veribond-agent-chat';
const DEFAULT_SCOPE = 'veribond:chat';
const REQUEST_TIMEOUT_MS = Math.max(1200, Number(process.env.YELLOW_RPC_TIMEOUT_MS ?? '6000'));
const DEFAULT_CHALLENGE_SECONDS = Math.max(60, Number(process.env.YELLOW_APP_CHALLENGE_SECONDS ?? '3600'));
const DEFAULT_APP_QUORUM = Math.max(1, Math.min(2, Number(process.env.YELLOW_APP_QUORUM ?? '1')));
const ASSET_DISCOVERY_LIMIT = Math.max(1, Number(process.env.YELLOW_ASSET_DISCOVERY_LIMIT ?? '120'));
const YELLOW_DEBUG = process.env.YELLOW_DEBUG === '1';

function logYellow(message: string, details?: unknown): void {
    if (!YELLOW_DEBUG) return;
    if (details === undefined) {
        console.log(`[YellowSession] ${message}`);
        return;
    }
    console.log(`[YellowSession] ${message}`, details);
}

function getYellowWsUrl(): string | null {
    const raw = getYellowWsUrlOrDefault();
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

function isUnsupportedTokenError(error: unknown): boolean {
    return error instanceof Error && error.message.toLowerCase().includes('unsupported token');
}

function extractAssetCandidates(response: RpcResponse): string[] {
    if (response.method !== RPCMethod.GetAssets && response.method !== RPCMethod.Assets) {
        return [];
    }

    return Array.from(
        new Set(
            (
                (response.params as { assets?: Array<{ token?: string; symbol?: string }> }).assets
                    ?.flatMap((entry) => {
                        const out: string[] = [];
                        if (entry.token) out.push(entry.token);
                        if (entry.symbol) {
                            out.push(entry.symbol);
                            out.push(entry.symbol.toLowerCase());
                            out.push(entry.symbol.toUpperCase());
                        }
                        return out;
                    }) ?? []
            )
                .filter((value) => !!value)
                .slice(0, ASSET_DISCOVERY_LIMIT),
        ),
    );
}

async function fetchChainAssetsResponse(ws: WebSocket): Promise<RpcResponse> {
    return await sendRpc(ws, createGetAssetsMessageV2(getYellowChainIdOrDefault()));
}

function isHexAddress(value: string): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

async function resolveSettlementAsset(ws: WebSocket, authAsset: string): Promise<string> {
    if (isHexAddress(authAsset)) return authAsset;

    const response = await fetchChainAssetsResponse(ws);
    if (response.method !== RPCMethod.GetAssets && response.method !== RPCMethod.Assets) {
        return authAsset;
    }

    const normalized = authAsset.trim().toLowerCase();
    const assets = (response.params as { assets?: Array<{ token?: string; symbol?: string }> }).assets ?? [];
    const match = assets.find((entry) => (entry.symbol ?? '').trim().toLowerCase() === normalized);
    if (match?.token && isHexAddress(match.token)) {
        return match.token;
    }

    return authAsset;
}

async function authenticate(ws: WebSocket, operatorPrivateKey: Hex, application: string, scope: string, asset: string): Promise<{
    operatorAddress: Address;
    authAsset: string;
    settlementAsset: string;
}> {
    const account = privateKeyToAccount(operatorPrivateKey);
    const signerRpcUrl = process.env.YELLOW_SIGNER_RPC_URL?.trim() || process.env.NEXT_PUBLIC_RPC_URL?.trim() || 'https://sepolia.base.org';
    const walletClient = createWalletClient({
        account,
        transport: http(signerRpcUrl),
    });
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + (2 * 60 * 60));
    const allowanceAmount = `${2 ** 31}`;

    const requestAuthChallenge = async (candidateAsset: string): Promise<RpcResponse> => {
        const authRequest = await createAuthRequestMessage({
            address: account.address,
            session_key: account.address,
            application,
            allowances: [{ asset: candidateAsset, amount: allowanceAmount }],
            expires_at: expiresAt,
            scope,
        });
        return await sendRpc(ws, authRequest);
    };

    const domainName = process.env.YELLOW_EIP712_DOMAIN_NAME?.trim() || application;
    const runFullAuth = async (candidateAsset: string): Promise<void> => {
        const allowances = [{ asset: candidateAsset, amount: allowanceAmount }];
        const authChallenge = await requestAuthChallenge(candidateAsset);
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

        const authSigner = createEIP712AuthMessageSigner(
            walletClient,
            {
                scope,
                session_key: account.address,
                expires_at: expiresAt,
                allowances,
            },
            { name: domainName },
        );
        const authVerify = await createAuthVerifyMessageFromChallenge(authSigner, challengeMessage);
        const authVerified = await sendRpc(ws, authVerify);
        if (authVerified.method !== RPCMethod.AuthVerify) {
            throw new Error(`Unexpected auth verify method: ${authVerified.method}`);
        }
        const success = Boolean((authVerified.params as { success?: boolean }).success);
        if (!success) {
            throw new Error('Yellow auth verify failed');
        }
    };

    let selectedAsset = asset;
    try {
        await runFullAuth(selectedAsset);
        return {
            operatorAddress: account.address,
            authAsset: selectedAsset,
            settlementAsset: await resolveSettlementAsset(ws, selectedAsset),
        };
    } catch (error) {
        if (!isUnsupportedTokenError(error)) throw error;
        logYellow('Configured asset unsupported, starting discovery', { configuredAsset: selectedAsset });

        const assetsResponse = await fetchChainAssetsResponse(ws);
        const discoveredAssets = extractAssetCandidates(assetsResponse);
        logYellow('Candidate assets loaded for discovery', { count: discoveredAssets.length });

        for (const candidate of discoveredAssets) {
            try {
                await runFullAuth(candidate);
                selectedAsset = candidate;
                logYellow('Discovered supported asset', { selectedAsset });
                return {
                    operatorAddress: account.address,
                    authAsset: selectedAsset,
                    settlementAsset: await resolveSettlementAsset(ws, selectedAsset),
                };
            } catch (candidateError) {
                if (!isUnsupportedTokenError(candidateError)) throw candidateError;
            }
        }

        throw new Error(
            `Yellow operator has no supported auth asset (configured=${asset}, tested=${discoveredAssets.length}). `
            + 'Create/fund a Yellow channel and set YELLOW_APP_ASSET to a supported token address.',
        );
    }
}

function getAssetName(): string {
    return getYellowAssetOrDefault();
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
        let {
            operatorAddress,
            authAsset: resolvedAuthAsset,
            settlementAsset: resolvedSettlementAsset,
        } = await authenticate(ws, operatorPrivateKey, application, scope, asset);
        const signer = createECDSAMessageSigner(operatorPrivateKey);

        const createWithAsset = async (assetForSession: string): Promise<CreateAppSessionResponse> => {
            const createMessage = await createAppSessionMessage(signer, {
                definition: {
                    application,
                    protocol: RPCProtocolVersion.NitroRPC_0_4,
                    participants: [operatorAddress, params.agentRecipient],
                    weights: [1, 1],
                    quorum: DEFAULT_APP_QUORUM,
                    challenge: DEFAULT_CHALLENGE_SECONDS,
                    nonce: Date.now(),
                },
                allocations: [
                    { participant: operatorAddress, asset: assetForSession, amount: '0' },
                    { participant: params.agentRecipient, asset: assetForSession, amount: '0' },
                ],
                session_data: JSON.stringify({
                    sessionId: params.sessionId,
                    payer: params.payer,
                    recipient: params.agentRecipient,
                }),
            });
            return await sendRpc(ws, createMessage) as CreateAppSessionResponse;
        };

        let created: CreateAppSessionResponse;
        try {
            created = await createWithAsset(resolvedSettlementAsset);
        } catch (error) {
            if (!isUnsupportedTokenError(error)) throw error;
            logYellow('Create app session failed for asset, retrying discovery', { asset: resolvedSettlementAsset });

            const assetsResponse = await fetchChainAssetsResponse(ws);
            const candidateAssets = extractAssetCandidates(assetsResponse)
                .filter((candidate) => candidate !== resolvedAuthAsset);
            logYellow('Create app session fallback candidates', { count: candidateAssets.length });

            let createdFallback: CreateAppSessionResponse | null = null;
            for (const candidate of candidateAssets) {
                try {
                    const authResult = await authenticate(ws, operatorPrivateKey, application, scope, candidate);
                    operatorAddress = authResult.operatorAddress;
                    resolvedAuthAsset = authResult.authAsset;
                    resolvedSettlementAsset = authResult.settlementAsset;
                    createdFallback = await createWithAsset(resolvedSettlementAsset);
                    logYellow('Create app session fallback selected asset', {
                        authAsset: resolvedAuthAsset,
                        settlementAsset: resolvedSettlementAsset,
                    });
                    break;
                } catch (candidateError) {
                    if (!isUnsupportedTokenError(candidateError)) throw candidateError;
                }
            }

            if (!createdFallback) {
                throw new Error(
                    `Yellow app session creation failed for all candidate assets (configured=${asset}, tested=${candidateAssets.length}). `
                    + 'Verify channel balances/asset support for YELLOW_OPERATOR_PRIVATE_KEY.',
                );
            }
            created = createdFallback;
        }

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
            asset: resolvedAuthAsset,
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
    totalSettledMicroUsdc?: string;
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
        const { operatorAddress, settlementAsset } = await authenticate(ws, operatorPrivateKey, application, scope, asset);
        const signer = createECDSAMessageSigner(operatorPrivateKey);

        const settledDelta = BigInt(params.settledMicroUsdc || '0');
        if (settledDelta <= BigInt(0)) {
            return { enabled: true, ok: true, appSessionId: params.appSessionId, version: params.currentVersion, status: 'noop' };
        }

        const totalSettled = BigInt(params.totalSettledMicroUsdc ?? params.settledMicroUsdc ?? '0');
        const previousRecipient = totalSettled > settledDelta ? (totalSettled - settledDelta) : BigInt(0);

        // Step 1: move newly-settled amount into app balances.
        const depositMessage = await createSubmitAppStateMessage(signer, {
            app_session_id: params.appSessionId,
            intent: RPCAppStateIntent.Deposit,
            version: params.currentVersion + 1,
            allocations: [
                { participant: operatorAddress, asset: settlementAsset, amount: settledDelta.toString() },
                { participant: params.agentRecipient, asset: settlementAsset, amount: previousRecipient.toString() },
            ],
            session_data: JSON.stringify({
                sessionId: params.sessionId,
                settledMicroUsdc: settledDelta.toString(),
                totalSettledMicroUsdc: totalSettled.toString(),
                stage: 'deposit',
                submittedAt: Date.now(),
            }),
        });

        const depositResponse = await sendRpc(ws, depositMessage) as SubmitAppStateResponse;
        if (depositResponse.method !== RPCMethod.SubmitAppState) {
            return { enabled: true, ok: false, error: `Unexpected deposit response: ${depositResponse.method}` };
        }

        // Step 2: attribute deposited amount to recipient.
        const operateMessage = await createSubmitAppStateMessage(signer, {
            app_session_id: params.appSessionId,
            intent: RPCAppStateIntent.Operate,
            version: depositResponse.params.version + 1,
            allocations: [
                { participant: operatorAddress, asset: settlementAsset, amount: '0' },
                { participant: params.agentRecipient, asset: settlementAsset, amount: totalSettled.toString() },
            ],
            session_data: JSON.stringify({
                sessionId: params.sessionId,
                settledMicroUsdc: settledDelta.toString(),
                totalSettledMicroUsdc: totalSettled.toString(),
                stage: 'operate',
                submittedAt: Date.now(),
            }),
        });

        const response = await sendRpc(ws, operateMessage) as SubmitAppStateResponse;
        if (response.method !== RPCMethod.SubmitAppState) {
            return { enabled: true, ok: false, error: `Unexpected operate response: ${response.method}` };
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
        const { operatorAddress, settlementAsset } = await authenticate(ws, operatorPrivateKey, application, scope, asset);
        const signer = createECDSAMessageSigner(operatorPrivateKey);

        const message = await createCloseAppSessionMessage(signer, {
            app_session_id: params.appSessionId,
            allocations: [
                { participant: operatorAddress, asset: settlementAsset, amount: '0' },
                { participant: params.agentRecipient, asset: settlementAsset, amount: '0' },
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
