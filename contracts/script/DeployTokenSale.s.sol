// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console2} from "forge-std/Script.sol";
import {AgentTokenFactory} from "../src/tokenization/AgentTokenFactory.sol";

/**
 * @title DeployTokenSale
 * @notice Deploy AgentTokenFactory integrated with official Uniswap CCA
 */
contract DeployTokenSale is Script {
    // Base Sepolia addresses
    address constant CCA_FACTORY = 0xCCccCcCAE7503Cac057829BF2811De42E16e0bD5;
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console2.log("Deploying from:", deployer);
        console2.log("CCA Factory:", CCA_FACTORY);
        console2.log("USDC:", USDC);
        console2.log("Identity Registry:", IDENTITY_REGISTRY);

        vm.startBroadcast(deployerPrivateKey);

        AgentTokenFactory factory = new AgentTokenFactory(
            CCA_FACTORY,
            IDENTITY_REGISTRY,
            USDC
        );
        
        console2.log("AgentTokenFactory deployed:", address(factory));

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Deployment Complete ===");
        console2.log("Factory:", address(factory));
    }
}
