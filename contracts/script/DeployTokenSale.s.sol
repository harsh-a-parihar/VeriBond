// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console2} from "forge-std/Script.sol";
import {AgentTokenFactory} from "../src/tokenization/AgentTokenFactory.sol";
import {PostAuctionLiquidityManager} from "../src/tokenization/PostAuctionLiquidityManager.sol";

/**
 * @title DeployTokenSale
 * @notice Deploy AgentTokenFactory integrated with official Uniswap CCA
 */
contract DeployTokenSale is Script {
    // Base Sepolia addresses
    address constant CCA_FACTORY = 0xCCccCcCAE7503Cac057829BF2811De42E16e0bD5;
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    uint256 constant MAX_LP_CURRENCY_FOR_TEST = 50e6; // 50 USDC (6 decimals)

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console2.log("Deploying from:", deployer);
        console2.log("CCA Factory:", CCA_FACTORY);
        console2.log("USDC:", USDC);
        console2.log("Identity Registry:", IDENTITY_REGISTRY);

        vm.startBroadcast(deployerPrivateKey);

        PostAuctionLiquidityManager manager = new PostAuctionLiquidityManager(
            deployer,
            MAX_LP_CURRENCY_FOR_TEST
        );
        console2.log("PostAuctionLiquidityManager deployed:", address(manager));

        AgentTokenFactory factory = new AgentTokenFactory(
            CCA_FACTORY,
            IDENTITY_REGISTRY,
            USDC
        );
        
        console2.log("AgentTokenFactory deployed:", address(factory));

        factory.setLiquidityManager(address(manager));
        manager.setFactory(address(factory));

        console2.log("Liquidity manager wired into factory");

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Deployment Complete ===");
        console2.log("Factory:", address(factory));
        console2.log("LiquidityManager:", address(manager));
    }
}
