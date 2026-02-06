/**
 * Full Claim Flow Test Script
 * 
 * Tests the complete VeriBond flow:
 * 1. Approve USDC to TruthStake
 * 2. Submit a claim as the agent wallet
 * 3. Set outcome in MockResolver (as admin)
 * 4. Resolve the claim
 * 
 * Run: npm run test-claim-flow
 */

import 'dotenv/config';
import { createWalletClient, createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import fs from 'fs';

// ============================================================================
// Contract Addresses (Base Sepolia)
// ============================================================================

const CONTRACTS = {
    TRUTH_STAKE: '0x2bb50e9092f368a5b7491dd905445c4ff6602d0a',
    MOCK_RESOLVER: '0x422dde9a26b33e1782106b2239a8c029cb514f93',
    OWNER_BADGE: '0x8faefb6dc94dff0215f263944722dcbd8e160bd7',
    USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    IDENTITY_REGISTRY: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
};

// ============================================================================
// ABIs
// ============================================================================

const USDC_ABI = parseAbi([
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function balanceOf(address account) external view returns (uint256)',
    'function allowance(address owner, address spender) external view returns (uint256)',
]);

const TRUTH_STAKE_ABI = parseAbi([
    'function submitClaim(uint256 agentId, bytes32 claimHash, uint256 stake, uint256 resolvesAt, bool predictedOutcome) external returns (bytes32)',
    'function resolve(bytes32 claimId) external',
    'function getClaim(bytes32 claimId) external view returns ((uint256 agentId, address submitter, bytes32 claimHash, uint256 stake, uint256 submittedAt, uint256 resolvesAt, bool predictedOutcome, bool resolved, bool wasCorrect))',
    'function getAgentAccuracy(uint256 agentId) external view returns (uint256 correct, uint256 total)',
    'function minStake() external view returns (uint256)',
]);

const MOCK_RESOLVER_ABI = parseAbi([
    'function setOutcome(bytes32 claimId, bool outcome) external',
    'function canResolve(bytes32 claimId) external view returns (bool)',
]);

const IDENTITY_ABI = parseAbi([
    'function getAgentWallet(uint256 agentId) external view returns (address)',
]);

// ============================================================================
// Main Test Flow
// ============================================================================

async function main() {
    console.log('🧪 VeriBond Full Claim Flow Test');
    console.log('=================================\n');

    // Load credentials
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error('PRIVATE_KEY not set in .env');

    // Load agent ID
    let agentId;
    try {
        agentId = fs.readFileSync('.agent-id', 'utf8').trim();
    } catch {
        throw new Error('Agent ID not found. Run "npm run register-agent" first.');
    }

    console.log('📋 Agent ID:', agentId);

    // Set up clients
    const account = privateKeyToAccount(privateKey.startsWith('0x') ? `0x${privateKey.slice(2)}` : `0x${privateKey}`);

    const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http('https://sepolia.base.org'),
    });

    const walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http('https://sepolia.base.org'),
    });

    console.log('🔑 Wallet:', account.address);

    // =========================================================================
    // Step 1: Check Agent Wallet Authorization
    // =========================================================================
    console.log('\n📍 Step 1: Checking agent wallet authorization...');

    const agentWallet = await publicClient.readContract({
        address: CONTRACTS.IDENTITY_REGISTRY,
        abi: IDENTITY_ABI,
        functionName: 'getAgentWallet',
        args: [BigInt(agentId)],
    });

    console.log('   Agent Wallet:', agentWallet);

    if (agentWallet.toLowerCase() !== account.address.toLowerCase()) {
        throw new Error(`Your wallet is not the authorized agent wallet. Expected: ${agentWallet}`);
    }
    console.log('   ✅ Wallet authorized');

    // =========================================================================
    // Step 2: Check USDC Balance
    // =========================================================================
    console.log('\n💰 Step 2: Checking USDC balance...');

    const usdcBalance = await publicClient.readContract({
        address: CONTRACTS.USDC,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [account.address],
    });

    console.log('   Balance:', formatUnits(usdcBalance, 6), 'USDC');

    const minStake = await publicClient.readContract({
        address: CONTRACTS.TRUTH_STAKE,
        abi: TRUTH_STAKE_ABI,
        functionName: 'minStake',
    });

    console.log('   Min Stake:', formatUnits(minStake, 6), 'USDC');

    if (usdcBalance < minStake) {
        console.log('\n⚠️  Insufficient USDC balance!');
        console.log('   Get test USDC from: https://faucet.circle.com/');
        throw new Error('Insufficient USDC balance');
    }
    console.log('   ✅ Sufficient balance');

    // =========================================================================
    // Step 3: Approve USDC
    // =========================================================================
    console.log('\n🔓 Step 3: Approving USDC to TruthStake...');

    const stakeAmount = minStake; // Use minimum stake for test

    const currentAllowance = await publicClient.readContract({
        address: CONTRACTS.USDC,
        abi: USDC_ABI,
        functionName: 'allowance',
        args: [account.address, CONTRACTS.TRUTH_STAKE],
    });

    if (currentAllowance < stakeAmount) {
        const approveHash = await walletClient.writeContract({
            address: CONTRACTS.USDC,
            abi: USDC_ABI,
            functionName: 'approve',
            args: [CONTRACTS.TRUTH_STAKE, stakeAmount * 10n], // Approve extra
        });
        console.log('   Approve tx:', approveHash);
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        console.log('   ✅ Approved');
    } else {
        console.log('   ✅ Already approved');
    }

    // =========================================================================
    // Step 4: Submit Claim
    // =========================================================================
    console.log('\n📝 Step 4: Submitting claim...');

    // Create a unique claim hash
    const claimHash = `0x${Buffer.from(`ETH>3000:${Date.now()}`).toString('hex').padEnd(64, '0')}`;
    const resolvesAt = BigInt(Math.floor(Date.now() / 1000) + 60); // Resolves in 60 seconds
    const predictedOutcome = true;

    console.log('   Claim Hash:', claimHash.slice(0, 20) + '...');
    console.log('   Stake:', formatUnits(stakeAmount, 6), 'USDC');
    console.log('   Prediction: TRUE (ETH > $3000)');

    const submitHash = await walletClient.writeContract({
        address: CONTRACTS.TRUTH_STAKE,
        abi: TRUTH_STAKE_ABI,
        functionName: 'submitClaim',
        args: [BigInt(agentId), claimHash, stakeAmount, resolvesAt, predictedOutcome],
    });

    console.log('   Submit tx:', submitHash);
    const submitReceipt = await publicClient.waitForTransactionReceipt({ hash: submitHash });

    // Get claim ID from logs - look for ClaimSubmitted event
    // event ClaimSubmitted(bytes32 indexed claimId, uint256 indexed agentId, address submitter, bytes32 claimHash, uint256 stake)
    // Event signature: keccak256("ClaimSubmitted(bytes32,uint256,address,bytes32,uint256)")
    const claimSubmittedTopic = '0x0c5d0b7f16e7e44f6d3c73e6f88f0b9f3e6f0b9f3e6f0b9f3e6f0b9f3e6f0b9f'; // We'll find it by matching

    // Find the log from TruthStake contract
    const truthStakeLog = submitReceipt.logs.find(log =>
        log.address.toLowerCase() === CONTRACTS.TRUTH_STAKE.toLowerCase()
    );

    if (!truthStakeLog || !truthStakeLog.topics[1]) {
        throw new Error('Could not find ClaimSubmitted event in transaction logs');
    }

    const claimId = truthStakeLog.topics[1];
    console.log('   Claim ID:', claimId);
    console.log('   ✅ Claim submitted');

    // =========================================================================
    // Step 5: Set Outcome (Admin)
    // =========================================================================
    console.log('\n🎯 Step 5: Setting outcome in MockResolver (admin)...');

    const setOutcomeHash = await walletClient.writeContract({
        address: CONTRACTS.MOCK_RESOLVER,
        abi: MOCK_RESOLVER_ABI,
        functionName: 'setOutcome',
        args: [claimHash, true], // Agent predicted TRUE, we make it TRUE (correct!)
    });

    console.log('   SetOutcome tx:', setOutcomeHash);
    await publicClient.waitForTransactionReceipt({ hash: setOutcomeHash });
    console.log('   ✅ Outcome set: TRUE (agent was CORRECT)');

    // =========================================================================
    // Step 6: Wait for Resolution Time
    // =========================================================================
    console.log('\n⏰ Step 6: Waiting for resolution time...');
    const waitTime = 65; // seconds
    for (let i = waitTime; i > 0; i -= 5) {
        process.stdout.write(`   Waiting ${i}s...  \r`);
        await new Promise(r => setTimeout(r, 5000));
    }
    console.log('   ✅ Resolution time reached     ');

    // =========================================================================
    // Step 7: Resolve Claim
    // =========================================================================
    console.log('\n⚖️ Step 7: Resolving claim...');

    const balanceBefore = await publicClient.readContract({
        address: CONTRACTS.USDC,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [account.address],
    });

    if (!claimId) {
        throw new Error('Could not extract claimId from transaction logs');
    }

    const resolveHash = await walletClient.writeContract({
        address: CONTRACTS.TRUTH_STAKE,
        abi: TRUTH_STAKE_ABI,
        functionName: 'resolve',
        args: [claimId as `0x${string}`], // Use actual claimId from the event, not claimHash
    });

    console.log('   Resolve tx:', resolveHash);
    await publicClient.waitForTransactionReceipt({ hash: resolveHash });

    const balanceAfter = await publicClient.readContract({
        address: CONTRACTS.USDC,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [account.address],
    });

    const gained = balanceAfter - balanceBefore;
    console.log('   ✅ Claim resolved');
    console.log('   💰 USDC returned:', formatUnits(BigInt(gained), 6));

    // =========================================================================
    // Step 8: Check Agent Accuracy
    // =========================================================================
    console.log('\n📊 Step 8: Checking agent accuracy...');

    const [correct, total] = await publicClient.readContract({
        address: CONTRACTS.TRUTH_STAKE,
        abi: TRUTH_STAKE_ABI,
        functionName: 'getAgentAccuracy',
        args: [BigInt(agentId)],
    });

    console.log('   Correct claims:', correct.toString());
    console.log('   Total claims:', total.toString());
    console.log('   Accuracy:', total > 0n ? `${(Number(correct) / Number(total) * 100).toFixed(1)}%` : 'N/A');

    // =========================================================================
    // Done!
    // =========================================================================
    console.log('\n═══════════════════════════════════════════════');
    console.log('🎉 FULL CLAIM FLOW TEST COMPLETE!');
    console.log('═══════════════════════════════════════════════');
    console.log('');
    console.log('📋 Summary:');
    console.log(`   Agent ID: ${agentId}`);
    console.log(`   Claim submitted, resolved correctly`);
    console.log(`   Stake returned: ${formatUnits(BigInt(gained), 6)} USDC`);
    console.log('');
}

main().catch((error) => {
    console.error('❌ Test failed:', error.message || error);
    process.exit(1);
});
