// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/identity/OwnerBadge.sol";
import "../src/staking/TruthStake.sol";
import "../src/resolvers/MockResolver.sol";
import "../src/interfaces/IIdentityRegistry.sol";

/**
 * @title TestDeployment
 * @notice Test script to verify deployed contracts work with ERC-8004
 */
contract TestDeployment is Script {
    // Deployed contract addresses
    address constant OWNER_BADGE = 0x71e0519383D186db44921B508CCb597C9d351462;
    address constant MOCK_RESOLVER = 0x27f5A684Cb372Da83bb5F5AfD27D2c08AA5Bb6b6;
    address constant TRUTH_STAKE = 0x266Ec894b8C29088625dD9FA2423dd110B4Fb269;
    
    // ERC-8004 addresses
    address constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Testing from:", deployer);
        console.log("");
        
        // 1. Test OwnerBadge - Mint a badge
        console.log("=== Testing OwnerBadge ===");
        OwnerBadge ownerBadge = OwnerBadge(OWNER_BADGE);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Check if already has badge
        bool hasBadge = ownerBadge.hasBadge(deployer);
        if (!hasBadge) {
            ownerBadge.mint();
            console.log("Minted OwnerBadge!");
        } else {
            console.log("Already has OwnerBadge");
        }
        uint256 badgeId = ownerBadge.ownerToBadge(deployer);
        console.log("Badge ID:", badgeId);
        
        vm.stopBroadcast();
        
        // 2. Test ERC-8004 Identity Registry (read-only)
        console.log("");
        console.log("=== Testing ERC-8004 Identity Registry ===");
        IIdentityRegistry identityRegistry = IIdentityRegistry(IDENTITY_REGISTRY);
        
        // Try to check if we have an agent (this is a read call)
        // Note: You need to register an agent via the ERC-8004 SDK first
        console.log("Identity Registry address:", IDENTITY_REGISTRY);
        console.log("(To test TruthStake claims, you need an agent registered in ERC-8004)");
        
        // 3. Test TruthStake config (read-only)
        console.log("");
        console.log("=== Testing TruthStake ===");
        TruthStake truthStake = TruthStake(TRUTH_STAKE);
        console.log("Min stake:", truthStake.minStake());
        console.log("Slash percent:", truthStake.slashPercent());
        console.log("Resolver:", address(truthStake.resolver()));
        
        console.log("");
        console.log("=== TEST COMPLETE ===");
    }
}
