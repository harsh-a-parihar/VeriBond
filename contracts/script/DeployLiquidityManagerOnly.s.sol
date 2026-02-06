// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console2} from "forge-std/Script.sol";
import {PostAuctionLiquidityManager} from "../src/tokenization/PostAuctionLiquidityManager.sol";

interface IAgentTokenFactoryOwner {
    function setLiquidityManager(address manager) external;
}

contract DeployLiquidityManagerOnly is Script {
    address internal constant FACTORY = 0x0Cc680A41227B0f641C9fd5537f0fdc2834f6942;
    address internal constant V4_POSITION_MANAGER = 0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80;
    uint256 internal constant MAX_LP_CURRENCY_FOR_TEST = 50e6; // 50 USDC

    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(privateKey);

        vm.startBroadcast(privateKey);

        PostAuctionLiquidityManager manager = new PostAuctionLiquidityManager(FACTORY, MAX_LP_CURRENCY_FOR_TEST);
        manager.setPositionManager(V4_POSITION_MANAGER);
        manager.setPoolConfig(10_000, 60, address(0));
        IAgentTokenFactoryOwner(FACTORY).setLiquidityManager(address(manager));

        vm.stopBroadcast();

        console2.log("Deployer:", deployer);
        console2.log("Factory:", FACTORY);
        console2.log("LiquidityManager:", address(manager));
        console2.log("PositionManager:", V4_POSITION_MANAGER);
    }
}
