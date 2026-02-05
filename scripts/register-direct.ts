/**
 * Direct ERC-8004 Agent Registration for Base Sepolia
 * 
 * Bypasses the Agent0 SDK since it doesn't support Base Sepolia.
 * Directly calls the Identity Registry contract.
 * 
 * Run: npm run register-direct
 */

import 'dotenv/config';
import { createWalletClient, createPublicClient, http, parseAbi, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import * as fs from 'fs';

// ERC-8004 Identity Registry on Base Sepolia
const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';

// ABI for Identity Registry (minimal for registration)
const IDENTITY_ABI = parseAbi([
    'function register(string calldata agentURI) external returns (uint256)',
    'function setAgentWallet(uint256 agentId, address wallet) external',
    'function getAgentWallet(uint256 agentId) external view returns (address)',
    'function ownerOf(uint256 tokenId) external view returns (address)',
    'function balanceOf(address owner) external view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

// Agent Configuration
const AGENT_CONFIG = {
    name: 'veribond-prediction-agent',
    description: 'A prediction agent for VeriBond - making accountable predictions on-chain',
    image: 'https://raw.githubusercontent.com/base-org/brand-kit/main/logo/symbol/Base_Symbol_Blue.png',
};

async function uploadToIPFS(data: object, pinataJwt: string): Promise<string> {
    console.log('📤 Uploading to IPFS via Pinata...');

    const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${pinataJwt}`,
        },
        body: JSON.stringify({
            pinataContent: data,
            pinataMetadata: {
                name: 'agent-registration.json',
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`Pinata upload failed: ${response.statusText}`);
    }

    const result = await response.json();
    const cid = result.IpfsHash;
    console.log('   CID:', cid);
    return `ipfs://${cid}`;
}

async function main() {
    console.log('🚀 Direct ERC-8004 Agent Registration');
    console.log('=====================================\n');

    // Load credentials
    const privateKeyRaw = process.env.PRIVATE_KEY;
    if (!privateKeyRaw) throw new Error('PRIVATE_KEY not set in .env');
    const privateKey = privateKeyRaw.startsWith('0x') ? privateKeyRaw : `0x${privateKeyRaw}`;

    const pinataJwt = process.env.PINATA_JWT;
    if (!pinataJwt) throw new Error('PINATA_JWT not set in .env');

    // Set up viem
    const account = privateKeyToAccount(privateKey as `0x${string}`);

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

    // Check if already registered
    const balance = await publicClient.readContract({
        address: IDENTITY_REGISTRY,
        abi: IDENTITY_ABI,
        functionName: 'balanceOf',
        args: [account.address],
    });

    console.log('📊 Current agent count for wallet:', balance.toString());

    // Create agent metadata (ERC-8004 format)
    const agentMetadata = {
        name: AGENT_CONFIG.name,
        description: AGENT_CONFIG.description,
        image: AGENT_CONFIG.image,
        endpoints: [
            {
                type: 'A2A',
                value: 'https://veribond.example.com/.well-known/agent-card.json',
            },
        ],
        trustModels: ['reputation', 'crypto-economic'],
        active: true,
        updatedAt: Math.floor(Date.now() / 1000),
    };

    // Upload to IPFS
    const agentURI = await uploadToIPFS(agentMetadata, pinataJwt);
    console.log('📄 Agent URI:', agentURI);

    // Register on-chain
    console.log('\n⛓️  Registering agent on Base Sepolia...');

    const hash = await walletClient.writeContract({
        address: IDENTITY_REGISTRY,
        abi: IDENTITY_ABI,
        functionName: 'register',
        args: [agentURI],
    });

    console.log('📝 Transaction hash:', hash);
    console.log('⏳ Waiting for confirmation...');

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    // Extract agent ID from logs (Transfer event)
    const transferLog = receipt.logs.find(log =>
        log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    );

    const agentId = transferLog ? BigInt(transferLog.topics[3] || '0') : BigInt(0);

    console.log('\n✅ Agent registered successfully!');
    console.log('═══════════════════════════════════════════════');
    console.log('🆔 Agent ID:', agentId.toString());
    console.log('📄 Agent URI:', agentURI);
    console.log('🔗 Block:', receipt.blockNumber);
    console.log('═══════════════════════════════════════════════\n');

    console.log('🌐 View your agent:');
    console.log(`   https://www.8004scan.io/agents/base-sepolia/${agentId}`);
    console.log('');

    // Try to set agent wallet (optional - not all ERC-8004 implementations support this)
    console.log('🔐 Setting agent wallet...');
    try {
        const setWalletHash = await walletClient.writeContract({
            address: IDENTITY_REGISTRY,
            abi: IDENTITY_ABI,
            functionName: 'setAgentWallet',
            args: [agentId, account.address],
        });
        await publicClient.waitForTransactionReceipt({ hash: setWalletHash });
        console.log('✅ Agent wallet set to:', account.address);
    } catch (error) {
        console.log('⚠️  setAgentWallet not supported or failed (this is optional)');
        console.log('   Agent owner is already:', account.address);
    }

    // Save agent ID
    fs.writeFileSync('.agent-id', agentId.toString());
    console.log('\n💾 Agent ID saved to .agent-id file');
    console.log('\n📋 Next step: npm run test-claim-flow');
}

main().catch((error) => {
    console.error('❌ Registration failed:', error.message || error);
    process.exit(1);
});
