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
    address constant OWNER_BADGE = 0x8FAeFb6dc94DFf0215F263944722dcBd8E160bd7;
    address constant MOCK_RESOLVER = 0x422dDE9a26B33e1782106b2239a8C029Cb514F93;
    address constant TRUTH_STAKE = 0x2bB50E9092f368A5B7491Dd905445c4FF6602D0A;
    
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
