import { NextRequest, NextResponse } from 'next/server';
import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { VERIBOND_REGISTRAR } from '@/lib/contracts';

const REGISTRAR_ABI = parseAbi([
    'function claimName(uint256 agentId, string label, address agentWallet, uint256 trustScore) external',
    'function agentToNode(uint256 agentId) view returns (bytes32)',
    'function labelTaken(string label) view returns (bool)',
]);
const CLAIM_NAME_MIN_TRUST = 10;

export async function POST(request: NextRequest) {
    try {
        const { agentId, label, agentWallet, trustScore } = await request.json();
        const normalizedLabel = String(label ?? '').trim().toLowerCase();

        // Validate inputs
        if (!agentId || !normalizedLabel || !agentWallet) {
            return NextResponse.json(
                { error: 'Missing required fields: agentId, label, agentWallet' },
                { status: 400 }
            );
        }

        // Validate label (3-32 chars, lowercase alphanumeric + hyphen)
        const labelRegex = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
        if (!labelRegex.test(normalizedLabel)) {
            return NextResponse.json(
                { error: 'Invalid label. Must be 3-32 chars, lowercase alphanumeric and hyphens only.' },
                { status: 400 }
            );
        }

        // Trust score check
        const score = Number(trustScore) || 0;
        if (score < CLAIM_NAME_MIN_TRUST) {
            return NextResponse.json(
                { error: `Trust score (${score}) must be >= ${CLAIM_NAME_MIN_TRUST} to claim a name.` },
                { status: 400 }
            );
        }

        // Get private key from env
        const privateKey = process.env.PRIVATE_KEY;
        if (!privateKey) {
            return NextResponse.json(
                { error: 'Server configuration error: missing private key' },
                { status: 500 }
            );
        }

        // Create clients
        const account = privateKeyToAccount(privateKey as `0x${string}`);
        const publicClient = createPublicClient({
            chain: baseSepolia,
            transport: http(),
        });
        const walletClient = createWalletClient({
            account,
            chain: baseSepolia,
            transport: http(),
        });

        // Check if label is already taken
        const labelTaken = await publicClient.readContract({
            address: VERIBOND_REGISTRAR as `0x${string}`,
            abi: REGISTRAR_ABI,
            functionName: 'labelTaken',
            args: [normalizedLabel],
        });

        if (labelTaken) {
            return NextResponse.json(
                { error: `Name "${normalizedLabel}.veribond.basetest.eth" is already taken.` },
                { status: 409 }
            );
        }

        // Check if agent already has a name
        const existingNode = await publicClient.readContract({
            address: VERIBOND_REGISTRAR as `0x${string}`,
            abi: REGISTRAR_ABI,
            functionName: 'agentToNode',
            args: [BigInt(agentId)],
        });

        if (existingNode && existingNode !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
            return NextResponse.json(
                { error: 'Agent already has a claimed name.' },
                { status: 409 }
            );
        }

        // Call claimName on the registrar
        const hash = await walletClient.writeContract({
            address: VERIBOND_REGISTRAR as `0x${string}`,
            abi: REGISTRAR_ABI,
            functionName: 'claimName',
            args: [BigInt(agentId), normalizedLabel, agentWallet as `0x${string}`, BigInt(score)],
        });

        // Wait for confirmation
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        if (receipt.status === 'reverted') {
            return NextResponse.json(
                { error: 'Transaction reverted on-chain.' },
                { status: 500 }
            );
        }

        // Best-effort DB update to avoid stale UI before indexer catches the NameClaimed event.
        if (process.env.DATABASE_URL) {
            try {
                const { default: pool } = await import('@/lib/db');
                await pool.query(
                    'UPDATE agents SET claimed_name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                    [String(agentId), normalizedLabel],
                );
            } catch (dbError) {
                console.warn('[Claim Name API] DB update skipped:', dbError);
            }
        }

        const fullName = `${normalizedLabel}.veribond.basetest.eth`;

        return NextResponse.json({
            success: true,
            name: fullName,
            label: normalizedLabel,
            transactionHash: hash,
            message: `Successfully claimed ${fullName}!`,
        });

    } catch (error: unknown) {
        console.error('[Claim Name API] Error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: `Failed to claim name: ${message}` },
            { status: 500 }
        );
    }
}
