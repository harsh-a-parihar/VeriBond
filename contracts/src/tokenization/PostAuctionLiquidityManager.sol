// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

/**
 * @notice Minimal CCA interface needed for post-auction settlement.
 */
interface IFinalizableAuction {
    function endBlock() external view returns (uint64);
    function currencyRaised() external view returns (uint256);
    function clearingPrice() external view returns (uint256);
    function sweepCurrency() external;
    function sweepUnsoldTokens() external;
}

/**
 * @notice Minimal v4 Position Manager interface used for pool init + LP mint.
 */
interface IMinimalV4PositionManager {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    function initializePool(PoolKey calldata key, uint160 sqrtPriceX96) external payable returns (int24);
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
    function nextTokenId() external view returns (uint256);
}

/**
 * @notice Minimal Permit2 interface for PositionManager token pulls.
 */
interface IMinimalPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/**
 * @title PostAuctionLiquidityManager
 * @notice Receives CCA proceeds/unsold tokens and prepares capped LP budget.
 * @dev Intended as a minimal-breaking extension for existing AgentTokenFactory flow.
 */
contract PostAuctionLiquidityManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant Q96 = 0x1000000000000000000000000;
    uint256 private constant ACTION_MINT_POSITION = 0x02;
    uint256 private constant ACTION_CLOSE_CURRENCY = 0x12;
    address private constant DEFAULT_PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

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
    mapping(address => bool) public liquiditySeeded; // auction address => has seeded at least once
    mapping(address => uint256) public auctionPositionTokenId; // auction address => latest minted position id

    address public factory;
    uint256 public maxCurrencyForLP; // USDC is 6 decimals; 50e6 = 50 USDC in test mode
    address public positionManager;
    address public permit2;
    uint24 public poolLPFee = 10_000; // 1%
    int24 public poolTickSpacing = 60;
    address public poolHooks;

    event FactoryUpdated(address indexed oldFactory, address indexed newFactory);
    event MaxCurrencyForLPUpdated(uint256 oldValue, uint256 newValue);
    event PositionManagerUpdated(address indexed oldValue, address indexed newValue);
    event Permit2Updated(address indexed oldValue, address indexed newValue);
    event PoolConfigUpdated(uint24 fee, int24 tickSpacing, address hooks);
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
    event LiquiditySeeded(
        address indexed auction,
        address indexed positionManager,
        uint256 indexed positionTokenId,
        address positionRecipient,
        uint160 sqrtPriceX96,
        uint256 currencySpent,
        uint256 tokenSpent,
        uint128 liquidity
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
    error PositionManagerNotSet();
    error InvalidPoolConfig();
    error InvalidSqrtPrice();
    error InvalidClearingPrice();
    error InsufficientLiquidityBudget();
    error ZeroLiquidity();
    error InvalidDeadline();

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    constructor(address _factory, uint256 _maxCurrencyForLP) Ownable(msg.sender) {
        if (_factory == address(0)) revert InvalidAddress();
        factory = _factory;
        maxCurrencyForLP = _maxCurrencyForLP;
        permit2 = DEFAULT_PERMIT2;
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

    function setPositionManager(address _positionManager) external onlyOwner {
        if (_positionManager == address(0)) revert InvalidAddress();
        emit PositionManagerUpdated(positionManager, _positionManager);
        positionManager = _positionManager;
    }

    function setPermit2(address _permit2) external onlyOwner {
        if (_permit2 == address(0)) revert InvalidAddress();
        emit Permit2Updated(permit2, _permit2);
        permit2 = _permit2;
    }

    function setPoolConfig(uint24 fee, int24 tickSpacing, address hooks) external onlyOwner {
        if (fee > 1_000_000 || tickSpacing <= 0) revert InvalidPoolConfig();
        poolLPFee = fee;
        poolTickSpacing = tickSpacing;
        poolHooks = hooks;
        emit PoolConfigUpdated(fee, tickSpacing, hooks);
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
     * @notice Seed a Uniswap v4 pool and mint LP from current auction budgets using an explicit sqrtPrice.
     * @dev Uses current lpCurrencyBudget and caller-selected tokenAmount from lpTokenBudget.
     */
    function seedLiquidity(
        address auction,
        address positionRecipient,
        uint256 tokenAmount,
        uint160 sqrtPriceX96,
        uint256 deadline
    ) external nonReentrant returns (uint256 positionTokenId, uint128 liquidity, uint256 currencySpent, uint256 tokenSpent) {
        if (sqrtPriceX96 == 0) revert InvalidSqrtPrice();
        return _seedLiquidity(auction, positionRecipient, tokenAmount, sqrtPriceX96, deadline);
    }

    /**
     * @notice Seed liquidity using the auction clearing price to derive pool initialization price.
     */
    function seedLiquidityFromClearingPrice(address auction, address positionRecipient, uint256 tokenAmount, uint256 deadline)
        external
        nonReentrant
        returns (uint256 positionTokenId, uint128 liquidity, uint256 currencySpent, uint256 tokenSpent)
    {
        AuctionRecord storage record = auctions[auction];
        if (!record.registered || !record.finalized) revert AuctionNotRegistered();

        bool tokenIsCurrency0 = record.token < record.currency;
        uint256 clearingPriceQ96 = IFinalizableAuction(auction).clearingPrice();
        uint160 sqrtPriceX96 = _deriveSqrtPriceX96(clearingPriceQ96, tokenIsCurrency0);

        return _seedLiquidity(auction, positionRecipient, tokenAmount, sqrtPriceX96, deadline);
    }

    function _seedLiquidity(
        address auction,
        address positionRecipient,
        uint256 tokenAmount,
        uint160 sqrtPriceX96,
        uint256 deadline
    ) internal returns (uint256 positionTokenId, uint128 liquidity, uint256 currencySpent, uint256 tokenSpent) {
        AuctionRecord storage record = auctions[auction];
        if (!record.registered || !record.finalized) revert AuctionNotRegistered();
        if (record.liquidityAssetsReleased) revert LiquidityAssetsAlreadyReleased();
        if (msg.sender != record.agentOwner && msg.sender != owner()) revert Unauthorized();
        if (positionManager == address(0)) revert PositionManagerNotSet();
        if (deadline < block.timestamp) revert InvalidDeadline();

        uint256 currencyBudget = record.lpCurrencyBudget;
        uint256 availableTokenBudget = record.lpTokenBudget;
        if (currencyBudget == 0 || availableTokenBudget == 0) revert InsufficientLiquidityBudget();

        uint256 tokenBudgetToUse = tokenAmount == 0 ? availableTokenBudget : tokenAmount;
        if (tokenBudgetToUse > availableTokenBudget) revert LiquidityTokenAmountTooHigh();

        address recipient = positionRecipient == address(0) ? record.agentOwner : positionRecipient;

        (address currency0, address currency1, bool tokenIsCurrency0) = record.token < record.currency
            ? (record.token, record.currency, true)
            : (record.currency, record.token, false);

        uint256 amount0Max = tokenIsCurrency0 ? tokenBudgetToUse : currencyBudget;
        uint256 amount1Max = tokenIsCurrency0 ? currencyBudget : tokenBudgetToUse;
        if (amount0Max > type(uint128).max || amount1Max > type(uint128).max) revert InvalidAmount();

        int24 tickLower = TickMath.minUsableTick(poolTickSpacing);
        int24 tickUpper = TickMath.maxUsableTick(poolTickSpacing);
        uint160 sqrtPriceLowerX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtPriceUpperX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        liquidity =
            LiquidityAmounts.getLiquidityForAmounts(sqrtPriceX96, sqrtPriceLowerX96, sqrtPriceUpperX96, amount0Max, amount1Max);
        if (liquidity == 0) revert ZeroLiquidity();

        IMinimalV4PositionManager manager = IMinimalV4PositionManager(positionManager);
        IMinimalV4PositionManager.PoolKey memory key = IMinimalV4PositionManager.PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: poolLPFee,
            tickSpacing: poolTickSpacing,
            hooks: poolHooks
        });

        positionTokenId = manager.nextTokenId();

        uint256 beforeCurrencyBalance = IERC20(record.currency).balanceOf(address(this));
        uint256 beforeTokenBalance = IERC20(record.token).balanceOf(address(this));

        // PositionManager v4 settles ERC20 pulls through Permit2.
        _approvePermit2(currency0, amount0Max);
        _approvePermit2(currency1, amount1Max);

        // Keep direct approvals for local mocks/backward compatibility, but always approve Permit2 too.
        IERC20(currency0).forceApprove(permit2, amount0Max);
        IERC20(currency1).forceApprove(permit2, amount1Max);
        IERC20(currency0).forceApprove(positionManager, amount0Max);
        IERC20(currency1).forceApprove(positionManager, amount1Max);

        manager.initializePool(key, sqrtPriceX96);

        bytes memory actions = abi.encodePacked(bytes1(uint8(ACTION_MINT_POSITION)), bytes1(uint8(ACTION_CLOSE_CURRENCY)), bytes1(uint8(ACTION_CLOSE_CURRENCY)));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            key,
            tickLower,
            tickUpper,
            uint256(liquidity),
            uint128(amount0Max),
            uint128(amount1Max),
            recipient,
            bytes("")
        );
        params[1] = abi.encode(currency0);
        params[2] = abi.encode(currency1);

        manager.modifyLiquidities(abi.encode(actions, params), deadline);

        IERC20(currency0).forceApprove(permit2, 0);
        IERC20(currency1).forceApprove(permit2, 0);
        IERC20(currency0).forceApprove(positionManager, 0);
        IERC20(currency1).forceApprove(positionManager, 0);

        uint256 afterCurrencyBalance = IERC20(record.currency).balanceOf(address(this));
        uint256 afterTokenBalance = IERC20(record.token).balanceOf(address(this));

        currencySpent = beforeCurrencyBalance - afterCurrencyBalance;
        tokenSpent = beforeTokenBalance - afterTokenBalance;

        if (currencySpent > record.lpCurrencyBudget) currencySpent = record.lpCurrencyBudget;
        if (tokenSpent > record.lpTokenBudget) tokenSpent = record.lpTokenBudget;

        record.lpCurrencyBudget -= currencySpent;
        record.lpTokenBudget -= tokenSpent;

        liquiditySeeded[auction] = true;
        auctionPositionTokenId[auction] = positionTokenId;

        emit LiquiditySeeded(
            auction,
            positionManager,
            positionTokenId,
            recipient,
            sqrtPriceX96,
            currencySpent,
            tokenSpent,
            liquidity
        );
    }

    function _approvePermit2(address token, uint256 amount) internal {
        if (permit2 == address(0) || amount == 0 || permit2.code.length == 0) return;
        if (amount > type(uint160).max) revert InvalidAmount();
        IMinimalPermit2(permit2).approve(token, positionManager, uint160(amount), type(uint48).max);
    }

    function _deriveSqrtPriceX96(uint256 clearingPriceQ96, bool tokenIsCurrency0) internal pure returns (uint160) {
        if (clearingPriceQ96 == 0) revert InvalidClearingPrice();

        uint256 priceQ96 = clearingPriceQ96;
        if (!tokenIsCurrency0) {
            priceQ96 = (Q96 * Q96) / clearingPriceQ96;
            if (priceQ96 == 0) revert InvalidClearingPrice();
        }

        if (priceQ96 > type(uint160).max) revert InvalidClearingPrice();

        uint256 ratioX192 = priceQ96 << 96;
        uint256 sqrtPriceX96 = Math.sqrt(ratioX192);
        if (sqrtPriceX96 == 0 || sqrtPriceX96 > type(uint160).max) revert InvalidSqrtPrice();

        return uint160(sqrtPriceX96);
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
