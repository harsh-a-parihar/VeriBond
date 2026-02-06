// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console2} from "forge-std/Script.sol";
import {PostAuctionLiquidityManager} from "../src/tokenization/PostAuctionLiquidityManager.sol";

/**
 * @title FinalizeAuctionLiquidity
 * @notice Finalizes post-CCA settlement, then seeds LP (primary) or releases LP assets (fallback).
 *
 * Environment:
 * - PRIVATE_KEY (required)
 * - LIQUIDITY_MANAGER (required)
 * - AUCTION (required)
 * - LP_RECIPIENT (optional, defaults to broadcaster)
 * - LP_TOKEN_AMOUNT (optional, defaults to full lpTokenBudget after finalize)
 * - SEED_LP (optional, default true)
 * - SEED_DEADLINE_SECONDS (optional, default 3600)
 * - FALLBACK_RELEASE (optional, default false)
 */
contract FinalizeAuctionLiquidity is Script {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address broadcaster = vm.addr(privateKey);
        address managerAddress = vm.envAddress("LIQUIDITY_MANAGER");
        address auction = vm.envAddress("AUCTION");
        address lpRecipient = vm.envOr("LP_RECIPIENT", broadcaster);
        uint256 requestedTokenAmount = vm.envOr("LP_TOKEN_AMOUNT", uint256(0));
        bool seedLp = vm.envOr("SEED_LP", true);
        uint256 seedDeadlineSeconds = vm.envOr("SEED_DEADLINE_SECONDS", uint256(3600));
        bool fallbackRelease = vm.envOr("FALLBACK_RELEASE", false);

        PostAuctionLiquidityManager manager = PostAuctionLiquidityManager(managerAddress);

        console2.log("Broadcaster:", broadcaster);
        console2.log("Liquidity Manager:", managerAddress);
        console2.log("Auction:", auction);
        console2.log("LP recipient:", lpRecipient);
        console2.log("Seed LP:", seedLp);
        console2.log("Fallback release on seed failure:", fallbackRelease);

        vm.startBroadcast(privateKey);

        try manager.finalizeAuction(auction) returns (uint256 raised, uint256 lpCurrencyBudget, uint256 lpTokenBudget) {
            console2.log("Finalized raised:", raised);
            console2.log("LP currency budget:", lpCurrencyBudget);
            console2.log("LP token budget:", lpTokenBudget);
        } catch {
            console2.log("Finalize skipped/failed (likely already finalized). Continuing...");
        }

        (, , , , , , uint256 currentLpCurrencyBudget, uint256 currentLpTokenBudget, , , bool liquidityAssetsReleased) =
            manager.auctions(auction);

        uint256 tokenAmountToUse = requestedTokenAmount > 0 ? requestedTokenAmount : currentLpTokenBudget;
        if (tokenAmountToUse > currentLpTokenBudget) {
            tokenAmountToUse = currentLpTokenBudget;
        }

        if (liquidityAssetsReleased) {
            console2.log("Liquidity assets already released, nothing left to do.");
        } else if (seedLp) {
            address positionManager = manager.positionManager();
            if (positionManager == address(0)) {
                console2.log("Position manager is not configured; cannot seed LP.");
            } else if (currentLpCurrencyBudget == 0 || tokenAmountToUse == 0) {
                console2.log("Insufficient LP budgets to seed. currency:", currentLpCurrencyBudget, "token:", tokenAmountToUse);
            } else {
                uint256 deadline = block.timestamp + seedDeadlineSeconds;
                try manager.seedLiquidityFromClearingPrice(auction, lpRecipient, tokenAmountToUse, deadline) returns (
                    uint256 positionTokenId,
                    uint128 liquidity,
                    uint256 currencySpent,
                    uint256 tokenSpent
                ) {
                    console2.log("Seeded LP position tokenId:", positionTokenId);
                    console2.log("Liquidity:", liquidity);
                    console2.log("Currency spent:", currencySpent);
                    console2.log("Token spent:", tokenSpent);
                } catch {
                    console2.log("Seed LP failed.");
                    if (fallbackRelease) {
                        manager.releaseLiquidityAssets(auction, lpRecipient, tokenAmountToUse);
                        console2.log("Fallback release executed. token:", tokenAmountToUse, "currency:", currentLpCurrencyBudget);
                    } else {
                        console2.log("Fallback release disabled; LP assets remain in manager.");
                    }
                }
            }
        } else {
            manager.releaseLiquidityAssets(auction, lpRecipient, tokenAmountToUse);
            console2.log("Released LP assets with token amount:", tokenAmountToUse);
            console2.log("Released LP currency amount:", currentLpCurrencyBudget);
        }

        vm.stopBroadcast();

        console2.log("Done.");
    }
}
