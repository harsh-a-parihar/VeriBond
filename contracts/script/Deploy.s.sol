// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/identity/OwnerBadge.sol";
import "../src/staking/TruthStake.sol";
import "../src/resolvers/MockResolver.sol";

/**
 * @title Deploy
 * @notice Deployment script for VeriBond contracts to Base Sepolia
 * @dev Uses official ERC-8004 registries deployed on Base Sepolia
 */
contract Deploy is Script {
    // ============ Base Sepolia Addresses ============
    
    // Official ERC-8004 Registries
    address constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;
    
    // USDC on Base Sepolia (Circle's test USDC)
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying from:", deployer);
        console.log("Chain ID:", block.chainid);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // 1. Deploy OwnerBadge (Soulbound identity for owners)
        OwnerBadge ownerBadge = new OwnerBadge();
        console.log("OwnerBadge deployed:", address(ownerBadge));
        
        // 2. Deploy MockResolver (Oracle for demo)
        MockResolver resolver = new MockResolver();
        console.log("MockResolver deployed:", address(resolver));
        
        // 3. Deploy TruthStake (Core staking contract)
        // Uses deployer as slash treasury for now
        TruthStake truthStake = new TruthStake(
            USDC,
            IDENTITY_REGISTRY,
            REPUTATION_REGISTRY,
            address(resolver),
            deployer  // Slash treasury = deployer for now
        );
        console.log("TruthStake deployed:", address(truthStake));
        
        vm.stopBroadcast();
        
        // Log summary
        console.log("\n========== DEPLOYMENT COMPLETE ==========");
        console.log("OwnerBadge:     ", address(ownerBadge));
        console.log("MockResolver:   ", address(resolver));
        console.log("TruthStake:     ", address(truthStake));
        console.log("\nExternal (ERC-8004):");
        console.log("IdentityRegistry:   ", IDENTITY_REGISTRY);
        console.log("ReputationRegistry: ", REPUTATION_REGISTRY);
        console.log("USDC:               ", USDC);
        console.log("==========================================\n");
    }
}
