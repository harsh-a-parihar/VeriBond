import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

function loadArtifact(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    abi: parsed.abi,
    bytecode: parsed.bytecode.object.startsWith('0x')
      ? parsed.bytecode.object
      : `0x${parsed.bytecode.object}`,
  };
}

async function deployContract({ walletClient, publicClient, account, artifact, args = [], nonce }) {
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
    account,
    chain: baseSepolia,
    nonce,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error(`No contractAddress in receipt for tx ${hash}`);
  }
  return receipt.contractAddress;
}

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const privateKeyEnv = process.env.PRIVATE_KEY;
  if (!rpcUrl) throw new Error('RPC_URL is required');
  if (!privateKeyEnv) throw new Error('PRIVATE_KEY is required');

  const privateKey = privateKeyEnv.startsWith('0x') ? privateKeyEnv : `0x${privateKeyEnv}`;
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(rpcUrl),
  });
  let nextNonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: 'pending',
  });

  const repoRoot = resolve(process.cwd(), '..');
  const artifactsRoot = resolve(repoRoot, 'contracts', 'out');

  const ownerBadgeArtifact = loadArtifact(resolve(artifactsRoot, 'OwnerBadge.sol', 'OwnerBadge.json'));
  const mockResolverArtifact = loadArtifact(resolve(artifactsRoot, 'MockResolver.sol', 'MockResolver.json'));
  const truthStakeArtifact = loadArtifact(resolve(artifactsRoot, 'TruthStake.sol', 'TruthStake.json'));
  const managerArtifact = loadArtifact(resolve(artifactsRoot, 'PostAuctionLiquidityManager.sol', 'PostAuctionLiquidityManager.json'));
  const factoryArtifact = loadArtifact(resolve(artifactsRoot, 'AgentTokenFactory.sol', 'AgentTokenFactory.json'));

  const constants = {
    IDENTITY_REGISTRY: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    REPUTATION_REGISTRY: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    CCA_FACTORY: '0xCCccCcCAE7503Cac057829BF2811De42E16e0bD5',
    MAX_LP_CURRENCY_FOR_TEST: 50_000_000n,
  };

  console.log(`Deployer: ${account.address}`);
  console.log(`Chain: Base Sepolia (${baseSepolia.id})`);

  const ownerBadge = await deployContract({
    walletClient,
    publicClient,
    account,
    artifact: ownerBadgeArtifact,
    nonce: nextNonce++,
  });
  console.log(`OwnerBadge: ${ownerBadge}`);

  const mockResolver = await deployContract({
    walletClient,
    publicClient,
    account,
    artifact: mockResolverArtifact,
    nonce: nextNonce++,
  });
  console.log(`MockResolver: ${mockResolver}`);

  const truthStake = await deployContract({
    walletClient,
    publicClient,
    account,
    artifact: truthStakeArtifact,
    args: [
      constants.USDC,
      constants.IDENTITY_REGISTRY,
      constants.REPUTATION_REGISTRY,
      mockResolver,
      account.address,
    ],
    nonce: nextNonce++,
  });
  console.log(`TruthStake: ${truthStake}`);

  const postAuctionLiquidityManager = await deployContract({
    walletClient,
    publicClient,
    account,
    artifact: managerArtifact,
    args: [account.address, constants.MAX_LP_CURRENCY_FOR_TEST],
    nonce: nextNonce++,
  });
  console.log(`PostAuctionLiquidityManager: ${postAuctionLiquidityManager}`);

  const agentTokenFactory = await deployContract({
    walletClient,
    publicClient,
    account,
    artifact: factoryArtifact,
    args: [constants.CCA_FACTORY, constants.IDENTITY_REGISTRY, constants.USDC],
    nonce: nextNonce++,
  });
  console.log(`AgentTokenFactory: ${agentTokenFactory}`);

  // Wire factory <-> manager
  const setLiquidityManagerData = {
    address: agentTokenFactory,
    abi: factoryArtifact.abi,
    functionName: 'setLiquidityManager',
    args: [postAuctionLiquidityManager],
    account,
    chain: baseSepolia,
    nonce: nextNonce++,
  };
  const tx1 = await walletClient.writeContract(setLiquidityManagerData);
  await publicClient.waitForTransactionReceipt({ hash: tx1 });

  const setFactoryData = {
    address: postAuctionLiquidityManager,
    abi: managerArtifact.abi,
    functionName: 'setFactory',
    args: [agentTokenFactory],
    account,
    chain: baseSepolia,
    nonce: nextNonce++,
  };
  const tx2 = await walletClient.writeContract(setFactoryData);
  await publicClient.waitForTransactionReceipt({ hash: tx2 });

  console.log('Wiring complete');

  const deployment = {
    chainId: baseSepolia.id,
    chainName: 'base-sepolia',
    deployedAt: new Date().toISOString(),
    deployer: account.address,
    addresses: {
      OWNER_BADGE: ownerBadge,
      MOCK_RESOLVER: mockResolver,
      TRUTH_STAKE: truthStake,
      AGENT_TOKEN_FACTORY: agentTokenFactory,
      POST_AUCTION_LIQUIDITY_MANAGER: postAuctionLiquidityManager,
      IDENTITY_REGISTRY: constants.IDENTITY_REGISTRY,
      REPUTATION_REGISTRY: constants.REPUTATION_REGISTRY,
      USDC: constants.USDC,
      CCA_FACTORY: constants.CCA_FACTORY,
    },
  };

  const outputPath = resolve(repoRoot, 'contracts', 'deployments.base-sepolia.latest.json');
  writeFileSync(outputPath, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`Deployment manifest written: ${outputPath}`);
  console.log(JSON.stringify(deployment.addresses, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
