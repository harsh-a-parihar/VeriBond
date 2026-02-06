
import { createPublicClient, http, formatUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import { TRUTH_STAKE_ABI, UMA_RESOLVER_ABI, ERC20_ABI } from './lib/abis';
import { CONTRACTS } from './lib/contracts';

const CLAIM_HASH = '0x5af56418cce01bcc8018237fb9f46250a90537288eb99b0813618b308e1ef9b2';

async function main() {
    const client = createPublicClient({
        chain: baseSepolia,
        transport: http(),
    });

    console.log('--- Debugging Claim State ---');
    console.log('Claim Hash:', CLAIM_HASH);

    // 1. Check TruthStake Claim
    try {
        const claim = await client.readContract({
            address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
            abi: TRUTH_STAKE_ABI,
            functionName: 'getClaim',
            args: [CLAIM_HASH],
        });
        console.log('TruthStake Claim:', {
            agentId: claim.agentId.toString(),
            stake: formatUnits(claim.stake, 6),
            resolvesAt: new Date(Number(claim.resolvesAt) * 1000).toLocaleString(),
            resolved: claim.resolved,
            resolvesAtTimestamp: claim.resolvesAt.toString(),
            currentTimestamp: Math.floor(Date.now() / 1000).toString(),
        });

        if (Number(claim.resolvesAt) > Math.floor(Date.now() / 1000)) {
            console.error('ERROR: Claim resolvesAt is in the future!');
        }
    } catch (e) {
        console.error('Failed to read TruthStake claim:', e);
    }

    // 2. Check UMA Resolver Status
    try {
        const [pending, resolved, outcome, id] = await client.readContract({
            address: CONTRACTS.UMA_RESOLVER as `0x${string}`,
            abi: UMA_RESOLVER_ABI,
            functionName: 'getAssertionStatus',
            args: [CLAIM_HASH],
        });
        console.log('UMA Resolver Status:', { pending, resolved, outcome, id });

        if (!resolved) {
            console.error('ERROR: UMA assertion is NOT resolved!');
        }
    } catch (e) {
        console.error('Failed to read UMA status:', e);
    }

    // 3. Check TruthStake USDC Balance
    try {
        const balance = await client.readContract({
            address: CONTRACTS.USDC as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [CONTRACTS.TRUTH_STAKE as `0x${string}`],
        });
        console.log('TruthStake USDC Balance:', formatUnits(balance, 6));

        // Assume claim stake is 3 USDC
        if (balance < 3000000n) {
            console.error('ERROR: TruthStake does not have enough funds!');
        }
    } catch (e) {
        console.error('Failed to read USDC balance:', e);
    }
}

main();
