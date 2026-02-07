// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/naming/VeriBondRegistrar.sol";

/**
 * @title DeployVeriBondRegistrar
 * @notice Deploy script for VeriBondRegistrar (Durin L2 Subnames)
 * @dev Requires L2Registry address from durin.dev deployment
 * 
 * Usage:
 * 1. Deploy L2Registry via durin.dev for okayrohannn.eth
 * 2. Set L2_REGISTRY_ADDRESS in .env
 * 3. Run: forge script script/DeployVeriBondRegistrar.s.sol --rpc-url base-sepolia --broadcast
 */
contract DeployVeriBondRegistrar is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        // L2Registry deployed for veribond.basetest.eth
        address l2Registry = 0xC0b5837dB1001C45f5EFA77BfEE21999d850Ea0f;
        
        // Parent node = namehash("veribond.basetest.eth")
        // Calculate: keccak256(namehash("basetest.eth"), keccak256("veribond"))
        // For simplicity, we'll pass bytes32(0) and let the registry handle it
        bytes32 parentNode = bytes32(0);
        
        vm.startBroadcast(deployerPrivateKey);
        
        VeriBondRegistrar registrar = new VeriBondRegistrar(l2Registry, parentNode);
        
        console.log("VeriBondRegistrar deployed at:", address(registrar));
        console.log("L2Registry:", l2Registry);
        
        // Note: After this, call addRegistrar() on the L2Registry
        console.log("");
        console.log("Next: Call addRegistrar() on L2Registry with this address");
        
        vm.stopBroadcast();
    }
}
