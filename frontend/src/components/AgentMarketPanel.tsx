'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAccount, usePublicClient, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import {
    decodeEventLog,
    encodeAbiParameters,
    formatUnits,
    maxUint160,
    maxUint48,
    parseAbiItem,
    parseUnits,
    type Address,
    type Hash,
} from 'viem';
import { Activity, ArrowRightLeft, BarChart3, Database, Droplets, RefreshCw } from 'lucide-react';
import { CCA_ABI, ERC20_ABI } from '@/lib/abis';
import { PERMIT2, UNISWAP_POOL_MANAGER, UNISWAP_ROUTER, USDC } from '@/lib/contracts';

type Candle = {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volumeUsdc: number;
    trades: number;
};

type SwapPoint = {
    timestamp: number;
    blockNumber: bigint;
    priceUsdc: number;
    usdcVolume: number;
};

type MarketState = {
    status: 'idle' | 'loading' | 'ready' | 'no-seed' | 'error';
    managerAddress?: Address;
    positionManager?: Address;
    seedTxHash?: Hash;
    seededAtBlock?: bigint;
    positionTokenId?: bigint;
    poolId?: `0x${string}`;
    currency0?: Address;
    currency1?: Address;
    fee?: number;
    tickSpacing?: number;
    hooks?: Address;
    lastPriceUsdc?: number;
    priceChange24h?: number;
    volume24h?: number;
    trades24h?: number;
    totalVolume?: number;
    candles: Candle[];
    tradesCount: number;
    errorMessage?: string;
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const Q192 = BigInt(2) ** BigInt(192);
const PRICE_SCALE = BigInt(1_000_000_000_000);
const V4_COMMANDS = '0x10' as const; // Commands.V4_SWAP
const V4_ACTIONS_EXACT_IN = '0x060c0f' as const; // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL

const PERMIT2_ABI = [
    {
        name: 'approve',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'token', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint160' },
            { name: 'expiration', type: 'uint48' },
        ],
        outputs: [],
    },
] as const;

const UNIVERSAL_ROUTER_ABI = [
    {
        name: 'execute',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
            { name: 'commands', type: 'bytes' },
            { name: 'inputs', type: 'bytes[]' },
            { name: 'deadline', type: 'uint256' },
        ],
        outputs: [],
    },
] as const;

const LIQUIDITY_SEEDED_EVENT = parseAbiItem(
    'event LiquiditySeeded(address indexed auction, address indexed positionManager, uint256 indexed positionTokenId, address positionRecipient, uint160 sqrtPriceX96, uint256 currencySpent, uint256 tokenSpent, uint128 liquidity)'
);

const POOL_INITIALIZE_EVENT = parseAbiItem(
    'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)'
);

const POOL_MODIFY_LIQUIDITY_EVENT = parseAbiItem(
    'event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)'
);

const POOL_SWAP_EVENT = parseAbiItem(
    'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)'
);

function toLower(value: string): string {
    return value.toLowerCase();
}

function isZeroAddress(value: Address | undefined): boolean {
    return !value || toLower(value) === toLower(ZERO_ADDRESS);
}

function absBigInt(value: bigint): bigint {
    return value < BigInt(0) ? -value : value;
}

function sqrtPriceToRatio(sqrtPriceX96: bigint): number {
    if (sqrtPriceX96 <= BigInt(0)) return 0;
    const ratioScaled = (sqrtPriceX96 * sqrtPriceX96 * PRICE_SCALE) / Q192;
    return Number(ratioScaled) / Number(PRICE_SCALE);
}

function tokenPriceInUsdc(
    sqrtPriceX96: bigint,
    currency0: Address,
    currency1: Address,
    tokenAddress: Address,
    tokenDecimals: number,
    usdcDecimals = 6
): number {
    const ratioCurrency1Per0 = sqrtPriceToRatio(sqrtPriceX96);
    if (ratioCurrency1Per0 <= 0) return 0;

    const token = toLower(tokenAddress);
    const c0 = toLower(currency0);
    const c1 = toLower(currency1);
    const usdc = toLower(USDC);
    const decimalShift = tokenDecimals - usdcDecimals;
    const unitScale = decimalShift >= 0
        ? 10 ** decimalShift
        : 1 / (10 ** Math.abs(decimalShift));

    if (token === c0 && usdc === c1) {
        return ratioCurrency1Per0 * unitScale;
    }
    if (token === c1 && usdc === c0) {
        return (1 / ratioCurrency1Per0) * unitScale;
    }
    return 0;
}

