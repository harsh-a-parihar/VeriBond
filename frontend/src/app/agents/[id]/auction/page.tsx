'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useBlockNumber } from 'wagmi';
import { ADMIN_WALLET, AGENT_TOKEN_FACTORY, USDC } from '@/lib/contracts';
import { AGENT_TOKEN_FACTORY_ABI, CCA_ABI, POST_AUCTION_LIQUIDITY_MANAGER_ABI } from '@/lib/abis';
import { useAdaptiveWrite } from '@/hooks/useAdaptiveWrite';
import { formatUnits, parseUnits, maxUint160, maxUint48, parseAbiItem } from 'viem';
import { Loader2, TrendingUp, Wallet, Clock, CheckCircle, ArrowLeft, Activity, Gavel } from 'lucide-react';

// Permit2 canonical address (same on all EVM chains)
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

const ERC20_ABI = [
    {
        name: 'approve',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
        outputs: [{ type: 'bool' }],
    },
    {
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
        outputs: [{ type: 'uint256' }],
    }
] as const;

const PERMIT2_ABI = [
    {
        name: 'approve',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'token', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint160' },
            { name: 'expiration', type: 'uint48' }
        ],
        outputs: [],
    },
    {
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            { name: 'owner', type: 'address' },
            { name: 'token', type: 'address' },
            { name: 'spender', type: 'address' }
        ],
        outputs: [
            { name: 'amount', type: 'uint160' },
            { name: 'expiration', type: 'uint48' },
            { name: 'nonce', type: 'uint48' }
        ],
    }
] as const;

