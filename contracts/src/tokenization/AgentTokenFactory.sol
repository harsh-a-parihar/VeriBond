// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {AgentToken} from "./AgentToken.sol";
import {IContinuousClearingAuctionFactory, IContinuousClearingAuction, AuctionParameters} from "../interfaces/cca/IUniswapCCA.sol";
import {IIdentityRegistry} from "../interfaces/IIdentityRegistry.sol";
import {IPostAuctionLiquidityManager} from "../interfaces/IPostAuctionLiquidityManager.sol";

/**
 * @title AgentTokenFactory
 * @notice Factory to create agent tokens and launch Uniswap CCA auctions
 * @dev Integrates with official Uniswap CCA Factory on Base Sepolia
 */
contract AgentTokenFactory is Ownable {
    using SafeERC20 for IERC20;

    // ============ State ============
    
    IContinuousClearingAuctionFactory public immutable ccaFactory;
    IIdentityRegistry public immutable identityRegistry;
    
    address public paymentToken;           // USDC
    address public liquidityManager;       // Receives auction sweeps and LP reserve
    uint16 public lpReserveBps = 1000;     // 10% reserve relative to tokensForSale
    
    mapping(uint256 => address) public agentTokens;  // agentId => token address
    mapping(uint256 => address) public agentAuctions; // agentId => auction address
    mapping(uint256 => bool) public hasLaunched;     // agentId => launched
    
    // ============ Events ============
    
    event TokenCreated(uint256 indexed agentId, address token, string name, string symbol);
    event AuctionLaunched(
        uint256 indexed agentId,
        address token,
        address auction,
        uint256 tokensForSale,
        uint256 lpReserveTokens
    );
    event LiquidityManagerUpdated(address indexed oldManager, address indexed newManager);
    event LpReserveBpsUpdated(uint16 oldBps, uint16 newBps);
    
    // ============ Errors ============
    
    error NotAgentOwner();
    error AlreadyLaunched();
    error InsufficientTokens();
    error InvalidParams();
    error LiquidityManagerNotSet();
    error InvalidLiquidityManager();
    error InvalidLpReserveBps();

    // ============ Constructor ============

    constructor(
        address _ccaFactory,
        address _identityRegistry,
        address _paymentToken
    ) Ownable(msg.sender) {
        ccaFactory = IContinuousClearingAuctionFactory(_ccaFactory);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        paymentToken = _paymentToken;
    }

    // ============ Launch Functions ============

    /**
     * @notice Create token and launch CCA auction for an agent
     * @param agentId The ERC-8004 agent ID
     * @param name Token name
     * @param symbol Token symbol
     * @param tokensForSale Tokens to sell in auction
     * @param startPrice Starting price per token (in payment token units) - purely likely for frontend, CCA uses floor/max
     * @param minPrice Floor price
     * @param durationBlocks Auction duration in blocks
     * @param tickSpacing Tick spacing for the auction
     * @param auctionStepsData Encoded auction steps (MPS schedule)
     */
    function launchAuction(
        uint256 agentId,
        string calldata name,
        string calldata symbol,
        uint256 tokensForSale,
        uint256 startPrice,
        uint256 minPrice,
        uint256 durationBlocks,
        uint256 tickSpacing,
        bytes calldata auctionStepsData
    ) external {
        // startPrice is kept for frontend compatibility; CCA uses floor/tick constraints.
        startPrice;

        // Verify caller is agent owner
        address agentOwner = identityRegistry.ownerOf(agentId);
        if (msg.sender != agentOwner) revert NotAgentOwner();
        
        // Check not already launched
        if (hasLaunched[agentId]) revert AlreadyLaunched();
        
        // Validate params
        if (tokensForSale == 0) revert InsufficientTokens();
        if (auctionStepsData.length == 0) revert InvalidParams();
        if (liquidityManager == address(0)) revert LiquidityManagerNotSet();

        uint256 lpReserveTokens = (tokensForSale * lpReserveBps) / 10_000;

        // 1. Create Token
        AgentToken token = new AgentToken(agentId, name, symbol, address(this));
        agentTokens[agentId] = address(token);
        
        emit TokenCreated(agentId, address(token), name, symbol);

        // 2. Configure Auction
        AuctionParameters memory params = AuctionParameters({
            currency: paymentToken,
            tokensRecipient: liquidityManager, // Unsold tokens flow to manager
            fundsRecipient: liquidityManager,  // Raised funds flow to manager
            startBlock: uint64(block.number),
            endBlock: uint64(block.number + durationBlocks),
            claimBlock: uint64(block.number + durationBlocks),
            tickSpacing: tickSpacing > 0 ? tickSpacing : 200, // Default tick spacing if 0
            validationHook: address(0),
            floorPrice: minPrice,
            requiredCurrencyRaised: 0,
            auctionStepsData: auctionStepsData
        });

        // 3. Create Auction via Factory
        bytes32 salt = keccak256(abi.encode(agentId, msg.sender, block.number));
        
        address auctionAddress = ccaFactory.initializeDistribution(
            address(token),
            tokensForSale,
            abi.encode(params),
            salt
        );
        
        agentAuctions[agentId] = auctionAddress;
        hasLaunched[agentId] = true;

        // 4. Mint tokens to auction plus LP reserve inventory to manager.
        token.mint(auctionAddress, tokensForSale);
        if (lpReserveTokens > 0) {
            token.mint(liquidityManager, lpReserveTokens);
        }

        // 5. Register auction context with manager for post-auction handling.
        IPostAuctionLiquidityManager(liquidityManager).registerAuction(
            agentId,
            msg.sender,
            address(token),
            auctionAddress,
            paymentToken,
            lpReserveTokens
        );
        
        // 6. Notify Auction of receipt
        IContinuousClearingAuction(auctionAddress).onTokensReceived();
        
        // 7. Seal token supply after both mints are complete.
        token.endAuction(); // Prevents further factory minting
        
        emit AuctionLaunched(agentId, address(token), auctionAddress, tokensForSale, lpReserveTokens);
    }
    
    // ============ View Functions ============

    function getAgentToken(uint256 agentId) external view returns (address) {
        return agentTokens[agentId];
    }
    
    function getAgentAuction(uint256 agentId) external view returns (address) {
        return agentAuctions[agentId];
    }

    // ============ Admin Functions ============

    function setLiquidityManager(address _liquidityManager) external onlyOwner {
        if (_liquidityManager == address(0)) revert InvalidLiquidityManager();
        emit LiquidityManagerUpdated(liquidityManager, _liquidityManager);
        liquidityManager = _liquidityManager;
    }

    function setLpReserveBps(uint16 _lpReserveBps) external onlyOwner {
        if (_lpReserveBps > 5000) revert InvalidLpReserveBps(); // hard cap 50%
        emit LpReserveBpsUpdated(lpReserveBps, _lpReserveBps);
        lpReserveBps = _lpReserveBps;
    }
}