function buildCandles(points: SwapPoint[]): Candle[] {
    if (points.length === 0) return [];

    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
    const startTs = sorted[0].timestamp;
    const endTs = sorted[sorted.length - 1].timestamp;
    const spanSec = Math.max(60, endTs - startTs);
    const targetBars = 40;
    const bucketSec = Math.max(60, Math.ceil(spanSec / targetBars / 60) * 60);
    const firstBucket = Math.floor(startTs / bucketSec) * bucketSec;
    const lastBucket = Math.floor(endTs / bucketSec) * bucketSec;

    const bucketMap = new Map<number, Candle>();

    for (const point of sorted) {
        const bucket = Math.floor(point.timestamp / bucketSec) * bucketSec;
        const existing = bucketMap.get(bucket);
        if (!existing) {
            bucketMap.set(bucket, {
                timestamp: bucket,
                open: point.priceUsdc,
                high: point.priceUsdc,
                low: point.priceUsdc,
                close: point.priceUsdc,
                volumeUsdc: point.usdcVolume,
                trades: 1,
            });
            continue;
        }
        existing.high = Math.max(existing.high, point.priceUsdc);
        existing.low = Math.min(existing.low, point.priceUsdc);
        existing.close = point.priceUsdc;
        existing.volumeUsdc += point.usdcVolume;
        existing.trades += 1;
    }

    const filled: Candle[] = [];
    let prevClose = sorted[0].priceUsdc;
    for (let ts = firstBucket; ts <= lastBucket; ts += bucketSec) {
        const existing = bucketMap.get(ts);
        if (existing) {
            prevClose = existing.close;
            filled.push(existing);
        } else {
            filled.push({
                timestamp: ts,
                open: prevClose,
                high: prevClose,
                low: prevClose,
                close: prevClose,
                volumeUsdc: 0,
                trades: 0,
            });
        }
    }

    return filled.slice(-80);
}

function formatCompact(value: number, digits = 2): string {
    if (!Number.isFinite(value)) return '0';
    return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: digits,
    }).format(value);
}

function formatPrice(value?: number): string {
    if (!value || !Number.isFinite(value)) return '--';
    if (value >= 1) return value.toFixed(4);
    if (value >= 0.01) return value.toFixed(6);
    return value.toFixed(8);
}

function toDecimalString(value: number, maxDecimals: number): string {
    if (!Number.isFinite(value) || value <= 0) return '0';
    const fixed = value.toFixed(Math.min(12, maxDecimals));
    return fixed.replace(/\.?0+$/, '') || '0';
}

function CandleChart({ candles }: { candles: Candle[] }) {
    const width = 920;
    const height = 280;
    const left = 18;
    const right = 56;
    const top = 14;
    const bottom = 28;
    const innerWidth = width - left - right;
    const innerHeight = height - top - bottom;

    if (candles.length === 0) {
        return (
            <div className="h-[280px] rounded border border-white/10 bg-zinc-950/80 flex items-center justify-center text-xs text-zinc-500">
                Waiting for first swap to draw chart...
            </div>
        );
    }

    const minPriceRaw = Math.min(...candles.map((c) => c.low));
    const maxPriceRaw = Math.max(...candles.map((c) => c.high));
    const minPrice = minPriceRaw * 0.9975;
    const maxPrice = maxPriceRaw * 1.0025;
    const range = Math.max(1e-12, maxPrice - minPrice);
    const step = innerWidth / Math.max(1, candles.length);
    const bodyWidth = Math.max(2, step * 0.6);

    const y = (price: number): number => top + ((maxPrice - price) / range) * innerHeight;
    const x = (index: number): number => left + index * step + step / 2;
    const yTicks = 5;

    return (
        <div className="rounded border border-white/10 bg-zinc-950/80 p-2">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[280px]">
                {Array.from({ length: yTicks }).map((_, idx) => {
                    const ratio = idx / (yTicks - 1);
                    const py = top + innerHeight * ratio;
                    const price = maxPrice - range * ratio;
                    return (
                        <g key={`grid-${idx}`}>
                            <line x1={left} y1={py} x2={width - right} y2={py} stroke="#1f2937" strokeWidth="1" />
                            <text x={width - right + 4} y={py + 3} fill="#71717a" fontSize="9">
                                {formatPrice(price)}
                            </text>
                        </g>
                    );
                })}

                {candles.map((candle, idx) => {
                    const cx = x(idx);
                    const yHigh = y(candle.high);
                    const yLow = y(candle.low);
                    const yOpen = y(candle.open);
                    const yClose = y(candle.close);
                    const bullish = candle.close >= candle.open;
                    const color = bullish ? '#14b8a6' : '#ef4444';
                    const bodyY = Math.min(yOpen, yClose);
                    const bodyH = Math.max(1, Math.abs(yClose - yOpen));

                    return (
                        <g key={`candle-${candle.timestamp}-${idx}`}>
                            <line x1={cx} y1={yHigh} x2={cx} y2={yLow} stroke={color} strokeWidth="1.2" />
                            <rect
                                x={cx - bodyWidth / 2}
                                y={bodyY}
                                width={bodyWidth}
                                height={bodyH}
                                fill={color}
                                opacity={0.95}
                                rx={1}
                            />
                        </g>
                    );
                })}

                <line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} stroke="#27272a" strokeWidth="1" />
            </svg>
        </div>
    );
}

