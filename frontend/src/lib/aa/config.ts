export const AA_CHAIN_ID = 84532;

function parseBoolean(raw: string | undefined): boolean {
    const value = raw?.trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function isAAEnabled(): boolean {
    return parseBoolean(process.env.NEXT_PUBLIC_AA_ENABLED) || parseBoolean(process.env.AA_ENABLED);
}

export function getAAPaymasterProxyUrl(): string {
    const value = process.env.NEXT_PUBLIC_AA_PAYMASTER_URL?.trim();
    return value || '/api/aa/paymaster';
}

export function getAABundlerUrl(): string {
    const value = process.env.NEXT_PUBLIC_AA_BUNDLER_URL?.trim();
    return value || getAAPaymasterProxyUrl();
}

export function getPimlicoRpcUrl(): string | null {
    const value = process.env.PIMLICO_RPC_URL?.trim();
    return value || null;
}

export function getAAHealthSummary() {
    const enabled = isAAEnabled();
    return {
        enabled,
        chainId: AA_CHAIN_ID,
        paymasterProxyUrl: getAAPaymasterProxyUrl(),
        bundlerUrl: getAABundlerUrl(),
        pimlicoConfigured: !!getPimlicoRpcUrl(),
    };
}
