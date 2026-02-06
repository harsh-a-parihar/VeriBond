// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/naming/AgentNames.sol";

contract DeployAgentNames is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address identityRegistry = vm.envAddress("IDENTITY_REGISTRY_ADDRESS");
        
        vm.startBroadcast(deployerPrivateKey);
        
        AgentNames agentNames = new AgentNames(identityRegistry);
        
        console.log("AgentNames deployed at:", address(agentNames));
        
        vm.stopBroadcast();
    }
}