type AgentMarketPanelProps = {
    auctionAddress?: Address;
    tokenAddress?: Address;
    startBlock?: bigint;
    isAuctionEnded: boolean;
};

export default function AgentMarketPanel({ auctionAddress, tokenAddress, startBlock, isAuctionEnded }: AgentMarketPanelProps) {
    const { address } = useAccount();
    const publicClient = usePublicClient();
    const { writeContractAsync: writeApprovalAsync, error: approvalError, isPending: isApprovalPending } = useWriteContract();
    const { writeContractAsync: writeSwapAsync, error: swapWriteError, isPending: isSwapPending } = useWriteContract();
    const [approvalTxHash, setApprovalTxHash] = useState<Hash | undefined>(undefined);
    const [swapTxHash, setSwapTxHash] = useState<Hash | undefined>(undefined);
    const {
        isLoading: isSwapConfirming,
        isSuccess: isSwapSuccess,
        error: swapReceiptError,
    } = useWaitForTransactionReceipt({
        hash: swapTxHash,
        query: { enabled: !!swapTxHash },
    });
    const [refreshNonce, setRefreshNonce] = useState(0);
    const [side, setSide] = useState<'buy' | 'sell'>('buy');
    const [amountIn, setAmountIn] = useState('');
    const [minOutInput, setMinOutInput] = useState('');
    const [approving, setApproving] = useState(false);
    const [actionMessage, setActionMessage] = useState<string | undefined>(undefined);
    const [state, setState] = useState<MarketState>({
        status: 'idle',
        candles: [],
        tradesCount: 0,
    });

    const { data: tokenDecimals } = useReadContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'decimals',
        args: [],
        query: { enabled: !!tokenAddress },
    });

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            if (!publicClient || !auctionAddress || !tokenAddress || !isAuctionEnded) {
                if (!cancelled) {
                    setState((prev) => ({ ...prev, status: 'idle' }));
                }
                return;
            }
            const tokenDecimalsForPrice = Number(tokenDecimals ?? 18);

            if (!cancelled) {
                setState((prev) => ({ ...prev, status: 'loading' }));
            }

            try {
                const managerAddress = await publicClient.readContract({
                    address: auctionAddress,
                    abi: CCA_ABI,
                    functionName: 'fundsRecipient',
                }) as Address;

                if (isZeroAddress(managerAddress)) {
                    if (!cancelled) {
                        setState({
                            status: 'no-seed',
                            managerAddress,
                            candles: [],
                            tradesCount: 0,
                        });
                    }
                    return;
                }

                const fromBlock = startBlock ?? BigInt(0);
                const seedLogs = await publicClient.getLogs({
                    address: managerAddress,
                    event: LIQUIDITY_SEEDED_EVENT,
                    args: { auction: auctionAddress },
                    fromBlock,
                    toBlock: 'latest',
                });

                if (seedLogs.length === 0) {
                    if (!cancelled) {
                        setState({
                            status: 'no-seed',
                            managerAddress,
                            candles: [],
                            tradesCount: 0,
                        });
                    }
                    return;
                }

                const latestSeed = [...seedLogs].sort((a, b) => {
                    const blockA = a.blockNumber ?? BigInt(0);
                    const blockB = b.blockNumber ?? BigInt(0);
                    if (blockA !== blockB) return blockA > blockB ? 1 : -1;
                    const indexA = a.logIndex ?? 0;
                    const indexB = b.logIndex ?? 0;
                    return indexA - indexB;
                })[seedLogs.length - 1];

                const seedArgs = latestSeed.args as {
                    auction?: Address;
                    positionManager?: Address;
                    positionTokenId?: bigint;
                    sqrtPriceX96?: bigint;
                };

                const seedTxHash = latestSeed.transactionHash as Hash;
                const seededAtBlock = latestSeed.blockNumber ?? BigInt(0);
                const positionManager = seedArgs.positionManager as Address | undefined;
                const positionTokenId = seedArgs.positionTokenId ?? BigInt(0);

                const receipt = await publicClient.getTransactionReceipt({ hash: seedTxHash });

                let poolId: `0x${string}` | undefined;
                let currency0: Address | undefined;
                let currency1: Address | undefined;
                let fee: number | undefined;
                let tickSpacing: number | undefined;
                let hooks: Address | undefined;
                let seedSqrtPrice: bigint = seedArgs.sqrtPriceX96 ?? BigInt(0);

                for (const rawLog of receipt.logs) {
                    if (toLower(rawLog.address) !== toLower(UNISWAP_POOL_MANAGER)) continue;
                    try {
                        const decoded = decodeEventLog({
                            abi: [POOL_INITIALIZE_EVENT],
                            data: rawLog.data,
                            topics: rawLog.topics,
                        });
                        poolId = decoded.args.id as `0x${string}`;
                        currency0 = decoded.args.currency0 as Address;
                        currency1 = decoded.args.currency1 as Address;
                        fee = Number(decoded.args.fee);
                        tickSpacing = Number(decoded.args.tickSpacing);
                        hooks = decoded.args.hooks as Address;
                        seedSqrtPrice = decoded.args.sqrtPriceX96 as bigint;
                        break;
                    } catch {
                        // Ignore non-initialize logs.
                    }
                }

                if (!poolId) {
                    for (const rawLog of receipt.logs) {
                        if (toLower(rawLog.address) !== toLower(UNISWAP_POOL_MANAGER)) continue;
                        try {
                            const decoded = decodeEventLog({
                                abi: [POOL_MODIFY_LIQUIDITY_EVENT],
                                data: rawLog.data,
                                topics: rawLog.topics,
                            });
                            poolId = decoded.args.id as `0x${string}`;
                            break;
                        } catch {
                            // Ignore non-modifyLiquidity logs.
                        }
                    }
                }

                if (poolId && (!currency0 || !currency1)) {
                    const initLogs = await publicClient.getLogs({
                        address: UNISWAP_POOL_MANAGER as Address,
                        event: POOL_INITIALIZE_EVENT,
                        args: { id: poolId },
                        fromBlock: BigInt(0),
                        toBlock: seededAtBlock,
                    });

                    const latestInit = initLogs[initLogs.length - 1];
                    if (latestInit) {
                        const initArgs = latestInit.args as {
                            currency0?: Address;
                            currency1?: Address;
                            fee?: number;
                            tickSpacing?: number;
                            hooks?: Address;
                            sqrtPriceX96?: bigint;
                        };
                        currency0 = initArgs.currency0 as Address | undefined;
                        currency1 = initArgs.currency1 as Address | undefined;
                        fee = typeof initArgs.fee === 'number' ? initArgs.fee : fee;
                        tickSpacing = typeof initArgs.tickSpacing === 'number' ? initArgs.tickSpacing : tickSpacing;
                        hooks = (initArgs.hooks as Address | undefined) ?? hooks;
                        seedSqrtPrice = (initArgs.sqrtPriceX96 as bigint | undefined) ?? seedSqrtPrice;
                    }
                }

                let points: SwapPoint[] = [];

                if (poolId && currency0 && currency1) {
                    const swapLogs = await publicClient.getLogs({
                        address: UNISWAP_POOL_MANAGER as Address,
                        event: POOL_SWAP_EVENT,
                        args: { id: poolId },
                        fromBlock: seededAtBlock,
                        toBlock: 'latest',
                    });

                    const blockNumbers = Array.from(
                        new Set(
                            swapLogs
                                .map((log) => log.blockNumber)
                                .filter((value): value is bigint => value !== null && value !== undefined)
                                .map((value) => value.toString())
                        )
                    );

                    const blockTimestampMap = new Map<string, number>();
                    await Promise.all(
                        blockNumbers.map(async (bn) => {
                            const block = await publicClient.getBlock({ blockNumber: BigInt(bn) });
                            blockTimestampMap.set(bn, Number(block.timestamp));
                        })
                    );

                    points = swapLogs.flatMap((log) => {
                        const blockNumber = log.blockNumber;
                        if (blockNumber === null || blockNumber === undefined) return [];
                        try {
                            const decoded = decodeEventLog({
                                abi: [POOL_SWAP_EVENT],
                                data: log.data,
                                topics: log.topics,
                            });

                            const args = decoded.args as {
                                amount0: bigint;
                                amount1: bigint;
                                sqrtPriceX96: bigint;
                            };

                            const priceUsdc = tokenPriceInUsdc(
                                args.sqrtPriceX96,
                                currency0 as Address,
                                currency1 as Address,
                                tokenAddress,
                                tokenDecimalsForPrice
                            );
                            if (!Number.isFinite(priceUsdc) || priceUsdc <= 0) return [];

                            const usdcVolumeRaw =
                                toLower(currency0 as Address) === toLower(USDC)
                                    ? absBigInt(args.amount0)
                                    : toLower(currency1 as Address) === toLower(USDC)
                                        ? absBigInt(args.amount1)
                                        : BigInt(0);

                            const usdcVolume = Number(formatUnits(usdcVolumeRaw, 6));
                            const timestamp = blockTimestampMap.get(blockNumber.toString()) ?? 0;

                            return [{
                                timestamp,
                                blockNumber,
                                priceUsdc,
                                usdcVolume,
                            }];
                        } catch {
                            return [];
                        }
                    });
                }

                points.sort((a, b) => a.timestamp - b.timestamp);

                const fallbackPrice =
                    currency0 && currency1
                        ? tokenPriceInUsdc(seedSqrtPrice, currency0, currency1, tokenAddress, tokenDecimalsForPrice)
                        : 0;

                const candles = points.length > 0
                    ? buildCandles(points)
                    : (fallbackPrice > 0
                        ? [{
                            timestamp: Math.floor(Date.now() / 1000),
                            open: fallbackPrice,
                            high: fallbackPrice,
                            low: fallbackPrice,
                            close: fallbackPrice,
                            volumeUsdc: 0,
                            trades: 0,
                        }]
                        : []);

                const nowSec = Math.floor(Date.now() / 1000);
                const dayAgo = nowSec - 86_400;
                const points24h = points.filter((p) => p.timestamp >= dayAgo);
                const lastPoint = points[points.length - 1];
                const basePoint = points24h[0] ?? points[0];
                const lastPriceUsdc = lastPoint?.priceUsdc ?? fallbackPrice;
                const priceChange24h =
                    basePoint && basePoint.priceUsdc > 0
                        ? ((lastPriceUsdc - basePoint.priceUsdc) / basePoint.priceUsdc) * 100
                        : 0;
                const volume24h = points24h.reduce((sum, point) => sum + point.usdcVolume, 0);
                const totalVolume = points.reduce((sum, point) => sum + point.usdcVolume, 0);

                if (!cancelled) {
                    setState({
                        status: 'ready',
                        managerAddress,
                        positionManager,
                        seedTxHash,
                        seededAtBlock,
                        positionTokenId,
                        poolId,
                        currency0,
                        currency1,
                        fee,
                        tickSpacing,
                        hooks,
                        lastPriceUsdc,
                        priceChange24h,
                        volume24h,
                        trades24h: points24h.length,
                        totalVolume,
                        candles,
                        tradesCount: points.length,
                    });
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown market load error';
                if (!cancelled) {
                    setState({
                        status: 'error',
                        candles: [],
                        tradesCount: 0,
                        errorMessage: message,
                    });
                }
            }
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, [publicClient, auctionAddress, tokenAddress, tokenDecimals, startBlock, isAuctionEnded, refreshNonce]);

    const seedTxUrl = state.seedTxHash ? `https://sepolia.basescan.org/tx/${state.seedTxHash}` : undefined;
    const positionUrl =
        state.positionManager && state.positionTokenId !== undefined
            ? `https://sepolia.basescan.org/token/${state.positionManager}?a=${state.positionTokenId.toString()}`
            : undefined;

    const statusBadge = useMemo(() => {
        if (state.status === 'loading') return { label: 'Syncing Market', className: 'text-blue-300 border-blue-800 bg-blue-950/30' };
        if (state.status === 'ready') return { label: 'Live on AMM', className: 'text-teal-300 border-teal-800 bg-teal-950/30' };
        if (state.status === 'no-seed') return { label: 'LP Not Seeded Yet', className: 'text-amber-300 border-amber-800 bg-amber-950/30' };
        if (state.status === 'error') return { label: 'Market Sync Error', className: 'text-red-300 border-red-800 bg-red-950/30' };
        return { label: 'Awaiting Completion', className: 'text-zinc-300 border-zinc-700 bg-zinc-900/30' };
    }, [state.status]);

    const tokenDecimalsValue = Number(tokenDecimals ?? 18);
    const tokenInAddress = side === 'buy' ? (USDC as Address) : tokenAddress;
    const tokenOutAddress = side === 'buy' ? tokenAddress : (USDC as Address);
    const inDecimals = side === 'buy' ? 6 : tokenDecimalsValue;
    const outDecimals = side === 'buy' ? tokenDecimalsValue : 6;
    const approximateOutput = useMemo(() => {
        if (!amountIn.trim() || !state.lastPriceUsdc || state.lastPriceUsdc <= 0) return '';
        const input = Number(amountIn);
        if (!Number.isFinite(input) || input <= 0) return '';
        const raw = side === 'buy' ? input / state.lastPriceUsdc : input * state.lastPriceUsdc;
        return toDecimalString(raw, outDecimals);
    }, [amountIn, outDecimals, side, state.lastPriceUsdc]);

    const handleApprove = async () => {
        if (!address || !publicClient || !tokenInAddress) {
            setActionMessage('Connect wallet first.');
            return;
        }

        try {
            setApproving(true);
            setApprovalTxHash(undefined);
            setActionMessage('Approving token to Permit2...');
            const erc20ApproveHash = await writeApprovalAsync({
                address: tokenInAddress,
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [PERMIT2 as Address, (BigInt(2) ** BigInt(256)) - BigInt(1)],
            });
            setApprovalTxHash(erc20ApproveHash);
            await publicClient.waitForTransactionReceipt({ hash: erc20ApproveHash });

            setActionMessage('Approving Permit2 allowance to router...');
            const permit2ApproveHash = await writeApprovalAsync({
                address: PERMIT2 as Address,
                abi: PERMIT2_ABI,
                functionName: 'approve',
                args: [tokenInAddress, UNISWAP_ROUTER as Address, maxUint160, Number(maxUint48)],
            });
            setApprovalTxHash(permit2ApproveHash);
            await publicClient.waitForTransactionReceipt({ hash: permit2ApproveHash });
            setActionMessage('Approval complete. You can swap now.');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Approval failed';
            setActionMessage(message);
        } finally {
            setApproving(false);
        }
    };

    const handleSwap = async () => {
        if (!address || !publicClient) {
            setActionMessage('Connect wallet first.');
            return;
        }
        if (!tokenAddress || !tokenInAddress || !tokenOutAddress) {
            setActionMessage('Missing token addresses.');
            return;
        }
        if (!state.currency0 || !state.currency1 || !state.fee || !state.tickSpacing) {
            setActionMessage('Pool key not loaded yet. Refresh and retry.');
            return;
        }
        if (!amountIn.trim()) {
            setActionMessage('Enter an amount.');
            return;
        }

        try {
            setSwapTxHash(undefined);
            const amountInRaw = parseUnits(amountIn.trim(), inDecimals);
            if (amountInRaw <= BigInt(0)) {
                setActionMessage('Amount must be greater than 0.');
                return;
            }
            if (amountInRaw > (BigInt(2) ** BigInt(128)) - BigInt(1)) {
                setActionMessage('Amount too large for router uint128.');
                return;
            }

            let minOutRaw = BigInt(0);
            if (minOutInput.trim()) {
                minOutRaw = parseUnits(minOutInput.trim(), outDecimals);
            }
            if (minOutRaw > (BigInt(2) ** BigInt(128)) - BigInt(1)) {
                minOutRaw = (BigInt(2) ** BigInt(128)) - BigInt(1);
            }

            const c0 = toLower(state.currency0);
            const c1 = toLower(state.currency1);
            const tIn = toLower(tokenInAddress);
            const tOut = toLower(tokenOutAddress);
            let zeroForOne: boolean;
            if (c0 === tIn && c1 === tOut) {
                zeroForOne = true;
            } else if (c0 === tOut && c1 === tIn) {
                zeroForOne = false;
            } else {
                setActionMessage('Trade pair does not match discovered pool.');
                return;
            }

            const hookAddress = state.hooks ?? (ZERO_ADDRESS as Address);
            const poolKey = {
                currency0: state.currency0,
                currency1: state.currency1,
                fee: state.fee,
                tickSpacing: state.tickSpacing,
                hooks: hookAddress,
            };

            const paramSwap = encodeAbiParameters(
                [
                    {
                        type: 'tuple',
                        components: [
                            {
                                name: 'poolKey',
                                type: 'tuple',
                                components: [
                                    { name: 'currency0', type: 'address' },
                                    { name: 'currency1', type: 'address' },
                                    { name: 'fee', type: 'uint24' },
                                    { name: 'tickSpacing', type: 'int24' },
                                    { name: 'hooks', type: 'address' },
                                ],
                            },
                            { name: 'zeroForOne', type: 'bool' },
                            { name: 'amountIn', type: 'uint128' },
                            { name: 'amountOutMinimum', type: 'uint128' },
                            { name: 'hookData', type: 'bytes' },
                        ],
                    },
                ],
                [{
                    poolKey,
                    zeroForOne,
                    amountIn: amountInRaw,
                    amountOutMinimum: minOutRaw,
                    hookData: '0x',
                }]
            );

            const paramSettle = encodeAbiParameters(
                [{ type: 'address' }, { type: 'uint256' }],
                [tokenInAddress, amountInRaw]
            );
            const paramTake = encodeAbiParameters(
                [{ type: 'address' }, { type: 'uint256' }],
                [tokenOutAddress, minOutRaw]
            );
            const input = encodeAbiParameters(
                [{ type: 'bytes' }, { type: 'bytes[]' }],
                [V4_ACTIONS_EXACT_IN, [paramSwap, paramSettle, paramTake]]
            );

            const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
            setActionMessage('Confirm swap in wallet...');
            console.info('[AgentMarketPanel] Swap params', {
                auctionAddress,
                tokenAddress,
                side,
                amountIn,
                amountInRaw: amountInRaw.toString(),
                minOutRaw: minOutRaw.toString(),
                pool: {
                    currency0: state.currency0,
                    currency1: state.currency1,
                    fee: state.fee,
                    tickSpacing: state.tickSpacing,
                },
                lastPriceUsdc: state.lastPriceUsdc,
                estimatedOut: approximateOutput || null,
            });
            const submittedHash = await writeSwapAsync({
                address: UNISWAP_ROUTER as Address,
                abi: UNIVERSAL_ROUTER_ABI,
                functionName: 'execute',
                args: [V4_COMMANDS, [input], deadline],
            });
            setSwapTxHash(submittedHash);
            console.info('[AgentMarketPanel] Swap submitted', {
                auctionAddress,
                tokenAddress,
                hash: submittedHash,
                side,
                amountIn,
            });
            setActionMessage(`Swap submitted: ${submittedHash}. Waiting for confirmation...`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Swap failed';
            setActionMessage(message);
        }
    };

    useEffect(() => {
        if (isSwapSuccess) {
            setActionMessage('Swap confirmed on-chain.');
            setRefreshNonce((prev) => prev + 1);
        }
    }, [isSwapSuccess]);

    useEffect(() => {
        if (!approvalError) return;
        setActionMessage(approvalError.message);
    }, [approvalError]);

    useEffect(() => {
        if (!swapWriteError) return;
        setActionMessage(swapWriteError.message);
    }, [swapWriteError]);

    useEffect(() => {
        if (!swapReceiptError) return;
        setActionMessage(swapReceiptError.message);
    }, [swapReceiptError]);

    if (!isAuctionEnded) return null;

    return (
        <section className="rounded-xl border border-white/10 bg-gradient-to-b from-zinc-950 to-black p-5 md:p-6 space-y-4 shadow-2xl">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-teal-500/10 border border-teal-500/30 flex items-center justify-center">
                        <BarChart3 className="h-4 w-4 text-teal-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white tracking-tight">AMM Market</h3>
                        <p className="text-xs text-zinc-500">On-chain Uniswap v4 pool and swap stream</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 text-[10px] border rounded-full font-semibold uppercase tracking-wider ${statusBadge.className}`}>
                        {statusBadge.label}
                    </span>
                    <button
                        onClick={() => setRefreshNonce((prev) => prev + 1)}
                        className="h-8 px-3 rounded-md border border-white/10 text-zinc-300 hover:text-white hover:border-white/20 text-xs flex items-center gap-1.5 transition-colors"
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Refresh
                    </button>
                </div>
            </div>

            {state.status === 'loading' && (
                <div className="h-[320px] rounded border border-white/10 bg-zinc-950/70 flex items-center justify-center text-sm text-zinc-400">
                    Loading pool + swap events...
                </div>
            )}

            {state.status === 'no-seed' && (
                <div className="rounded border border-amber-800 bg-amber-950/20 p-4 text-sm text-amber-300">
                    Auction ended, but no `LiquiditySeeded` event found for this auction yet.
                </div>
            )}

            {state.status === 'error' && (
                <div className="rounded border border-red-800 bg-red-950/20 p-4 text-sm text-red-300">
                    Could not load AMM data: {state.errorMessage}
                </div>
            )}

            {state.status === 'ready' && (
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <MetricCard label="Last Price" value={`$${formatPrice(state.lastPriceUsdc)}`} icon={<Activity className="h-4 w-4 text-teal-400" />} />
                        <MetricCard
                            label="24h Change"
                            value={`${state.priceChange24h && Number.isFinite(state.priceChange24h) ? state.priceChange24h.toFixed(2) : '0.00'}%`}
                            valueClassName={(state.priceChange24h ?? 0) >= 0 ? 'text-teal-400' : 'text-red-400'}
                            icon={<BarChart3 className="h-4 w-4 text-blue-400" />}
                        />
                        <MetricCard label="24h Volume" value={`$${formatCompact(state.volume24h ?? 0, 2)}`} icon={<Droplets className="h-4 w-4 text-cyan-400" />} />
                        <MetricCard label="Trades (24h)" value={`${state.trades24h ?? 0}`} icon={<Database className="h-4 w-4 text-purple-400" />} />
                    </div>

                    <CandleChart candles={state.candles} />

                    <div className="rounded-xl border border-white/10 bg-zinc-950/70 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="text-sm font-bold text-white uppercase tracking-wide">Trade</h4>
                                <p className="text-[11px] text-zinc-500">Swap through Uniswap v4 Universal Router</p>
                            </div>
                            <button
                                onClick={() => setSide((prev) => (prev === 'buy' ? 'sell' : 'buy'))}
                                className="h-8 px-3 rounded-md border border-white/10 text-zinc-300 hover:text-white hover:border-white/20 text-xs flex items-center gap-1.5 transition-colors"
                            >
                                <ArrowRightLeft className="h-3.5 w-3.5" />
                                {side === 'buy' ? 'Buying' : 'Selling'}
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Amount In ({side === 'buy' ? 'USDC' : 'Token'})</label>
                                <input
                                    value={amountIn}
                                    onChange={(event) => setAmountIn(event.target.value)}
                                    placeholder={side === 'buy' ? '10.0' : '1000.0'}
                                    className="w-full h-9 rounded-md border border-white/10 bg-black/40 px-3 text-sm text-zinc-100 outline-none focus:border-teal-500"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Min Out (optional)</label>
                                <input
                                    value={minOutInput}
                                    onChange={(event) => setMinOutInput(event.target.value)}
                                    placeholder={approximateOutput || 'leave empty for no min out'}
                                    className="w-full h-9 rounded-md border border-white/10 bg-black/40 px-3 text-sm text-zinc-100 outline-none focus:border-teal-500"
                                />
                            </div>
                        </div>

                        <div className="rounded border border-white/10 bg-black/30 p-2.5 text-xs text-zinc-400">
                            <div>
                                {approximateOutput
                                    ? `Approx output at last traded price: ${approximateOutput} ${side === 'buy' ? 'TOKEN' : 'USDC'}`
                                    : 'Enter amount to estimate output from last traded price.'}
                            </div>
                            <div className="mt-1 text-zinc-500">
                                Leave Min Out empty to avoid price-model reverts on thin LP. Enter Min Out manually when you want strict protection.
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <button
                                onClick={handleApprove}
                                disabled={approving || isApprovalPending || isSwapPending || isSwapConfirming || !address}
                                className="h-10 rounded-md border border-white/10 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-colors"
                            >
                                {approving || isApprovalPending ? 'Approving...' : 'Approve For Trading'}
                            </button>
                            <button
                                onClick={handleSwap}
                                disabled={isSwapPending || isSwapConfirming || approving || isApprovalPending || !address}
                                className="h-10 rounded-md border border-teal-700 bg-teal-600/20 text-teal-300 hover:bg-teal-600/30 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-colors"
                            >
                                {isSwapPending ? 'Submitting...'
                                    : isSwapConfirming ? 'Confirming...'
                                        : (side === 'buy' ? 'Buy Token' : 'Sell Token')}
                            </button>
                        </div>

                        {approvalTxHash && (
                            <div className="text-[11px] text-zinc-400">
                                Approval tx:{' '}
                                <a
                                    href={`https://sepolia.basescan.org/tx/${approvalTxHash}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline underline-offset-2 text-zinc-200 hover:text-white font-mono break-all"
                                >
                                    {approvalTxHash}
                                </a>
                            </div>
                        )}

                        {swapTxHash && (
                            <div className="text-[11px] text-zinc-400">
                                Swap tx:{' '}
                                <a
                                    href={`https://sepolia.basescan.org/tx/${swapTxHash}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline underline-offset-2 text-zinc-200 hover:text-white font-mono break-all"
                                >
                                    {swapTxHash}
                                </a>
                            </div>
                        )}

                        {actionMessage && (
                            <div className="text-[11px] text-zinc-500 break-words">{actionMessage}</div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        <InfoRow label="Pool ID" value={state.poolId ?? 'N/A'} monospace />
                        <InfoRow label="Seed Tx" value={state.seedTxHash ?? 'N/A'} monospace link={seedTxUrl} />
                        <InfoRow label="Position NFT" value={state.positionTokenId?.toString() ?? 'N/A'} link={positionUrl} />
                        <InfoRow label="Fee / TickSpacing" value={`${state.fee ?? '--'} / ${state.tickSpacing ?? '--'}`} />
                        <InfoRow label="Token Pair" value={`${state.currency0 ?? '--'} | ${state.currency1 ?? '--'}`} monospace />
                        <InfoRow label="Total Volume" value={`$${formatCompact(state.totalVolume ?? 0, 2)}`} />
                    </div>

                    <div className="text-[11px] text-zinc-500">
                        Data source: Uniswap v4 `PoolManager` logs (`Initialize` / `Swap`) and your manager `LiquiditySeeded` event. No external chart API required.
                    </div>
                </>
            )}
        </section>
    );
}

function MetricCard({
    label,
    value,
    icon,
    valueClassName,
}: {
    label: string;
    value: string;
    icon: ReactNode;
    valueClassName?: string;
}) {
    return (
        <div className="rounded-lg border border-white/10 bg-zinc-950/70 p-3">
            <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest">{label}</span>
                {icon}
            </div>
            <div className={`text-lg font-mono font-bold ${valueClassName ?? 'text-white'}`}>{value}</div>
        </div>
    );
}

function InfoRow({
    label,
    value,
    monospace = false,
    link,
}: {
    label: string;
    value: string;
    monospace?: boolean;
    link?: string;
}) {
    const className = monospace ? 'font-mono break-all' : '';
    return (
        <div className="rounded border border-white/10 bg-zinc-950/70 p-2.5">
            <div className="text-zinc-500 mb-1">{label}</div>
            {link ? (
                <a href={link} target="_blank" rel="noreferrer" className={`text-zinc-200 hover:text-white underline underline-offset-2 ${className}`}>
                    {value}
                </a>
            ) : (
                <div className={`text-zinc-200 ${className}`}>{value}</div>
            )}
        </div>
    );
}
