'use client';

import { useCallback, useMemo, useState } from 'react';
import type { Abi, Address, Hex } from 'viem';
import { encodeFunctionData } from 'viem';
import {
    useAccount,
    useCallsStatus,
    useCapabilities,
    useChainId,
    useSendCalls,
    useWaitForTransactionReceipt,
    useWriteContract,
} from 'wagmi';
import { parseWalletCapabilities, getExecutionModeLabel } from '@/lib/aa/capabilities';
import { AA_CHAIN_ID, getAAPaymasterProxyUrl, isAAEnabled } from '@/lib/aa/config';

export type AdaptiveWriteParams = {
    address: `0x${string}`;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
};

export type AdaptiveWriteMode = 'aa' | 'standard';

export type UseAdaptiveWriteOptions = {
    allowAA?: boolean;
    fallbackToStandard?: boolean;
};

const CALLS_STATUS_SUCCESS = new Set([2, 200, 201]);

function toError(value: unknown, fallback: string): Error {
    if (value instanceof Error) return value;
    if (typeof value === 'string') return new Error(value);
    return new Error(fallback);
}

function isReceiptSuccess(status: unknown): boolean {
    return status === 1 || status === '0x1' || status === '0x01';
}

function isReceiptFailure(status: unknown): boolean {
    return status === 0 || status === '0x0' || status === '0x00';
}

