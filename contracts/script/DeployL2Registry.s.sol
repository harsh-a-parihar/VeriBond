// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

/**
 * @title IL2RegistryFactory
 * @notice Interface for Durin's L2RegistryFactory
 */
interface IL2RegistryFactory {
    function deployRegistry(
        string calldata name,
        string memory symbol,
        string memory baseURI,
        address admin
    ) external returns (address);
    
    function deployRegistry(string calldata name) external returns (address);
}

/**
 * @title DeployL2Registry
 * @notice Deploy a Durin L2Registry for veribond.basetest.eth on Base Sepolia
 * 
 * Usage:
 * forge script script/DeployL2Registry.s.sol --rpc-url https://sepolia.base.org --broadcast
 */
contract DeployL2Registry is Script {
    // Durin L2RegistryFactory on Base Sepolia
    address constant FACTORY = 0xDddddDdDDD8Aa1f237b4fa0669cb46892346d22d;
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.addr(deployerPrivateKey);
        
        string memory name = "veribond.basetest.eth";
        string memory symbol = "VERIBOND";
        string memory baseURI = "https://veribond.xyz/api/metadata/";
        
        console.log("Deploying L2Registry for:", name);
        console.log("Admin:", admin);
        
        vm.startBroadcast(deployerPrivateKey);
        
        IL2RegistryFactory factory = IL2RegistryFactory(FACTORY);
        
        address registry = factory.deployRegistry(name, symbol, baseURI, admin);
        
        console.log("");
        console.log("=== SUCCESS ===");
        console.log("L2Registry deployed at:", registry);
        console.log("");
        console.log("Next steps:");
        console.log("1. Update L2_REGISTRY_ADDRESS in contracts/.env");
        console.log("2. Deploy VeriBondRegistrar");
        console.log("3. Call addRegistrar() on L2Registry");
        
        vm.stopBroadcast();
    }
}
