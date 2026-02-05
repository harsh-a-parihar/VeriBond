// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

struct AuctionParameters {
    address currency; // token to raise funds in. Use address(0) for ETH
    address tokensRecipient; // address to receive leftover tokens
    address fundsRecipient; // address to receive all raised funds
    uint64 startBlock; // Block which the first step starts
    uint64 endBlock; // When the auction finishes
    uint64 claimBlock; // Block when the auction can claimed
    uint256 tickSpacing; // Fixed granularity for prices
    address validationHook; // Optional hook called before a bid
    uint256 floorPrice; // Starting floor price for the auction
    uint128 requiredCurrencyRaised; // Amount of currency required to be raised for the auction to graduate
    bytes auctionStepsData; // Packed bytes describing token issuance schedule
}

interface IContinuousClearingAuctionFactory {
    function initializeDistribution(
        address token,
        uint256 amount,
        bytes calldata configData,
        bytes32 salt
    ) external returns (address);
    
    function getAuctionAddress(
        address token,
        uint256 amount,
        bytes calldata configData,
        bytes32 salt,
        address sender
    ) external view returns (address);
}

interface IContinuousClearingAuction {
    function onTokensReceived() external;
    
    function submitBid(
        uint256 maxPrice, 
        uint128 amount, 
        address owner, 
        uint256 prevTickPrice, 
        bytes calldata hookData
    ) external payable returns (uint256 bidId);

    function claimTokens(uint256 bidId) external;
    
    function startBlock() external view returns (uint64);
    function endBlock() external view returns (uint64);
    function claimBlock() external view returns (uint64);
    function floorPrice() external view returns (uint256);
    function tickSpacing() external view returns (uint256);
    function clearingPrice() external view returns (uint256);
    
    function currency() external view returns (address);
    function token() external view returns (address);
}
