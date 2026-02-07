import {
    createGetAssetsMessageV2,
    createGetConfigMessageV2,
    createPingMessageV2,
    parseAnyRPCResponse,
    RPCMethod,
    type GetAssetsResponse,
    type GetConfigResponse,
    type PingResponse,
} from '@erc7824/nitrolite';
import { getYellowWsUrlOrDefault } from '@/lib/yellowConfig';

type RpcResponse = ReturnType<typeof parseAnyRPCResponse>;

export type YellowRailSnapshot = {
    enabled: boolean;
    wsUrl?: string;
    brokerAddress?: string;
    networks?: Array<{
        chainId: number;
        name: string;
        custodyAddress: string;
        adjudicatorAddress: string;
    }>;
    assets?: Array<{
        token: string;
        chainId: number;
        symbol: string;
        decimals: number;
    }>;
    lastCheckedAt: string;
    error?: string;
};

const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.YELLOW_RPC_TIMEOUT_MS ?? '5000'));
const CACHE_TTL_MS = Math.max(5000, Number(process.env.YELLOW_STATUS_CACHE_MS ?? '30000'));

let cachedSnapshot: YellowRailSnapshot | null = null;
let cachedAtMs = 0;

function getYellowWsUrl(): string | null {
    const raw = getYellowWsUrlOrDefault();
    if (!raw) return null;
    try {
        const url = new URL(raw);
        if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return null;
        return url.toString();
    } catch {
        return null;
    }
}

function parseRequestId(message: string): number {
    const parsed = JSON.parse(message) as { req?: [number, string, object, number?] };
    const reqId = parsed.req?.[0];
    if (typeof reqId !== 'number') {
        throw new Error('Yellow RPC requestId missing');
    }
    return reqId;
}

function openSocket(wsUrl: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        const onOpen = () => {
            cleanup();
            resolve(ws);
        };
        const onError = () => {
            cleanup();
            reject(new Error('Failed to connect to Yellow WS'));
        };
        const onTimeout = () => {
            cleanup();
            try {
                ws.close();
            } catch {
                // no-op
            }
            reject(new Error('Timeout connecting to Yellow WS'));
        };
        const timeout = setTimeout(onTimeout, REQUEST_TIMEOUT_MS);

        const cleanup = () => {
            clearTimeout(timeout);
            ws.removeEventListener('open', onOpen);
            ws.removeEventListener('error', onError);
        };

        ws.addEventListener('open', onOpen);
        ws.addEventListener('error', onError);
    });
}

function sendAndWait(ws: WebSocket, requestMessage: string): Promise<RpcResponse> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let requestId: number;
        try {
            requestId = parseRequestId(requestMessage);
        } catch (error) {
            reject(error);
            return;
        }

        const finish = (result: { ok: true; value: RpcResponse } | { ok: false; error: Error }) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            ws.removeEventListener('message', onMessage);
            ws.removeEventListener('error', onError);
            ws.removeEventListener('close', onClose);
            if (result.ok) resolve(result.value);
            else reject(result.error);
        };

        const onMessage = (event: MessageEvent) => {
            try {
                const raw = typeof event.data === 'string' ? event.data : String(event.data);
                const parsed = parseAnyRPCResponse(raw);
                if (parsed.requestId !== requestId) return;
                if (parsed.method === RPCMethod.Error) {
                    const errMsg = (parsed.params as { error?: string }).error ?? 'Yellow RPC error';
                    finish({ ok: false, error: new Error(errMsg) });
                    return;
                }
                finish({ ok: true, value: parsed });
            } catch {
                // Ignore non-RPC or unrelated frames.
            }
        };
        const onError = () => finish({ ok: false, error: new Error('Yellow WS error') });
        const onClose = () => finish({ ok: false, error: new Error('Yellow WS closed') });
        const timeout = setTimeout(() => finish({ ok: false, error: new Error('Yellow RPC request timeout') }), REQUEST_TIMEOUT_MS);

        ws.addEventListener('message', onMessage);
        ws.addEventListener('error', onError);
        ws.addEventListener('close', onClose);

        try {
            ws.send(requestMessage);
        } catch (error) {
            finish({ ok: false, error: error instanceof Error ? error : new Error('Failed to send Yellow RPC message') });
        }
    });
}

async function fetchYellowSnapshot(chainId: number): Promise<YellowRailSnapshot> {
    const wsUrl = getYellowWsUrl();
    const checkedAt = new Date().toISOString();
    if (!wsUrl) {
        return {
            enabled: false,
            error: 'YELLOW_WS_URL is missing or invalid',
            lastCheckedAt: checkedAt,
        };
    }

    const ws = await openSocket(wsUrl);
    try {
        const pingRaw = createPingMessageV2();
        const ping = await sendAndWait(ws, pingRaw) as PingResponse;
        if (ping.method !== RPCMethod.Ping && ping.method !== RPCMethod.Pong) {
            throw new Error(`Unexpected Yellow ping response: ${ping.method}`);
        }

        const configRaw = createGetConfigMessageV2();
        const config = await sendAndWait(ws, configRaw) as GetConfigResponse;
        if (config.method !== RPCMethod.GetConfig) {
            throw new Error(`Unexpected Yellow config response: ${config.method}`);
        }

        const assetsRaw = createGetAssetsMessageV2(chainId);
        const assets = await sendAndWait(ws, assetsRaw) as GetAssetsResponse;
        if (assets.method !== RPCMethod.GetAssets && assets.method !== RPCMethod.Assets) {
            throw new Error(`Unexpected Yellow assets response: ${assets.method}`);
        }

        return {
            enabled: true,
            wsUrl,
            brokerAddress: config.params.brokerAddress,
            networks: config.params.networks,
            assets: assets.params.assets,
            lastCheckedAt: checkedAt,
        };
    } finally {
        try {
            ws.close();
        } catch {
            // no-op
        }
    }
}

export async function getYellowRailSnapshot(chainId: number): Promise<YellowRailSnapshot> {
    const now = Date.now();
    if (cachedSnapshot && now - cachedAtMs < CACHE_TTL_MS) {
        return cachedSnapshot;
    }

    try {
        const snapshot = await fetchYellowSnapshot(chainId);
        cachedSnapshot = snapshot;
        cachedAtMs = now;
        return snapshot;
    } catch (error) {
        const snapshot: YellowRailSnapshot = {
            enabled: false,
            wsUrl: getYellowWsUrl() ?? undefined,
            error: error instanceof Error ? error.message : 'Failed to fetch Yellow snapshot',
            lastCheckedAt: new Date().toISOString(),
        };
        cachedSnapshot = snapshot;
        cachedAtMs = now;
        return snapshot;
    }
}