export default function AuctionPage() {
    const params = useParams();
    const router = useRouter();
    const { address } = useAccount();
    const agentId = params.id ? BigInt(params.id as string) : undefined;

    // 1. Get Auction Address from Factory
    const { data: auctionAddress, isLoading: isAddressLoading } = useReadContract({
        address: AGENT_TOKEN_FACTORY,
        abi: AGENT_TOKEN_FACTORY_ABI,
        functionName: 'getAgentAuction',
        args: agentId ? [agentId] : undefined,
    });

    const { data: tokenAddress } = useReadContract({
        address: AGENT_TOKEN_FACTORY,
        abi: AGENT_TOKEN_FACTORY_ABI,
        functionName: 'getAgentToken',
        args: agentId ? [agentId] : undefined,
    });

    const { data: factoryLiquidityManagerAddress } = useReadContract({
        address: AGENT_TOKEN_FACTORY,
        abi: AGENT_TOKEN_FACTORY_ABI,
        functionName: 'liquidityManager',
    });

    const { data: auctionFundsRecipient } = useReadContract({
        address: auctionAddress,
        abi: CCA_ABI,
        functionName: 'fundsRecipient',
        args: [],
        query: { enabled: !!auctionAddress }
    });

    // 2. Read Auction State
    const { data: clearingPrice, refetch: refetchPrice } = useReadContract({
        address: auctionAddress,
        abi: CCA_ABI,
        functionName: 'clearingPrice',
        args: [],
        query: { enabled: !!auctionAddress }
    });

    const { data: totalCleared, refetch: refetchCleared } = useReadContract({
        address: auctionAddress,
        abi: CCA_ABI,
        functionName: 'totalCleared',
        args: [],
        query: { enabled: !!auctionAddress }
    });

    const liquidityManagerAddress = (auctionFundsRecipient && auctionFundsRecipient !== ZERO_ADDRESS)
        ? auctionFundsRecipient
        : factoryLiquidityManagerAddress;
    const usesLegacyAuctionManager = !!(
        auctionFundsRecipient
        && factoryLiquidityManagerAddress
        && auctionFundsRecipient.toLowerCase() !== factoryLiquidityManagerAddress.toLowerCase()
    );
    const hasLiquidityManager = !!liquidityManagerAddress && liquidityManagerAddress !== ZERO_ADDRESS;

    const { data: managerAuctionRecord, refetch: refetchManagerAuction } = useReadContract({
        address: hasLiquidityManager ? liquidityManagerAddress : undefined,
        abi: POST_AUCTION_LIQUIDITY_MANAGER_ABI,
        functionName: 'auctions',
        args: auctionAddress ? [auctionAddress] : undefined,
        query: { enabled: !!auctionAddress && hasLiquidityManager }
    });

    const { data: managerPositionManager, refetch: refetchManagerPositionManager } = useReadContract({
        address: hasLiquidityManager ? liquidityManagerAddress : undefined,
        abi: POST_AUCTION_LIQUIDITY_MANAGER_ABI,
        functionName: 'positionManager',
        args: [],
        query: { enabled: hasLiquidityManager }
    });

    const { data: managerLiquiditySeeded, refetch: refetchManagerLiquiditySeeded } = useReadContract({
        address: hasLiquidityManager ? liquidityManagerAddress : undefined,
        abi: POST_AUCTION_LIQUIDITY_MANAGER_ABI,
        functionName: 'liquiditySeeded',
        args: auctionAddress ? [auctionAddress] : undefined,
        query: { enabled: !!auctionAddress && hasLiquidityManager }
    });

    const { data: managerPositionTokenId, refetch: refetchManagerPositionTokenId } = useReadContract({
        address: hasLiquidityManager ? liquidityManagerAddress : undefined,
        abi: POST_AUCTION_LIQUIDITY_MANAGER_ABI,
        functionName: 'auctionPositionTokenId',
        args: auctionAddress ? [auctionAddress] : undefined,
        query: { enabled: !!auctionAddress && hasLiquidityManager }
    });

    // Read auction timing
    const { data: startBlock } = useReadContract({
        address: auctionAddress,
        abi: [{ name: 'startBlock', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] }] as const,
        functionName: 'startBlock',
        args: [],
        query: { enabled: !!auctionAddress }
    });

    const { data: endBlock } = useReadContract({
        address: auctionAddress,
        abi: [{ name: 'endBlock', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] }] as const,
        functionName: 'endBlock',
        args: [],
        query: { enabled: !!auctionAddress }
    });

    // Log auction timing for debugging
    useEffect(() => {
        if (startBlock && endBlock) {
            console.log('[Auction] Timing:', {
                startBlock: startBlock.toString(),
                endBlock: endBlock.toString(),
                clearingPrice: clearingPrice ? formatUnits(clearingPrice, 18) : undefined
            });
        }
    }, [startBlock, endBlock, clearingPrice]);

    // 3. User Interaction State
    const [bidAmount, setBidAmount] = useState('100');
    const [maxPrice, setMaxPrice] = useState('1.0');
    const [approvalStep, setApprovalStep] = useState<'erc20' | 'permit2' | 'ready'>('erc20');
    const [lastBidId, setLastBidId] = useState<bigint | null>(null);
    const [userBids, setUserBids] = useState<bigint[]>([]);
    const [lpRecipient, setLpRecipient] = useState('');
    const [lpTokenAmount, setLpTokenAmount] = useState('');
    const publicClient = usePublicClient();
    const { data: currentBlock } = useBlockNumber({ watch: true });

    // Read claimBlock to check if claiming is available
    const { data: claimBlock } = useReadContract({
        address: auctionAddress,
        abi: CCA_ABI,
        functionName: 'claimBlock',
        args: [],
        query: { enabled: !!auctionAddress }
    });

    const endedByEndBlock = currentBlock && endBlock ? currentBlock >= endBlock : false;
    const isAuctionEnded = currentBlock && claimBlock ? currentBlock >= claimBlock : endedByEndBlock;
    const isAuctionActive = currentBlock && endBlock ? currentBlock < endBlock : false;
    const auctionStatusLabel = !currentBlock || !endBlock
        ? 'Loading'
        : isAuctionActive
            ? 'Open for Bidding'
            : 'Auction Ended';
    const auctionStatusClass = !currentBlock || !endBlock
        ? 'text-zinc-500'
        : isAuctionActive
            ? 'text-teal-500'
            : 'text-red-500';
    const isAdmin = address?.toLowerCase() === ADMIN_WALLET.toLowerCase();

    const managerRecord = managerAuctionRecord as
        | readonly [bigint, `0x${string}`, `0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, boolean, boolean, boolean]
        | undefined;
    const managerRegistered = managerRecord?.[8] ?? false;
    const managerFinalized = managerRecord?.[9] ?? false;
    const managerReleased = managerRecord?.[10] ?? false;
    const managerCurrencyRaised = managerRecord?.[5] ?? BigInt(0);
    const managerLpCurrencyBudget = managerRecord?.[6] ?? BigInt(0);
    const managerLpTokenBudget = managerRecord?.[7] ?? BigInt(0);
    const managerHasPositionManager = !!managerPositionManager && managerPositionManager !== ZERO_ADDRESS;
    const managerSeeded = managerLiquiditySeeded ?? false;
    const managerPositionId = managerPositionTokenId ?? BigInt(0);

    // Calculate estimated time remaining
    const blocksRemaining = currentBlock && endBlock ? (endBlock > currentBlock ? endBlock - currentBlock : BigInt(0)) : BigInt(0);
    const secondsRemaining = Number(blocksRemaining) * 2; // ~2s per block on Base
    const hours = Math.floor(secondsRemaining / 3600);
    const minutes = Math.floor((secondsRemaining % 3600) / 60);

    const timeLeftString = blocksRemaining > 0
        ? `${hours}h ${minutes}m left`
        : (isAuctionActive ? 'Ending soon...' : 'Ended');

    // Fetch user's bids
    useEffect(() => {
        const fetchBids = async () => {
            console.log('[BidDiscovery] Starting fetch...', {
                hasPublicClient: !!publicClient,
                auctionAddress,
                userAddress: address,
                startBlock: startBlock?.toString()
            });

            if (!publicClient || !auctionAddress || !address || !startBlock) {
                console.log('[BidDiscovery] Skipping - missing dependencies');
                return;
            }

            try {
                // Get all bids submitted by user
                console.log('[BidDiscovery] Fetching BidSubmitted events...');
                const submittedLogs = await publicClient.getLogs({
                    address: auctionAddress,
                    event: parseAbiItem('event BidSubmitted(uint256 indexed bidId, address indexed owner, uint256 maxPrice, uint128 amount)'),
                    args: { owner: address },
                    fromBlock: BigInt(startBlock),
                    toBlock: 'latest'
                });
                console.log('[BidDiscovery] BidSubmitted logs:', submittedLogs.length, submittedLogs);

                // Get all bids exited (claimed) by user
                console.log('[BidDiscovery] Fetching BidExited events...');
                const exitedLogs = await publicClient.getLogs({
                    address: auctionAddress,
                    event: parseAbiItem('event BidExited(uint256 indexed bidId, address indexed owner, uint256 tokensFilled, uint256 currencyRefunded)'),
                    args: { owner: address },
                    fromBlock: BigInt(startBlock),
                    toBlock: 'latest'
                });
                console.log('[BidDiscovery] BidExited logs:', exitedLogs.length, exitedLogs);

                const exitedBidIds = new Set(exitedLogs.map(log => log.args.bidId!.toString()));

                // Filter out exited bids
                const activeBidIds = submittedLogs
                    .map(log => log.args.bidId!)
                    .filter(id => !exitedBidIds.has(id.toString()))
                    .sort((a, b) => Number(b - a)); // Newest first

                console.log('[BidDiscovery] Active bids after filtering:', activeBidIds.map(b => b.toString()));
                setUserBids(activeBidIds);

                // Auto-select newest bid if no selection and no pending claim
                if (activeBidIds.length > 0 && !lastBidId) {
                    console.log('[BidDiscovery] Auto-selecting bid:', activeBidIds[0].toString());
                    setLastBidId(activeBidIds[0]);
                }
            } catch (err) {
                console.error("[BidDiscovery] Error fetching bids", err);
            }
        };

        const interval = setInterval(fetchBids, 5000); // Poll every 5s
        fetchBids();
        return () => clearInterval(interval);
    }, [publicClient, auctionAddress, address, startBlock, lastBidId]);

    // 4. Contract Writes
    const bidWrite = useAdaptiveWrite({ allowAA: true, fallbackToStandard: true });
    const claimWrite = useAdaptiveWrite({ allowAA: true, fallbackToStandard: true });
    const exitWrite = useAdaptiveWrite({ allowAA: true, fallbackToStandard: true });

    const { writeContractAsync, isPending: isWritePending } = useWriteContract();
    const { writeContract: writeFinalize, data: finalizeHash, isPending: isFinalizePending, error: finalizeError } = useWriteContract();
    const { writeContract: writeRelease, data: releaseHash, isPending: isReleasePending, error: releaseError } = useWriteContract();
    const { writeContract: writeSeed, data: seedHash, isPending: isSeedPending, error: seedError } = useWriteContract();

    const bidError = bidWrite.error;
    const isBidPending = bidWrite.isPending;
    const isBidConfirming = bidWrite.isConfirming;
    const isBidSuccess = bidWrite.isConfirmed;

    const claimHash = claimWrite.txHash;
    const claimError = claimWrite.error;
    const isClaimPending = claimWrite.isPending;
    const isClaimConfirming = claimWrite.isConfirming;
    const isClaimSuccess = claimWrite.isConfirmed;

    const isExitPending = exitWrite.isPending;
    const isExitConfirming = exitWrite.isConfirming;
    const isExitSuccess = exitWrite.isConfirmed;

    // 5. Transaction Receipts
    const { isSuccess: isFinalizeSuccess, isLoading: isFinalizeConfirming } = useWaitForTransactionReceipt({ hash: finalizeHash });
    const { isSuccess: isReleaseSuccess, isLoading: isReleaseConfirming } = useWaitForTransactionReceipt({ hash: releaseHash });
    const { isSuccess: isSeedSuccess, isLoading: isSeedConfirming } = useWaitForTransactionReceipt({ hash: seedHash });

    useEffect(() => {
        if (isBidSuccess) {
            setBidAmount('');
            refetchPrice();
            refetchCleared();
            // Note: In production, we'd parse the BidSubmitted event to get bidId
        }
    }, [isBidSuccess, refetchPrice, refetchCleared]);

    useEffect(() => {
        if (isFinalizeSuccess) {
            refetchManagerAuction();
            refetchManagerPositionManager();
        }
    }, [isFinalizeSuccess, refetchManagerAuction, refetchManagerPositionManager]);

    useEffect(() => {
        if (isReleaseSuccess) {
            refetchManagerAuction();
        }
    }, [isReleaseSuccess, refetchManagerAuction]);

    useEffect(() => {
        if (isSeedSuccess) {
            refetchManagerAuction();
            refetchManagerLiquiditySeeded();
            refetchManagerPositionTokenId();
        }
    }, [isSeedSuccess, refetchManagerAuction, refetchManagerLiquiditySeeded, refetchManagerPositionTokenId]);

    useEffect(() => {
        if (!seedHash && !isSeedPending && !isSeedConfirming && !isSeedSuccess && !seedError) return;
        console.log('[Seed LP TX Monitor]', {
            seedHash: seedHash?.toString(),
            auctionAddress,
            liquidityManagerAddress,
            isSeedPending,
            isSeedConfirming,
            isSeedSuccess,
            seedError: seedError ? {
                name: seedError.name,
                message: seedError.message,
                shortMessage: (seedError as { shortMessage?: string }).shortMessage,
                details: (seedError as { details?: string }).details,
                cause: (seedError as { cause?: unknown }).cause
            } : undefined
        });
    }, [
        seedHash,
        auctionAddress,
        liquidityManagerAddress,
        isSeedPending,
        isSeedConfirming,
        isSeedSuccess,
        seedError
    ]);

    // Monitor claim transaction
    useEffect(() => {
        console.log('[Claim TX Monitor]', {
            claimHash: claimHash?.toString(),
            isClaimPending,
            isClaimConfirming,
            isClaimSuccess,
            claimError: claimError?.message
        });

        if (claimError) {
            console.error('[Claim TX] ERROR:', claimError);
            alert(`Claim failed: ${claimError.message || 'Unknown error'}`);
        }

        if (isClaimSuccess) {
            console.log('[Claim TX] SUCCESS! Transaction confirmed:', claimHash);
            alert('Tokens claimed successfully! 🎉');
        }
    }, [claimHash, isClaimPending, isClaimConfirming, isClaimSuccess, claimError]);

    useEffect(() => {
        if (seedError) {
            console.error('[Seed LP] ERROR:', seedError);
            alert(`Seed LP failed: ${seedError.message || 'Unknown error'}`);
        }
    }, [seedError]);

    useEffect(() => {
        if (!usesLegacyAuctionManager) return;
        console.warn('[Liquidity Manager] Auction pinned to legacy manager', {
            auctionAddress,
            auctionFundsRecipient,
            factoryLiquidityManagerAddress
        });
    }, [usesLegacyAuctionManager, auctionAddress, auctionFundsRecipient, factoryLiquidityManagerAddress]);

    // 6. Exit and Claim Flow
    // Monitor exit transaction
    useEffect(() => {
        if (isExitSuccess) {
            console.log('[Exit] SUCCESS! Bid exited, you can now claim.');
            alert('Bid exited successfully! You can now claim your tokens. 🎉');
        }
    }, [isExitSuccess]);

    // Handle exit bid (MUST be called before claiming)
    const handleExitBid = async () => {
        console.log('[Exit] Button clicked. State:', {
            auctionAddress,
            userAddress: address,
            lastBidId: lastBidId?.toString(),
        });

        if (!auctionAddress || !address || lastBidId === null) {
            console.error('[Exit] Missing required data');
            alert('Cannot exit: Missing auction address, wallet, or bid ID.');
            return;
        }

        try {
            console.log('[Exit] Calling exitBid for bidId:', lastBidId.toString());
            exitWrite.writeContract({
                address: auctionAddress,
                abi: CCA_ABI,
                functionName: 'exitBid',
                args: [lastBidId],
            });
            console.log('[Exit] writeExit called successfully');
        } catch (err) {
            console.error('[Exit] Error calling writeExit:', err);
            alert('Exit failed. Check console for error details.');
        }
    };

    // Handle claim tokens (AFTER exitBid)
    const handleClaim = async () => {
        console.log('[Claim] Button clicked. State:', {
            auctionAddress,
            userAddress: address,
            lastBidId: lastBidId?.toString(),
            userBids: userBids.map(b => b.toString()),
            isClaimPending,
            isClaimConfirming
        });

        if (!auctionAddress || !address || lastBidId === null) {
            console.error('[Claim] Missing required data:', { auctionAddress, address, lastBidId: lastBidId?.toString() });
            alert('Cannot claim: Missing auction address, wallet, or bid ID. Check console for details.');
            return;
        }

        try {
            console.log('[Claim] Calling claimTokens for bidId:', lastBidId.toString());
            claimWrite.writeContract({
                address: auctionAddress,
                abi: CCA_ABI,
                functionName: 'claimTokens',
                args: [lastBidId],
            });
            console.log('[Claim] writeClaim called successfully');
        } catch (err) {
            console.error('[Claim] Error calling writeClaim:', err);
            alert('Claim failed. Check console for error details.');
        }
    };

    const handleFinalizeAuction = () => {
        if (!hasLiquidityManager || !liquidityManagerAddress || !auctionAddress) {
            alert('Liquidity manager or auction address missing.');
            return;
        }

        writeFinalize({
            address: liquidityManagerAddress,
            abi: POST_AUCTION_LIQUIDITY_MANAGER_ABI,
            functionName: 'finalizeAuction',
            args: [auctionAddress],
        });
    };

    const handleReleaseLiquidity = () => {
        if (!hasLiquidityManager || !liquidityManagerAddress || !auctionAddress) {
            alert('Liquidity manager or auction address missing.');
            return;
        }

        const recipientCandidate = (lpRecipient || address || '').trim();
        if (!recipientCandidate || !recipientCandidate.startsWith('0x') || recipientCandidate.length !== 42) {
            alert('Enter a valid recipient address.');
            return;
        }

        let tokenAmountToRelease: bigint;
        try {
            tokenAmountToRelease = lpTokenAmount.trim()
                ? parseUnits(lpTokenAmount.trim(), 18)
                : managerLpTokenBudget;
        } catch {
            alert('Invalid token amount.');
            return;
        }

        if (tokenAmountToRelease <= BigInt(0)) {
            alert('Token amount must be greater than 0.');
            return;
        }

        writeRelease({
            address: liquidityManagerAddress,
            abi: POST_AUCTION_LIQUIDITY_MANAGER_ABI,
            functionName: 'releaseLiquidityAssets',
            args: [auctionAddress, recipientCandidate as `0x${string}`, tokenAmountToRelease],
        });
    };

    const handleSeedLiquidity = () => {
        if (!hasLiquidityManager || !liquidityManagerAddress || !auctionAddress) {
            alert('Liquidity manager or auction address missing.');
            return;
        }
        if (!managerHasPositionManager) {
            alert('Position manager is not configured on liquidity manager.');
            return;
        }

        const recipientCandidate = (lpRecipient || address || '').trim();
        if (!recipientCandidate || !recipientCandidate.startsWith('0x') || recipientCandidate.length !== 42) {
            alert('Enter a valid position recipient address.');
            return;
        }

        let tokenAmountToSeed: bigint;
        try {
            tokenAmountToSeed = lpTokenAmount.trim()
                ? parseUnits(lpTokenAmount.trim(), 18)
                : managerLpTokenBudget;
        } catch {
            alert('Invalid token amount.');
            return;
        }

        if (tokenAmountToSeed <= BigInt(0)) {
            alert('Token amount must be greater than 0.');
            return;
        }

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 60);
        console.log('[Seed LP] Requesting seedLiquidityFromClearingPrice', {
            auctionAddress,
            liquidityManagerAddress,
            recipient: recipientCandidate,
            tokenAmountToSeed: tokenAmountToSeed.toString(),
            deadline: deadline.toString(),
            managerLpCurrencyBudget: managerLpCurrencyBudget.toString(),
            managerLpTokenBudget: managerLpTokenBudget.toString(),
            managerPositionManager
        });

        writeSeed({
            address: liquidityManagerAddress,
            abi: POST_AUCTION_LIQUIDITY_MANAGER_ABI,
            functionName: 'seedLiquidityFromClearingPrice',
            args: [auctionAddress, recipientCandidate as `0x${string}`, tokenAmountToSeed, deadline],
        });
        console.log('[Seed LP] writeSeed dispatched');
    };

    // Multi-step approval flow for Permit2
    const handleApprove = async () => {
        if (!auctionAddress || !publicClient || !address) return;

        try {
            if (approvalStep === 'erc20') {
                // Step 1: Approve USDC to Permit2
                console.log('[Approve] Step 1: Approving USDC to Permit2...');
                const hash = await writeContractAsync({
                    address: USDC as `0x${string}`,
                    abi: ERC20_ABI,
                    functionName: 'approve',
                    args: [PERMIT2_ADDRESS, BigInt(2) ** BigInt(256) - BigInt(1)], // Max approval
                });
                console.log('[Approve] ERC20 approval tx:', hash);
                await publicClient.waitForTransactionReceipt({ hash });
                console.log('[Approve] ERC20 approval confirmed');
                setApprovalStep('permit2');
            }

            if (approvalStep === 'permit2' || approvalStep === 'erc20') {
                // Step 2: Set Permit2 allowance for auction
                console.log('[Approve] Step 2: Setting Permit2 allowance for auction...');
                const hash = await writeContractAsync({
                    address: PERMIT2_ADDRESS,
                    abi: PERMIT2_ABI,
                    functionName: 'approve',
                    args: [
                        USDC as `0x${string}`,
                        auctionAddress,
                        maxUint160,
                        Number(maxUint48)
                    ],
                });
                console.log('[Approve] Permit2 approval tx:', hash);
                await publicClient.waitForTransactionReceipt({ hash });
                console.log('[Approve] Permit2 approval confirmed');
                setApprovalStep('ready');
            }
        } catch (error) {
            console.error('[Approve] Error:', error);
        }
    };

    const handleBid = async () => {
        if (!auctionAddress || !address || !publicClient) return;

        try {
            // CCA expects amounts in currency decimals (USDC = 6)
            const bidAmountParsed = parseUnits(bidAmount, 6);

            // Fetch floorPrice and tickSpacing from the auction contract
            console.log('[Bid] Fetching auction parameters...');
            const [floorPrice, tickSpacing] = await Promise.all([
                publicClient.readContract({
                    address: auctionAddress,
                    abi: CCA_ABI,
                    functionName: 'floorPrice',
                }),
                publicClient.readContract({
                    address: auctionAddress,
                    abi: CCA_ABI,
                    functionName: 'tickSpacing',
                }),
            ]);
            console.log('[Bid] floorPrice:', floorPrice?.toString());
            console.log('[Bid] tickSpacing:', tickSpacing?.toString());

            // Calculate maxPrice as floorPrice + tickSpacing (bid at next possible price tick)
            // Per official docs: "maxPrice MUST be strictly above the current clearing price"
            const maxPriceQ96 = (floorPrice || BigInt(0)) + (tickSpacing || BigInt(0));
            console.log('[Bid] maxPriceQ96 (floorPrice + tickSpacing):', maxPriceQ96.toString());
            console.log('[Bid] Submitting bid:', {
                auctionAddress,
                maxPriceQ96: maxPriceQ96.toString(),
                amount: bidAmountParsed.toString(),
                owner: address
            });

            bidWrite.writeContract({
                address: auctionAddress,
                abi: CCA_ABI,
                functionName: 'submitBid',
                args: [
                    maxPriceQ96,
                    bidAmountParsed,
                    address,
                    "0x" as `0x${string}`
                ],
            });
        } catch (error) {
            console.error('[Bid] Error:', error);
        }
    };

    if (isAddressLoading) {
        return <div className="flex h-screen items-center justify-center bg-[#050505] text-zinc-500 font-mono"><Loader2 className="animate-spin mr-2" /> Loading Auction...</div>;
    }

    if (!auctionAddress || auctionAddress === '0x0000000000000000000000000000000000000000') {
        return (
            <div className="min-h-screen bg-[#050505] p-12 text-zinc-200 font-mono flex flex-col items-center">
                <Clock className="mb-4 text-zinc-600" />
                <h1 className="text-xl font-bold text-zinc-400">Auction Not Started</h1>
                <p className="text-zinc-500 mt-2">This agent has not launched a token auction yet.</p>
                <button onClick={() => router.push('/dashboard')} className="mt-8 text-xs underline text-zinc-500 hover:text-white">Return Home</button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#050505] text-zinc-200 font-sans selection:bg-teal-900/30 p-6 md:p-12">
            <div className="max-w-5xl mx-auto space-y-8">

                {/* Header */}
                <div className="flex justify-between items-start">
                    <div>
                        <button onClick={() => router.back()} className="text-xs font-mono text-zinc-500 hover:text-white mb-4 flex items-center gap-2">
                            <ArrowLeft size={12} /> Back
                        </button>
                        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
                            CCA Auction
                            <span className={`px-2 py-0.5 rounded border text-[10px] uppercase font-mono tracking-wider ${isAuctionActive ? 'bg-blue-900/20 border-blue-900/50 text-blue-500' : 'bg-red-900/20 border-red-900/50 text-red-500'}`}>
                                {isAuctionActive ? 'Live' : 'Ended'}
                            </span>
                        </h1>
                        <p className="text-sm font-mono text-zinc-500 mt-1">
                            Contract: {auctionAddress}
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="text-xs text-zinc-500 uppercase tracking-wider font-bold">Clearing Price</p>
                        <p className="text-3xl font-bold font-mono text-white mt-1">
                            {clearingPrice ? formatUnits(clearingPrice, 18) : '---'} <span className="text-lg text-zinc-600">USDC</span>
                        </p>
                    </div>
                </div>

                <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/20 text-xs">
                    <p className="text-zinc-300 font-semibold">Execution Mode: {bidWrite.modeLabel}</p>
                    {(bidWrite.warning || claimWrite.warning || exitWrite.warning) && (
                        <p className="text-amber-400 mt-1">{bidWrite.warning || claimWrite.warning || exitWrite.warning}</p>
                    )}
                </div>

                <div className="grid md:grid-cols-2 gap-8 items-start">

                    {/* Bidding Card */}
                    <div className="border border-white/5 bg-[#0a0a0a] rounded-lg overflow-hidden">
                        <div className="p-4 border-b border-white/5 bg-zinc-900/20 flex justify-between items-center">
                            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Place Bid</h2>
                            <Gavel size={14} className="text-zinc-600" />
                        </div>
                        <div className="p-6 space-y-6">
                            <div className="space-y-2">
                                <label className="text-xs text-zinc-400 font-medium">Bid Amount (USDC)</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        className="w-full bg-[#050505] border border-zinc-800 rounded px-3 py-3 text-lg text-white font-mono focus:outline-none focus:border-blue-900/50 focus:ring-1 focus:ring-blue-900/50 transition-colors placeholder-zinc-800"
                                        value={bidAmount}
                                        onChange={e => setBidAmount(e.target.value)}
                                        placeholder="0.00"
                                    />
                                    <span className="absolute right-4 top-4 text-xs font-bold text-zinc-600">USDC</span>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs text-zinc-400 font-medium">Max Willingness to Pay</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        className="w-full bg-[#050505] border border-zinc-800 rounded px-3 py-3 text-lg text-white font-mono focus:outline-none focus:border-blue-900/50 focus:ring-1 focus:ring-blue-900/50 transition-colors placeholder-zinc-800"
                                        value={maxPrice}
                                        onChange={e => setMaxPrice(e.target.value)}
                                        placeholder="0.00"
                                    />
                                    <span className="absolute right-4 top-4 text-xs font-bold text-zinc-600">USDC / Token</span>
                                </div>
                                <p className="text-[10px] text-zinc-600 bg-zinc-900/50 p-2 rounded">
                                    You will only pay the uniform clearing price, which is ≤ your max price.
                                </p>
                            </div>

                            {bidError && (
                                <div className="p-3 border border-red-900/50 bg-red-950/10 rounded flex items-start gap-2">
                                    <Activity className="text-red-500 h-4 w-4 mt-0.5 shrink-0" />
                                    <p className="text-xs text-red-400 font-mono break-all">{bidError.message.split('\n')[0]}</p>
                                </div>
                            )}

                            {isBidSuccess && (
                                <div className="p-3 border border-green-900/50 bg-green-950/10 rounded flex items-center gap-2">
                                    <CheckCircle className="text-green-500 h-4 w-4 shrink-0" />
                                    <p className="text-xs text-green-400 font-bold">Bid Submitted Successfully</p>
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t border-white/5 bg-zinc-900/10">
                            {approvalStep !== 'ready' ? (
                                <button
                                    onClick={handleApprove}
                                    disabled={!bidAmount || isWritePending}
                                    className="w-full py-3 bg-zinc-200 hover:bg-white text-black font-bold uppercase tracking-wider text-xs rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {isWritePending ? <Loader2 className="animate-spin h-3 w-3" /> : <Wallet className="h-3 w-3" />}
                                    {approvalStep === 'erc20' ? 'Approve USDC (Step 1/2)' : 'Approve Permit2 (Step 2/2)'}
                                </button>
                            ) : (
                                <>

                                    <button
                                        onClick={handleBid}
                                        disabled={!bidAmount || !maxPrice || isBidPending || isBidConfirming}
                                        className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase tracking-wider text-xs rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        {isBidPending || isBidConfirming ? <Loader2 className="animate-spin h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                                        Submit Bid
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Stats Card */}
                    <div className="space-y-6">
                        <div className="border border-white/5 bg-[#0a0a0a] rounded-lg overflow-hidden">
                            <div className="p-4 border-b border-white/5 bg-zinc-900/20">
                                <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Auction Stats</h2>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="flex justify-between items-center py-2 border-b border-white/5">
                                    <span className="text-xs text-zinc-500">Tokens Sold</span>
                                    <span className="font-mono text-zinc-200">{totalCleared ? formatUnits(totalCleared, 18) : '0'}</span>
                                </div>
                                <div className="flex justify-between items-center py-2 border-b border-white/5">
                                    <span className="text-xs text-zinc-500">Token Contract</span>
                                    <span className="font-mono text-xs text-zinc-400">{tokenAddress?.slice(0, 10)}...{tokenAddress?.slice(-8)}</span>
                                </div>
                                <div className="flex justify-between items-center py-2 border-b border-white/5">
                                    <span className="text-xs text-zinc-500">Status</span>
                                    <span className={`text-[10px] font-bold uppercase ${auctionStatusClass}`}>{auctionStatusLabel}</span>
                                </div>
                            </div>
                        </div>

                        <div className="p-4 rounded-lg border border-blue-900/20 bg-blue-950/5">
                            <h4 className="font-medium text-xs mb-2 flex items-center gap-2 text-blue-400 font-mono">
                                <Clock className="h-3 w-3" /> About Continuous Clearing
                            </h4>
                            <p className="text-[10px] text-zinc-500 leading-relaxed">
                                Unlike traditional auctions, CCA discovers a price continuously with every block.
                                Bids are filled from highest to lowest. The clearing price adjusts dynamically based on demand.
                                This ensures fair price discovery and prevents front-running.
                            </p>
                        </div>

                        {/* Claim Tokens Card (Only show when auction ended) */}
                        {!isAuctionActive && isAuctionEnded && (
                            <div className="border border-white/5 bg-[#0a0a0a] rounded-lg overflow-hidden animate-in fade-in duration-500">
                                <div className="p-4 border-b border-white/5 bg-zinc-900/20">
                                    <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Claim Tokens</h2>
                                </div>
                                <div className="p-4 space-y-4">
                                    <div className="flex justify-between items-center py-2 border-b border-white/5">
                                        <span className="text-xs text-zinc-500">Claim Block</span>
                                        <span className="font-mono text-zinc-200">{claimBlock?.toString() || 'Loading...'}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-2 border-b border-white/5">
                                        <span className="text-xs text-zinc-500">End Block</span>
                                        <span className="font-mono text-zinc-200">{endBlock?.toString() || 'Loading...'}</span>
                                    </div>

                                    <div>
                                        <label className="block text-[10px] text-zinc-500 mb-2 uppercase tracking-wider">Select Bid to Claim</label>

                                        {userBids.length > 0 ? (
                                            <div className="relative">
                                                <select
                                                    className="w-full bg-zinc-900 border border-white/10 rounded p-3 text-sm font-mono focus:outline-none focus:border-teal-500/50 appearance-none text-zinc-300"
                                                    value={lastBidId?.toString() || ''}
                                                    onChange={e => setLastBidId(BigInt(e.target.value))}
                                                >
                                                    {userBids.map(bidId => (
                                                        <option key={bidId.toString()} value={bidId.toString()}>
                                                            Bid #{bidId.toString()}
                                                        </option>
                                                    ))}
                                                </select>
                                                <div className="absolute right-3 top-3.5 pointer-events-none">
                                                    <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="p-3 bg-zinc-900/50 border border-white/5 rounded text-xs text-zinc-500 italic text-center">
                                                No claimable bids found.
                                            </div>
                                        )}

                                        <p className="text-[10px] text-zinc-600 mt-2 flex items-center justify-between">
                                            <span>Check BidSubmitted event</span>
                                            {userBids.length > 0 && <span className="text-teal-500/80">{userBids.length} active bid(s)</span>}
                                        </p>
                                    </div>

                                    {/* Instructions */}
                                    <div className="p-3 bg-blue-950/10 border border-blue-900/20 rounded text-[10px] text-blue-300 leading-relaxed">
                                        <strong className="block mb-1">📋 Two-Step Process:</strong>
                                        <ol className="list-decimal list-inside space-y-1 text-zinc-400">
                                            <li>Click <strong className="text-blue-400">&quot;Exit Bid&quot;</strong> to finalize settlement</li>
                                            <li>After confirmation, click <strong className="text-teal-400">&quot;Claim Tokens&quot;</strong></li>
                                        </ol>
                                    </div>

                                    {isClaimSuccess && (
                                        <div className="p-3 border border-green-900/50 bg-green-950/10 rounded flex items-center gap-2">
                                            <CheckCircle className="text-green-500 h-4 w-4 shrink-0" />
                                            <p className="text-xs text-green-400 font-bold">Tokens Claimed Successfully</p>
                                        </div>
                                    )}
                                </div>
                                <div className="p-4 border-t border-white/5 bg-zinc-900/10 space-y-2">
                                    <button
                                        onClick={handleExitBid}
                                        disabled={lastBidId === null || isExitPending || isExitConfirming || isExitSuccess}
                                        className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase tracking-wider text-xs rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isExitPending || isExitConfirming ? <Loader2 className="animate-spin h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
                                        {isExitSuccess ? '✅ Bid Exited' : 'Step 1: Exit Bid'}
                                    </button>
                                    <button
                                        onClick={handleClaim}
                                        disabled={!isExitSuccess || lastBidId === null || isClaimPending || isClaimConfirming}
                                        className="w-full py-3 bg-teal-600 hover:bg-teal-500 text-white font-bold uppercase tracking-wider text-xs rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isClaimPending || isClaimConfirming ? <Loader2 className="animate-spin h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
                                        Step 2: Claim Tokens
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Admin-only Post-Auction Settlement */}
                        {isAdmin && (
                            <div className="border border-yellow-900/20 bg-yellow-950/5 rounded-lg overflow-hidden">
                                <div className="p-4 border-b border-yellow-900/20 bg-zinc-900/20">
                                    <h2 className="text-xs font-bold uppercase tracking-widest text-yellow-400">Admin: Post-Auction Settlement</h2>
                                </div>
                                <div className="p-4 space-y-3">
                                    <div className="text-[10px] text-zinc-500 font-mono break-all">
                                        Manager: {hasLiquidityManager ? liquidityManagerAddress : 'Not configured'}
                                    </div>
                                    <div className="text-[10px] text-zinc-500 font-mono break-all">
                                        Position Manager: {managerHasPositionManager ? managerPositionManager : 'Not configured'}
                                    </div>
                                    <div className="text-[10px] text-zinc-500">
                                        Primary path: Finalize Auction → Seed LP (V4). Release LP Assets is fallback/manual.
                                    </div>
                                    {usesLegacyAuctionManager && (
                                        <div className="rounded border border-amber-800 bg-amber-950/40 p-2 text-[10px] text-amber-300">
                                            Legacy manager detected for this auction. Seed LP can fail on this auction; new auctions use the latest factory manager.
                                        </div>
                                    )}
                                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                                        <div className="p-2 border border-white/5 rounded bg-zinc-900/40">
                                            <div className="text-zinc-500">Registered</div>
                                            <div className={managerRegistered ? 'text-teal-400 font-bold' : 'text-zinc-400'}>
                                                {managerRegistered ? 'YES' : 'NO'}
                                            </div>
                                        </div>
                                        <div className="p-2 border border-white/5 rounded bg-zinc-900/40">
                                            <div className="text-zinc-500">Finalized</div>
                                            <div className={managerFinalized ? 'text-teal-400 font-bold' : 'text-zinc-400'}>
                                                {managerFinalized ? 'YES' : 'NO'}
                                            </div>
                                        </div>
                                        <div className="p-2 border border-white/5 rounded bg-zinc-900/40">
                                            <div className="text-zinc-500">Released</div>
                                            <div className={managerReleased ? 'text-teal-400 font-bold' : 'text-zinc-400'}>
                                                {managerReleased ? 'YES' : 'NO'}
                                            </div>
                                        </div>
                                        <div className="p-2 border border-white/5 rounded bg-zinc-900/40">
                                            <div className="text-zinc-500">LP Seeded</div>
                                            <div className={managerSeeded ? 'text-teal-400 font-bold' : 'text-zinc-400'}>
                                                {managerSeeded ? 'YES' : 'NO'}
                                            </div>
                                        </div>
                                        <div className="p-2 border border-white/5 rounded bg-zinc-900/40">
                                            <div className="text-zinc-500">Raised (USDC)</div>
                                            <div className="text-zinc-200 font-mono">{formatUnits(managerCurrencyRaised, 6)}</div>
                                        </div>
                                        <div className="p-2 border border-white/5 rounded bg-zinc-900/40">
                                            <div className="text-zinc-500">LP USDC Budget</div>
                                            <div className="text-zinc-200 font-mono">{formatUnits(managerLpCurrencyBudget, 6)}</div>
                                        </div>
                                        <div className="p-2 border border-white/5 rounded bg-zinc-900/40">
                                            <div className="text-zinc-500">LP Token Budget</div>
                                            <div className="text-zinc-200 font-mono">{formatUnits(managerLpTokenBudget, 18)}</div>
                                        </div>
                                        <div className="p-2 border border-white/5 rounded bg-zinc-900/40">
                                            <div className="text-zinc-500">LP Position ID</div>
                                            <div className="text-zinc-200 font-mono">{managerPositionId.toString()}</div>
                                        </div>
                                    </div>

                                    {(finalizeError || releaseError || seedError) && (
                                        <div className="text-xs text-red-400 border border-red-900/40 bg-red-950/10 rounded p-2">
                                            {(finalizeError?.message || releaseError?.message || seedError?.message || '').split('\n')[0]}
                                        </div>
                                    )}

                                    {(isFinalizeSuccess || isReleaseSuccess || isSeedSuccess) && (
                                        <div className="text-xs text-green-400 border border-green-900/40 bg-green-950/10 rounded p-2">
                                            {isSeedSuccess
                                                ? 'LP seeded on Uniswap v4 successfully.'
                                                : (isReleaseSuccess ? 'LP assets released successfully.' : 'Auction finalized successfully.')}
                                        </div>
                                    )}

                                    <button
                                        onClick={handleFinalizeAuction}
                                        disabled={!hasLiquidityManager || !isAuctionEnded || managerFinalized || isFinalizePending || isFinalizeConfirming}
                                        className="w-full py-2.5 bg-yellow-600 hover:bg-yellow-500 text-black font-bold uppercase tracking-wider text-xs rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isFinalizePending || isFinalizeConfirming ? <Loader2 className="animate-spin h-3 w-3" /> : null}
                                        {managerFinalized ? 'Auction Finalized' : 'Finalize Auction'}
                                    </button>

                                    <div className="space-y-2">
                                        <input
                                            type="text"
                                            value={lpRecipient}
                                            onChange={(e) => setLpRecipient(e.target.value)}
                                            placeholder={address || 'LP recipient address'}
                                            className="w-full bg-[#050505] border border-zinc-800 rounded px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-yellow-900/50"
                                        />
                                        <input
                                            type="number"
                                            value={lpTokenAmount}
                                            onChange={(e) => setLpTokenAmount(e.target.value)}
                                            placeholder={`Token amount (default full: ${formatUnits(managerLpTokenBudget, 18)})`}
                                            className="w-full bg-[#050505] border border-zinc-800 rounded px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-yellow-900/50"
                                        />
                                        <button
                                            onClick={handleSeedLiquidity}
                                            disabled={
                                                !hasLiquidityManager
                                                || !managerHasPositionManager
                                                || !managerFinalized
                                                || managerReleased
                                                || managerLpCurrencyBudget <= BigInt(0)
                                                || isSeedPending
                                                || isSeedConfirming
                                            }
                                            className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold uppercase tracking-wider text-xs rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isSeedPending || isSeedConfirming ? <Loader2 className="animate-spin h-3 w-3" /> : null}
                                            {isSeedSuccess ? 'LP Seeded' : 'Seed LP (V4)'}
                                        </button>
                                        <button
                                            onClick={handleReleaseLiquidity}
                                            disabled={!hasLiquidityManager || !managerFinalized || managerReleased || isReleasePending || isReleaseConfirming}
                                            className="w-full py-2.5 bg-zinc-200 hover:bg-white text-black font-bold uppercase tracking-wider text-xs rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isReleasePending || isReleaseConfirming ? <Loader2 className="animate-spin h-3 w-3" /> : null}
                                            {managerReleased ? 'Liquidity Released' : 'Release LP Assets (Fallback)'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Timer Card (Only show when active) */}
                        {isAuctionActive && (
                            <div className="border border-white/5 bg-[#0a0a0a] rounded-lg overflow-hidden">
                                <div className="p-4 border-b border-white/5 bg-zinc-900/20">
                                    <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Time Remaining</h2>
                                </div>
                                <div className="p-6 flex flex-col items-center justify-center text-center">
                                    <div className="text-3xl font-mono text-zinc-200 font-bold mb-2">
                                        {timeLeftString}
                                    </div>
                                    <p className="text-xs text-zinc-500">
                                        Ends at block {endBlock?.toString()}
                                    </p>
                                    <p className="text-[10px] text-zinc-600 mt-4 max-w-[200px]">
                                        Tokens will be claimable after the auction ends.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
