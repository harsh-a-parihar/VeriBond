/**
 * VeriBond Agent Registration Script
 * 
 * Registers an agent in the ERC-8004 Identity Registry using Agent0 SDK
 * 
 * Requirements:
 * - PRIVATE_KEY in .env
 * - PINATA_JWT in .env (for IPFS uploads)
 * 
 * Run: npm run register-agent
 */

import 'dotenv/config';
import { SDK } from 'agent0-sdk';
import fs from 'fs';

// Agent Configuration for VeriBond
const AGENT_CONFIG = {
  name: 'veribond-prediction-agent',
  description: 'A prediction agent for VeriBond - making accountable predictions on-chain',
  image: 'https://raw.githubusercontent.com/base-org/brand-kit/main/logo/symbol/Base_Symbol_Blue.png',
  a2aEndpoint: 'https://veribond.example.com/.well-known/agent-card.json',
  mcpEndpoint: 'https://veribond.example.com/mcp',
};

// Chain configuration - Base Sepolia
const CHAIN_CONFIG = {
  chainId: 84532,  // Base Sepolia
  rpcUrl: process.env.RPC_URL || 'https://sepolia.base.org',
};

async function main() {
  console.log('🚀 VeriBond Agent Registration');
  console.log('================================\n');

  // Validate environment
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY not set in .env');
  }

  const pinataJwt = process.env.PINATA_JWT;
  if (!pinataJwt) {
    throw new Error('PINATA_JWT not set in .env');
  }

  // Initialize SDK for Base Sepolia
  console.log('🔧 Initializing Agent0 SDK for Base Sepolia...');
  const sdk = new SDK({
    chainId: CHAIN_CONFIG.chainId,
    rpcUrl: CHAIN_CONFIG.rpcUrl,
    signer: privateKey,
    ipfs: 'pinata',
    pinataJwt,
  });

  // Create agent
  console.log('📝 Creating agent:', AGENT_CONFIG.name);
  const agent = sdk.createAgent(
    AGENT_CONFIG.name,
    AGENT_CONFIG.description,
    AGENT_CONFIG.image
  );

  // Configure endpoints
  console.log('🔗 Setting endpoints...');
  await agent.setA2A(AGENT_CONFIG.a2aEndpoint);
  await agent.setMCP(AGENT_CONFIG.mcpEndpoint);

  // Configure trust models
  console.log('🔐 Setting trust models...');
  agent.setTrust(true, true, true);

  // Set as active for testing
  agent.setActive(true);
  agent.setX402Support(false);

  // Register on-chain with IPFS
  console.log('\n⛓️  Registering agent on Base Sepolia...');
  console.log('   1. Minting agent NFT on-chain');
  console.log('   2. Uploading metadata to IPFS');
  console.log('   3. Setting agent URI on-chain\n');

  // Register on-chain with IPFS (v1.5.2 returns result directly)
  const txHandle = await agent.registerIPFS();

  console.log('📦 Transaction submitted:', txHandle.hash);
  console.log('⏳ Waiting for confirmation...\n');

  const { receipt, result: registrationFile } = await txHandle.waitMined();

  // Log full result for debugging
  console.log('\n📋 Full Registration Result:');
  console.log(JSON.stringify(registrationFile, null, 2));
  console.log('');

  // Output results
  console.log('✅ Agent registered successfully!\n');
  console.log('═══════════════════════════════════════════════');
  console.log('🆔 Agent ID:', registrationFile.meta?.id);
  console.log('📄 Transaction Hash:', receipt.transactionHash);
  console.log('═══════════════════════════════════════════════\n');

  // Extract numeric ID from the result
  const agentIdNum = registrationFile.meta?.id?.toString().split(':').pop() || registrationFile.meta?.id || 'unknown';

  console.log('🌐 View your agent:');
  console.log(`   https://www.8004scan.io/agents/base-sepolia/${agentIdNum}`);
  console.log('');
  console.log('📋 Next steps:');
  console.log('   1. Run: npm run set-agent-wallet');
  console.log('   2. Fund agent wallet with test USDC');
  console.log('   3. Run: npm run test-claim-flow');
  console.log('');

  // Save agent ID to file for other scripts
  const fs = await import('fs');
  fs.writeFileSync('.agent-id', agentIdNum.toString());
  console.log('💾 Agent ID saved to .agent-id file');
}

main().catch((error) => {
  console.error('❌ Registration failed:', error.message || error);
  process.exit(1);
});
