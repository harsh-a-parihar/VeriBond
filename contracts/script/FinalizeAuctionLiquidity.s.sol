// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console2} from "forge-std/Script.sol";
import {PostAuctionLiquidityManager} from "../src/tokenization/PostAuctionLiquidityManager.sol";

/**
 * @title FinalizeAuctionLiquidity
 * @notice Finalizes post-CCA settlement and optionally releases LP assets.
 *
 * Environment:
 * - PRIVATE_KEY (required)
 * - LIQUIDITY_MANAGER (required)
 * - AUCTION (required)
 * - LP_RECIPIENT (optional, defaults to broadcaster)
 * - LP_TOKEN_AMOUNT (optional, defaults to full lpTokenBudget after finalize)
 */
contract FinalizeAuctionLiquidity is Script {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address broadcaster = vm.addr(privateKey);
        address managerAddress = vm.envAddress("LIQUIDITY_MANAGER");
        address auction = vm.envAddress("AUCTION");
        address lpRecipient = vm.envOr("LP_RECIPIENT", broadcaster);
        uint256 requestedTokenAmount = vm.envOr("LP_TOKEN_AMOUNT", uint256(0));

        PostAuctionLiquidityManager manager = PostAuctionLiquidityManager(managerAddress);

        console2.log("Broadcaster:", broadcaster);
        console2.log("Liquidity Manager:", managerAddress);
        console2.log("Auction:", auction);
        console2.log("LP recipient:", lpRecipient);

        vm.startBroadcast(privateKey);

        (uint256 raised, uint256 lpCurrencyBudget, uint256 lpTokenBudget) = manager.finalizeAuction(auction);
        console2.log("Finalized raised:", raised);
        console2.log("LP currency budget:", lpCurrencyBudget);
        console2.log("LP token budget:", lpTokenBudget);

        (, , , , , , uint256 currentLpCurrencyBudget, uint256 currentLpTokenBudget, , , bool liquidityAssetsReleased) =
            manager.auctions(auction);

        if (liquidityAssetsReleased) {
            console2.log("Liquidity assets already released, skipping release step.");
        } else {
            uint256 tokenAmountToRelease = requestedTokenAmount > 0 ? requestedTokenAmount : currentLpTokenBudget;
            if (tokenAmountToRelease > currentLpTokenBudget) {
                tokenAmountToRelease = currentLpTokenBudget;
            }

            manager.releaseLiquidityAssets(auction, lpRecipient, tokenAmountToRelease);
            console2.log("Released LP assets with token amount:", tokenAmountToRelease);
            console2.log("Released LP currency amount:", currentLpCurrencyBudget);
        }

        vm.stopBroadcast();

        console2.log("Done.");
    }
}
