// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @notice Minimal CCA interface needed for post-auction settlement.
 */
interface IFinalizableAuction {
    function endBlock() external view returns (uint64);
    function currencyRaised() external view returns (uint256);
    function sweepCurrency() external;
    function sweepUnsoldTokens() external;
}

/**
 * @title PostAuctionLiquidityManager
 * @notice Receives CCA proceeds/unsold tokens and prepares capped LP budget.
 * @dev Intended as a minimal-breaking extension for existing AgentTokenFactory flow.
 */
contract PostAuctionLiquidityManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct AuctionRecord {
        uint256 agentId;
        address agentOwner;
        address token;
        address currency;
        uint256 lpReserveTokens;
        uint256 currencyRaised;
        uint256 lpCurrencyBudget;
        uint256 lpTokenBudget;
        bool registered;
        bool finalized;
        bool liquidityAssetsReleased;
    }

    mapping(address => AuctionRecord) public auctions; // auction address => record
    address public factory;
    uint256 public maxCurrencyForLP; // USDC is 6 decimals; 50e6 = 50 USDC in test mode

    event FactoryUpdated(address indexed oldFactory, address indexed newFactory);
    event MaxCurrencyForLPUpdated(uint256 oldValue, uint256 newValue);
    event AuctionRegistered(
        address indexed auction,
        uint256 indexed agentId,
        address indexed token,
        address currency,
        address agentOwner,
        uint256 lpReserveTokens
    );
    event AuctionFinalized(
        address indexed auction,
        uint256 currencyRaised,
        uint256 lpCurrencyBudget,
        uint256 lpTokenBudget,
        uint256 ownerCurrencyPayout
    );
    event LiquidityAssetsReleased(
        address indexed auction,
        address indexed recipient,
        uint256 currencyAmount,
        uint256 tokenAmount
    );
    event ResidualTokensWithdrawn(address indexed auction, address indexed recipient, uint256 amount);

    error OnlyFactory();
    error AuctionAlreadyRegistered();
    error AuctionNotRegistered();
    error AuctionNotEnded();
    error AuctionAlreadyFinalized();
    error InsufficientSweptCurrency();
    error InvalidAddress();
    error InvalidAmount();
    error Unauthorized();
    error LiquidityAssetsAlreadyReleased();
    error LiquidityTokenAmountTooHigh();

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    constructor(address _factory, uint256 _maxCurrencyForLP) Ownable(msg.sender) {
        if (_factory == address(0)) revert InvalidAddress();
        factory = _factory;
        maxCurrencyForLP = _maxCurrencyForLP;
    }

    function setFactory(address _factory) external onlyOwner {
        if (_factory == address(0)) revert InvalidAddress();
        emit FactoryUpdated(factory, _factory);
        factory = _factory;
    }

    function setMaxCurrencyForLP(uint256 _maxCurrencyForLP) external onlyOwner {
        emit MaxCurrencyForLPUpdated(maxCurrencyForLP, _maxCurrencyForLP);
        maxCurrencyForLP = _maxCurrencyForLP;
    }

    function registerAuction(
        uint256 agentId,
        address agentOwner,
        address token,
        address auction,
        address currency,
        uint256 lpReserveTokens
    ) external onlyFactory {
        if (agentOwner == address(0) || token == address(0) || auction == address(0) || currency == address(0)) {
            revert InvalidAddress();
        }
        if (auctions[auction].registered) revert AuctionAlreadyRegistered();

        auctions[auction] = AuctionRecord({
            agentId: agentId,
            agentOwner: agentOwner,
            token: token,
            currency: currency,
            lpReserveTokens: lpReserveTokens,
            currencyRaised: 0,
            lpCurrencyBudget: 0,
            lpTokenBudget: 0,
            registered: true,
            finalized: false,
            liquidityAssetsReleased: false
        });

        emit AuctionRegistered(auction, agentId, token, currency, agentOwner, lpReserveTokens);
    }

    /**
     * @notice Finalize post-auction accounting and carve out capped LP budget.
     * @dev Transfers surplus raised currency to agent owner treasury.
     */
    function finalizeAuction(address auction) external nonReentrant returns (uint256, uint256, uint256) {
        AuctionRecord storage record = auctions[auction];
        if (!record.registered) revert AuctionNotRegistered();
        if (record.finalized) revert AuctionAlreadyFinalized();

        IFinalizableAuction cca = IFinalizableAuction(auction);
        if (block.number < uint256(cca.endBlock())) revert AuctionNotEnded();

        // Sweep operations are permissionless and may have been called already.
        try cca.sweepCurrency() {} catch {}
        try cca.sweepUnsoldTokens() {} catch {}

        uint256 raised = cca.currencyRaised();
        uint256 currencyBalance = IERC20(record.currency).balanceOf(address(this));
        if (currencyBalance < raised) revert InsufficientSweptCurrency();

        uint256 lpCurrencyBudget = raised > maxCurrencyForLP ? maxCurrencyForLP : raised;
        uint256 ownerCurrencyPayout = raised - lpCurrencyBudget;
        if (ownerCurrencyPayout > 0) {
            IERC20(record.currency).safeTransfer(record.agentOwner, ownerCurrencyPayout);
        }

        // Token balance now includes LP reserve mint + any unsold auction inventory.
        uint256 lpTokenBudget = IERC20(record.token).balanceOf(address(this));

        record.currencyRaised = raised;
        record.lpCurrencyBudget = lpCurrencyBudget;
        record.lpTokenBudget = lpTokenBudget;
        record.finalized = true;

        emit AuctionFinalized(auction, raised, lpCurrencyBudget, lpTokenBudget, ownerCurrencyPayout);
        return (raised, lpCurrencyBudget, lpTokenBudget);
    }

    /**
     * @notice Release LP budgeted assets to an LP operator address.
     * @dev One-shot release of budgeted currency; token amount is chosen by caller.
     */
    function releaseLiquidityAssets(address auction, address recipient, uint256 tokenAmount) external nonReentrant {
        AuctionRecord storage record = auctions[auction];
        if (!record.registered || !record.finalized) revert AuctionNotRegistered();
        if (recipient == address(0)) revert InvalidAddress();
        if (record.liquidityAssetsReleased) revert LiquidityAssetsAlreadyReleased();
        if (msg.sender != record.agentOwner && msg.sender != owner()) revert Unauthorized();
        if (tokenAmount > record.lpTokenBudget) revert LiquidityTokenAmountTooHigh();

        record.liquidityAssetsReleased = true;
        uint256 currencyAmount = record.lpCurrencyBudget;
        record.lpCurrencyBudget = 0;
        record.lpTokenBudget -= tokenAmount;

        if (currencyAmount > 0) IERC20(record.currency).safeTransfer(recipient, currencyAmount);
        if (tokenAmount > 0) IERC20(record.token).safeTransfer(recipient, tokenAmount);

        emit LiquidityAssetsReleased(auction, recipient, currencyAmount, tokenAmount);
    }

    /**
     * @notice Withdraw residual token inventory after LP funding.
     * @dev Agent owner or protocol owner can pull any remaining tokens.
     */
    function withdrawResidualTokens(address auction, address recipient, uint256 amount) external nonReentrant {
        AuctionRecord storage record = auctions[auction];
        if (!record.registered || !record.finalized) revert AuctionNotRegistered();
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (msg.sender != record.agentOwner && msg.sender != owner()) revert Unauthorized();

        IERC20(record.token).safeTransfer(recipient, amount);
        emit ResidualTokensWithdrawn(auction, recipient, amount);
    }
}
