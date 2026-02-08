export type WalletCapabilityView = {
    paymasterSupported: boolean;
    atomicStatus: 'supported' | 'ready' | 'unsupported' | 'unknown';
};

type MaybeChainCapabilities = {
    paymasterService?: { supported?: boolean };
    atomic?: { status?: 'supported' | 'ready' | 'unsupported' };
};

function readChainCapabilities(data: unknown, chainId: number): MaybeChainCapabilities | null {
    if (!data || typeof data !== 'object') return null;

    const asRecord = data as Record<string, unknown>;
    const direct = asRecord as MaybeChainCapabilities;

    if (direct.paymasterService || direct.atomic) {
        return direct;
    }

    const hexChainId = `0x${chainId.toString(16)}`;
    const byNumeric = asRecord[String(chainId)] as unknown;
    const byHex = asRecord[hexChainId] as unknown;

    if (byNumeric && typeof byNumeric === 'object') {
        return byNumeric as MaybeChainCapabilities;
    }
    if (byHex && typeof byHex === 'object') {
        return byHex as MaybeChainCapabilities;
    }

    return null;
}

export function parseWalletCapabilities(data: unknown, chainId: number): WalletCapabilityView {
    const caps = readChainCapabilities(data, chainId);

    return {
        paymasterSupported: Boolean(caps?.paymasterService?.supported),
        atomicStatus: caps?.atomic?.status ?? 'unknown',
    };
}

export function getExecutionModeLabel(params: {
    aaEnabled: boolean;
    paymasterSupported: boolean;
    chainId?: number;
    targetChainId: number;
}): { mode: 'aa' | 'standard'; label: string; warning?: string } {
    const { aaEnabled, paymasterSupported, chainId, targetChainId } = params;

    if (!aaEnabled) {
        return { mode: 'standard', label: 'Standard Wallet Fallback', warning: 'AA disabled by config.' };
    }

    if (chainId !== targetChainId) {
        return {
            mode: 'standard',
            label: 'Standard Wallet Fallback',
            warning: `Switch to Base Sepolia (${targetChainId}) for gasless mode.`,
        };
    }

    if (!paymasterSupported) {
        return {
            mode: 'standard',
            label: 'Standard Wallet Fallback',
            warning: 'Wallet does not expose paymaster capability on this chain; using standard tx.',
        };
    }

    return { mode: 'aa', label: 'Gasless Smart Wallet' };
}
