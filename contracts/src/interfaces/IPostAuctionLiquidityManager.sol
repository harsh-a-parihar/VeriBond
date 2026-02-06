// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IPostAuctionLiquidityManager {
    function registerAuction(
        uint256 agentId,
        address agentOwner,
        address token,
        address auction,
        address currency,
        uint256 lpReserveTokens
    ) external;
}