export function useAdaptiveWrite(options: UseAdaptiveWriteOptions = {}) {
    const { allowAA = true, fallbackToStandard = true } = options;

    const aaEnabled = isAAEnabled();
    const paymasterUrl = getAAPaymasterProxyUrl();

    const { address } = useAccount();
    const chainId = useChainId();

    const [submittedMode, setSubmittedMode] = useState<AdaptiveWriteMode | null>(null);
    const [callsId, setCallsId] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<Hex | null>(null);
    const [operationError, setOperationError] = useState<Error | null>(null);
    const [operationWarning, setOperationWarning] = useState<string | null>(null);

    const capabilitiesQuery = useCapabilities({
        account: address,
        chainId: AA_CHAIN_ID,
        query: {
            enabled: !!address && aaEnabled && allowAA,
            staleTime: 30_000,
        },
    });

    const walletCaps = useMemo(
        () => parseWalletCapabilities(capabilitiesQuery.data, AA_CHAIN_ID),
        [capabilitiesQuery.data]
    );

    const execution = useMemo(
        () => getExecutionModeLabel({
            aaEnabled: aaEnabled && allowAA,
            paymasterSupported: walletCaps.paymasterSupported,
            chainId,
            targetChainId: AA_CHAIN_ID,
        }),
        [aaEnabled, allowAA, walletCaps.paymasterSupported, chainId]
    );

    const canUseAA = execution.mode === 'aa';

    const {
        sendCallsAsync,
        isPending: isAaSubmitting,
        error: aaSendError,
    } = useSendCalls();

    const {
        writeContractAsync,
        isPending: isStandardSubmitting,
        error: standardWriteError,
    } = useWriteContract();

    const callsStatusQuery = useCallsStatus({
        id: callsId ?? '',
        query: {
            enabled: !!callsId,
            refetchInterval: (query) => {
                const data = query.state.data as {
                    status?: number;
                    receipts?: Array<{ status?: unknown }>;
                } | undefined;

                const status = data?.status;
                const receipts = data?.receipts ?? [];
                const done = (typeof status === 'number' && (status >= 400 || CALLS_STATUS_SUCCESS.has(status)))
                    || receipts.some((receipt) => isReceiptFailure(receipt.status))
                    || (receipts.length > 0 && receipts.every((receipt) => isReceiptSuccess(receipt.status)));
                return done ? false : 1_200;
            },
        },
    });

    const aaStatusData = callsStatusQuery.data as {
        status?: number;
        receipts?: Array<{ status?: unknown; transactionHash?: Hex }>;
    } | undefined;

    const aaStatusCode = aaStatusData?.status;
    const aaReceipts = useMemo(() => aaStatusData?.receipts ?? [], [aaStatusData?.receipts]);
    const aaReceiptTxHash = useMemo(
        () => aaReceipts.find((receipt) => !!receipt.transactionHash)?.transactionHash ?? null,
        [aaReceipts]
    );

    const hasAaReceiptFailure = aaReceipts.some((receipt) => isReceiptFailure(receipt.status));
    const hasAaReceiptSuccess = aaReceipts.length > 0 && aaReceipts.every((receipt) => isReceiptSuccess(receipt.status));
    const isAaFailed = submittedMode === 'aa' && ((typeof aaStatusCode === 'number' && aaStatusCode >= 400) || hasAaReceiptFailure);
    const isAaConfirmed = submittedMode === 'aa' && (CALLS_STATUS_SUCCESS.has(aaStatusCode ?? -1) || hasAaReceiptSuccess);
    const isAaConfirming = submittedMode === 'aa' && !!callsId && !isAaFailed && !isAaConfirmed;

    const {
        isLoading: isStandardConfirming,
        isSuccess: isStandardConfirmed,
        error: standardReceiptError,
    } = useWaitForTransactionReceipt({
        hash: submittedMode === 'standard' ? (txHash ?? undefined) : undefined,
        query: {
            enabled: submittedMode === 'standard' && !!txHash,
        },
    });

    const derivedError = useMemo(() => {
        if (operationError) return operationError;
        if (aaSendError) return toError(aaSendError, 'Failed to submit gasless call');
        if (isAaFailed) return new Error(`Gasless calls failed (status ${aaStatusCode ?? 'unknown'})`);
        if (standardWriteError) return toError(standardWriteError, 'Failed to submit transaction');
        if (standardReceiptError) return toError(standardReceiptError, 'Transaction reverted');
        return null;
    }, [operationError, aaSendError, isAaFailed, aaStatusCode, standardWriteError, standardReceiptError]);

    const resetState = useCallback(() => {
        setOperationError(null);
        setOperationWarning(null);
        setCallsId(null);
        setTxHash(null);
        setSubmittedMode(null);
    }, []);

    const sendStandard = useCallback(async (params: AdaptiveWriteParams) => {
        const hash = await writeContractAsync({
            address: params.address,
            abi: params.abi,
            functionName: params.functionName as never,
            args: (params.args ?? []) as never,
            value: params.value,
        });
        setSubmittedMode('standard');
        setTxHash(hash);
        return hash;
    }, [writeContractAsync]);

    const sendContract = useCallback(async (params: AdaptiveWriteParams) => {
        setOperationError(null);
        setOperationWarning(null);
        setCallsId(null);
        setTxHash(null);

        if (!address) {
            throw new Error('Connect wallet before sending transaction');
        }

        if (canUseAA) {
            try {
                const data = encodeFunctionData({
                    abi: params.abi,
                    functionName: params.functionName as never,
                    args: (params.args ?? []) as never,
                });

                const result = await sendCallsAsync({
                    account: address,
                    chainId: AA_CHAIN_ID,
                    capabilities: {
                        paymasterService: {
                            url: paymasterUrl,
                        },
                    },
                    calls: [
                        {
                            to: params.address as Address,
                            data,
                            value: params.value,
                        },
                    ],
                });

                setSubmittedMode('aa');
                setCallsId(result.id);
                return result.id;
            } catch (error) {
                if (!fallbackToStandard) {
                    setOperationError(toError(error, 'Gasless execution failed'));
                    throw error;
                }

                setOperationWarning('Gasless execution failed. Falling back to standard transaction.');
                return await sendStandard(params);
            }
        }

        return await sendStandard(params);
    }, [address, canUseAA, fallbackToStandard, paymasterUrl, sendCallsAsync, sendStandard]);

    const writeContract = useCallback((params: AdaptiveWriteParams) => {
        void sendContract(params);
    }, [sendContract]);

    const currentMode: AdaptiveWriteMode = submittedMode ?? execution.mode;
    const currentWarning = operationWarning ?? execution.warning ?? null;
    const effectiveTxHash = txHash ?? aaReceiptTxHash;

    return {
        writeContract,
        writeContractAsync: sendContract,
        reset: resetState,

        mode: currentMode,
        modeLabel: execution.label,
        canUseAA,
        walletSupportsPaymaster: walletCaps.paymasterSupported,
        warning: currentWarning,

        txHash: effectiveTxHash,
        callsId,
        data: effectiveTxHash ?? callsId,

        isPending: isAaSubmitting || isStandardSubmitting,
        isConfirming: isAaConfirming || isStandardConfirming,
        isConfirmed: isAaConfirmed || isStandardConfirmed,
        error: derivedError,
    };
}
