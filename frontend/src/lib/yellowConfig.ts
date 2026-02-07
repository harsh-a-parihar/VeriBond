const DEFAULT_YELLOW_WS_URL = 'wss://clearnet-sandbox.yellow.com/ws';
const DEFAULT_YELLOW_CHAIN_ID = 11155111; // Ethereum Sepolia (Yellow sandbox quickstart)
const DEFAULT_YELLOW_ASSET = 'ytest.usd';

export function getYellowWsUrlOrDefault(): string {
    return process.env.YELLOW_WS_URL?.trim() || DEFAULT_YELLOW_WS_URL;
}

export function getYellowChainIdOrDefault(): number {
    const raw = process.env.YELLOW_CHAIN_ID?.trim();
    if (!raw) return DEFAULT_YELLOW_CHAIN_ID;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_YELLOW_CHAIN_ID;
    return parsed;
}

export function getYellowAssetOrDefault(): string {
    const raw = process.env.YELLOW_APP_ASSET?.trim() || DEFAULT_YELLOW_ASSET;
    // Keep token addresses as-is; normalize symbol-like assets.
    if (/^0x[0-9a-fA-F]{40}$/.test(raw)) return raw;
    return raw.toLowerCase();
}

