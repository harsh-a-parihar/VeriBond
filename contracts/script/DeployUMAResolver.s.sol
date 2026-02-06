// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/resolvers/UMAResolver.sol";

/**
 * @title DeployUMAResolver
 * @notice Deploys UMAResolver to Base Sepolia
 *
 * Usage:
 * forge script script/DeployUMAResolver.s.sol --rpc-url base-sepolia --broadcast --verify
 */
contract DeployUMAResolver is Script {
    // UMA Base Sepolia addresses
    address constant UMA_OPTIMISTIC_ORACLE_V3 = 0x0F7fC5E6482f096380db6158f978167b57388deE;
    address constant UMA_TESTNET_ERC20 = 0x7E6d9618Ba8a87421609352d6e711958A97e2512;
    
    // VeriBond contracts
    address constant TRUTH_STAKE = 0x2bB50E9092f368A5B7491Dd905445c4FF6602D0A;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying UMAResolver...");
        console.log("Deployer:", deployer);
        console.log("UMA OOV3:", UMA_OPTIMISTIC_ORACLE_V3);
        console.log("Bond Token:", UMA_TESTNET_ERC20);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy UMAResolver
        UMAResolver resolver = new UMAResolver(
            UMA_OPTIMISTIC_ORACLE_V3,
            UMA_TESTNET_ERC20
        );
        
        console.log("UMAResolver deployed at:", address(resolver));
        console.log("Default liveness:", resolver.liveness());
        console.log("Minimum bond:", resolver.getMinBond());

        vm.stopBroadcast();

        // Instructions for post-deployment
        console.log("");
        console.log("=== NEXT STEPS ===");
        console.log("1. Update frontend/src/lib/contracts.ts with UMAResolver address");
        console.log("2. Call TruthStake.setResolver(UMAResolver) to switch from MockResolver");
        console.log("3. Mint some UMA TestnetERC20 tokens for bond payments");
        console.log("");
        console.log("To switch TruthStake to use UMAResolver:");
        console.log("  cast send", TRUTH_STAKE, "\"setResolver(address)\"", address(resolver));
    }
}
