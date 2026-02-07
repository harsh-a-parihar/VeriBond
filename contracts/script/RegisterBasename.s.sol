// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

/**
 * @title IBaseRegistrar
 * @notice Interface for Basenames RegistrarController on Base Sepolia
 */
interface IBaseRegistrar {
    struct RegisterRequest {
        string name;
        address owner;
        uint256 duration;
        address resolver;
        bytes[] data;
        bool reverseRecord;
    }
    
    function register(RegisterRequest calldata request) external payable;
    function registerPrice(string memory name, uint256 duration) external view returns (uint256);
}

/**
 * @title RegisterBasename
 * @notice Script to register a Basename on Base Sepolia
 * 
 * Usage:
 * 1. Set PRIVATE_KEY and BASENAME in .env
 * 2. Run: forge script script/RegisterBasename.s.sol --rpc-url base-sepolia --broadcast
 */
contract RegisterBasename is Script {
    // Basenames RegistrarController on Base Sepolia
    address constant REGISTRAR = 0x49aE3cC2e3AA768B1e5654f5D3C6002144A59581;
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        string memory basename = vm.envOr("BASENAME", string("veribond"));
        address owner = vm.addr(deployerPrivateKey);
        
        // 1 year duration
        uint256 duration = 365 days;
        
        console.log("Registering Basename:", basename);
        console.log("Owner:", owner);
        console.log("Duration:", duration, "seconds (1 year)");
        
        vm.startBroadcast(deployerPrivateKey);
        
        IBaseRegistrar registrar = IBaseRegistrar(REGISTRAR);
        
        // Get price
        uint256 price = registrar.registerPrice(basename, duration);
        console.log("Price:", price, "wei");
        
        // Create registration request
        bytes[] memory data = new bytes[](0);
        IBaseRegistrar.RegisterRequest memory request = IBaseRegistrar.RegisterRequest({
            name: basename,
            owner: owner,
            duration: duration,
            resolver: address(0), // Use default resolver
            data: data,
            reverseRecord: false  // Disable to avoid revert - can set manually later
        });
        
        // Register with some extra ETH for safety
        registrar.register{value: price + 0.001 ether}(request);
        
        console.log("SUCCESS! Registered:", string.concat(basename, ".basetest.eth"));
        
        vm.stopBroadcast();
    }
}
