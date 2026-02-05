/**
 * Set Agent Wallet Script
 * 
 * Sets the agent wallet address in ERC-8004 Identity Registry.
 * The agent wallet is the address that can make claims on behalf of the agent.
 * 
 * Run: npm run set-agent-wallet
 */

import 'dotenv/config';
import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import fs from 'fs';

// ERC-8004 Identity Registry on Base Sepolia
const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';

// Minimal ABI for setAgentWallet (simple version without signature)
const IDENTITY_ABI = parseAbi([
    'function setAgentWallet(uint256 agentId, address wallet) external',
    'function getAgentWallet(uint256 agentId) external view returns (address)',
    'function ownerOf(uint256 tokenId) external view returns (address)',
]);

async function main() {
    console.log('🔐 Set Agent Wallet');
    console.log('===================\n');

    // Load private key
    const privateKeyRaw = process.env.PRIVATE_KEY;
    console.log('🔑 Private Key:', privateKeyRaw);
    const privateKey = privateKeyRaw?.startsWith('0x') ? privateKeyRaw.slice(2) : privateKeyRaw;
    console.log('🔑 Private Key:', privateKey);
    if (!privateKey) {
        throw new Error('PRIVATE_KEY not set in .env');
    }

    // Load agent ID
    let agentId;
    try {
        agentId = fs.readFileSync('.agent-id', 'utf8').trim();
    } catch {
        throw new Error('Agent ID not found. Run "npm run register-agent" first.');
    }

    console.log('📋 Agent ID:', agentId);

    // Set up viem clients
    const account = privateKeyToAccount(`0x${privateKey}`);

    const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http('https://sepolia.base.org'),
    });

    const walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http('https://sepolia.base.org'),
    });

    // Check ownership
    const owner = await publicClient.readContract({
        address: IDENTITY_REGISTRY,
        abi: IDENTITY_ABI,
        functionName: 'ownerOf',
        args: [BigInt(agentId)],
    });

    console.log('👤 Agent Owner:', owner);
    console.log('🔑 Your Address:', account.address);

    if (owner.toLowerCase() !== account.address.toLowerCase()) {
        throw new Error('You are not the owner of this agent');
    }

    // Check current agent wallet
    const currentWallet = await publicClient.readContract({
        address: IDENTITY_REGISTRY,
        abi: IDENTITY_ABI,
        functionName: 'getAgentWallet',
        args: [BigInt(agentId)],
    });

    console.log('📍 Current Agent Wallet:', currentWallet);

    // For demo, we'll use the same wallet as owner (you can change this)
    const newAgentWallet = process.env.AGENT_WALLET || account.address;
    console.log('🎯 New Agent Wallet:', newAgentWallet);

    if (currentWallet.toLowerCase() === newAgentWallet.toLowerCase()) {
        console.log('✅ Agent wallet already set correctly!');
        return;
    }

    // Set agent wallet
    console.log('\n⛓️  Setting agent wallet on-chain...');

    const hash = await walletClient.writeContract({
        address: IDENTITY_REGISTRY,
        abi: IDENTITY_ABI,
        functionName: 'setAgentWallet',
        args: [BigInt(agentId), newAgentWallet],
    });

    console.log('📝 Transaction hash:', hash);
    console.log('⏳ Waiting for confirmation...');

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log('✅ Agent wallet set successfully!');
    console.log('🔗 Block:', receipt.blockNumber);
    console.log('');
    console.log('📋 Next step: npm run test-claim-flow');
}

main().catch((error) => {
    console.error('❌ Failed:', error.message || error);
    process.exit(1);
});
