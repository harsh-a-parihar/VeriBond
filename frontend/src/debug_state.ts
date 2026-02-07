
import { createPublicClient, http, formatUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import { TRUTH_STAKE_ABI, UMA_RESOLVER_ABI, ERC20_ABI, OPTIMISTIC_ORACLE_V3_ABI } from './lib/abis';
import { CONTRACTS, UMA_RESOLVER, UMA_OPTIMISTIC_ORACLE_V3 } from './lib/contracts';

const CLAIM_ID_KEY = '0x5af56418cce01bcc8018237fb9f46250a90537288eb99b0813618b308e1ef9b2';
const EXPECTED_CONTENT_HASH = '0xdc05c98c0480916e385bc5ea24fb5968d9ed7fdf6f2c1ca5bf4236419ba3d687';

async function main() {
    const client = createPublicClient({
        chain: baseSepolia,
        transport: http(),
    });

    console.log('--- Debugging Content Hash State ---');
    console.log('TruthStake Key:', CLAIM_ID_KEY);
    console.log('Expected Content Hash:', EXPECTED_CONTENT_HASH);

    // 1. Check TruthStake Claim (Using KEY)
    let contentHashFromChain = '';
    try {
        const claim = await client.readContract({
            address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
            abi: TRUTH_STAKE_ABI,
            functionName: 'getClaim',
            args: [CLAIM_ID_KEY],
        });

        contentHashFromChain = claim.claimHash;
        console.log('TruthStake Claim Hash:', contentHashFromChain);

        if (contentHashFromChain !== EXPECTED_CONTENT_HASH) {
            console.error('MISMATCH: Chain content hash differs from expected!');
        } else {
            console.log('MATCH: Content Hash confirmed.');
        }

    } catch (e) {
        console.error('Failed to read TruthStake claim:', e);
    }

    if (!contentHashFromChain) {
        console.error('Cannot proceed without content hash.');
        return;
    }

    // 2. Check UMA Resolver STATUS (Using CONTENT HASH)
    let assertionId = '';
    try {
        const [pending, resolved, outcome, id] = await client.readContract({
            address: UMA_RESOLVER as `0x${string}`,
            abi: UMA_RESOLVER_ABI,
            functionName: 'getAssertionStatus',
            args: [contentHashFromChain as `0x${string}`],
        });
        console.log('UMA Resolver Status (Content Hash):', { pending, resolved, outcome, id });
        assertionId = id;

        if (pending) {
            console.log('STATUS: PENDING. Timer should be visible.');
        } else if (resolved) {
            console.log('STATUS: RESOLVED. Settle should be enabled (or already settled).');
        } else {
            console.log('STATUS: UNKNOWN (Not Pending, Not Resolved). likely not requested yet.');
        }

    } catch (e) {
        console.error('Failed to read UMA status:', e);
    }

    // 3. Check OOV3 Assertion Details (Using Fixed ABI)
    if (assertionId && assertionId !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
        try {
            const assertion = await client.readContract({
                address: UMA_OPTIMISTIC_ORACLE_V3 as `0x${string}`,
                abi: OPTIMISTIC_ORACLE_V3_ABI,
                functionName: 'getAssertion',
                args: [assertionId as `0x${string}`],
            });
            console.log('OOV3 Assertion (Fixed ABI):', {
                expirationTime: assertion.expirationTime.toString(),
                assertionTime: assertion.assertionTime.toString(),
                now: Math.floor(Date.now() / 1000).toString(),
            });

            const exp = Number(assertion.expirationTime);
            const now = Math.floor(Date.now() / 1000);
            if (exp > now) {
                console.log(`LIVENESS: Remaining ${exp - now} seconds.`);
            } else {
                console.log('LIVENESS: EXPIRED. Ready to Settle.');
            }

        } catch (e) {
            console.error('Failed to read OOV3 assertion (Fixed ABI):', e);
        }
    }
}

main();
