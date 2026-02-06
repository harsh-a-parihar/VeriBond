// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PostAuctionLiquidityManager} from "../src/tokenization/PostAuctionLiquidityManager.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract MockERC20Token is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockFinalizableAuction {
    MockERC20Token public immutable token;
    MockERC20Token public immutable currency;
    address public immutable fundsRecipient;
    address public immutable tokensRecipient;

    uint64 public endBlock;
    uint256 public currencyRaised;
    uint256 public clearingPrice;

    constructor(
        address _token,
        address _currency,
        address _fundsRecipient,
        address _tokensRecipient,
        uint64 _endBlock,
        uint256 _currencyRaised,
        uint256 _clearingPrice
    ) {
        token = MockERC20Token(_token);
        currency = MockERC20Token(_currency);
        fundsRecipient = _fundsRecipient;
        tokensRecipient = _tokensRecipient;
        endBlock = _endBlock;
        currencyRaised = _currencyRaised;
        clearingPrice = _clearingPrice;
    }

    function sweepCurrency() external {
        uint256 amount = currency.balanceOf(address(this));
        if (amount > 0) {
            currency.transfer(fundsRecipient, amount);
        }
    }

    function sweepUnsoldTokens() external {
        uint256 amount = token.balanceOf(address(this));
        if (amount > 0) {
            token.transfer(tokensRecipient, amount);
        }
    }
}

contract MockPositionManager {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    uint256 public nextTokenId = 1;
    bool public initialized;
    uint160 public lastSqrtPriceX96;
    uint256 public lastDeadline;
    uint128 public lastAmount0Max;
    uint128 public lastAmount1Max;
    uint256 public lastPositionTokenId;
    address public lastPositionRecipient;
    address public lastCurrency0;
    address public lastCurrency1;

    function initializePool(PoolKey calldata key, uint160 sqrtPriceX96) external returns (int24) {
        initialized = true;
        lastSqrtPriceX96 = sqrtPriceX96;
        lastCurrency0 = key.currency0;
        lastCurrency1 = key.currency1;
        return 0;
    }

    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external {
        lastDeadline = deadline;
        (bytes memory actions, bytes[] memory params) = abi.decode(unlockData, (bytes, bytes[]));

        require(actions.length >= 1, "no actions");
        require(uint8(actions[0]) == 0x02, "expected mint action");

        (
            PoolKey memory key,
            int24 tickLower,
            int24 tickUpper,
            uint256 liquidity,
            uint128 amount0Max,
            uint128 amount1Max,
            address recipient,
            bytes memory hookData
        ) = abi.decode(params[0], (PoolKey, int24, int24, uint256, uint128, uint128, address, bytes));

        // Silence warnings for decoded values needed only for ABI-compat assertion.
        tickLower;
        tickUpper;
        liquidity;
        hookData;

        lastAmount0Max = amount0Max;
        lastAmount1Max = amount1Max;
        lastPositionRecipient = recipient;
        lastPositionTokenId = nextTokenId;
        nextTokenId += 1;

        MockERC20Token(key.currency0).transferFrom(msg.sender, address(this), amount0Max);
        MockERC20Token(key.currency1).transferFrom(msg.sender, address(this), amount1Max);
    }
}

contract PostAuctionLiquidityManagerTest is Test {
    PostAuctionLiquidityManager internal manager;
    MockERC20Token internal token;
    MockERC20Token internal usdc;
    MockFinalizableAuction internal auction;
    MockPositionManager internal positionManager;

    address internal factory = makeAddr("factory");
    address internal agentOwner = makeAddr("agentOwner");
    address internal lpOperator = makeAddr("lpOperator");
    address internal attacker = makeAddr("attacker");

    uint256 internal constant MAX_LP_USDC = 50e6;
    uint256 internal constant RAISED = 120e6;
    uint256 internal constant LP_RESERVE = 100e18;
    uint256 internal constant UNSOLD = 300e18;
    uint256 internal constant CLEARING_PRICE_Q96 = 0x1000000000000000000000000; // Q96 = 1.0

    function setUp() public {
        token = new MockERC20Token("Agent Token", "AGT", 18);
        usdc = new MockERC20Token("USDC", "USDC", 6);

        manager = new PostAuctionLiquidityManager(factory, MAX_LP_USDC);
        positionManager = new MockPositionManager();
        auction = new MockFinalizableAuction(
            address(token),
            address(usdc),
            address(manager),
            address(manager),
            uint64(block.number + 1),
            RAISED,
            CLEARING_PRICE_Q96
        );

        // Auction holds raised currency and unsold tokens until sweep.
        usdc.mint(address(auction), RAISED);
        token.mint(address(auction), UNSOLD);

        // Factory pre-mints LP reserve tokens to manager at launch.
        token.mint(address(manager), LP_RESERVE);

        vm.prank(factory);
        manager.registerAuction({
            agentId: 1,
            agentOwner: agentOwner,
            token: address(token),
            auction: address(auction),
            currency: address(usdc),
            lpReserveTokens: LP_RESERVE
        });

        manager.setPositionManager(address(positionManager));
    }

    function test_FinalizeAuction_CapsLPAndPaysOwnerSurplus() public {
        vm.roll(block.number + 2);

        (uint256 raised, uint256 lpCurrencyBudget, uint256 lpTokenBudget) = manager.finalizeAuction(address(auction));

        assertEq(raised, RAISED);
        assertEq(lpCurrencyBudget, MAX_LP_USDC);
        assertEq(lpTokenBudget, LP_RESERVE + UNSOLD);

        // Surplus 70 USDC is paid to agent owner.
        assertEq(usdc.balanceOf(agentOwner), RAISED - MAX_LP_USDC);
        // LP budget remains parked in manager.
        assertEq(usdc.balanceOf(address(manager)), MAX_LP_USDC);

        (, , , , , uint256 storedRaised, uint256 storedLpCurrency, uint256 storedLpTokens, bool registered, bool finalized, ) =
            manager.auctions(address(auction));
        assertTrue(registered);
        assertTrue(finalized);
        assertEq(storedRaised, RAISED);
        assertEq(storedLpCurrency, MAX_LP_USDC);
        assertEq(storedLpTokens, LP_RESERVE + UNSOLD);
    }

    function test_FinalizeAuction_RevertsBeforeEndBlock() public {
        vm.expectRevert(PostAuctionLiquidityManager.AuctionNotEnded.selector);
        manager.finalizeAuction(address(auction));
    }

    function test_ReleaseLiquidityAssets_OneShotByAgentOwner() public {
        vm.roll(block.number + 2);
        manager.finalizeAuction(address(auction));

        uint256 tokenRelease = 250e18;
        vm.prank(agentOwner);
        manager.releaseLiquidityAssets(address(auction), lpOperator, tokenRelease);

        assertEq(usdc.balanceOf(lpOperator), MAX_LP_USDC);
        assertEq(token.balanceOf(lpOperator), tokenRelease);

        (, , , , , , uint256 lpCurrencyBudgetAfter, uint256 lpTokenBudgetAfter, , , bool released) =
            manager.auctions(address(auction));
        assertEq(lpCurrencyBudgetAfter, 0);
        assertEq(lpTokenBudgetAfter, (LP_RESERVE + UNSOLD) - tokenRelease);
        assertTrue(released);

        vm.prank(agentOwner);
        vm.expectRevert(PostAuctionLiquidityManager.LiquidityAssetsAlreadyReleased.selector);
        manager.releaseLiquidityAssets(address(auction), lpOperator, 1e18);
    }

    function test_WithdrawResidualTokens_RevertsForUnauthorized() public {
        vm.roll(block.number + 2);
        manager.finalizeAuction(address(auction));

        vm.prank(attacker);
        vm.expectRevert(PostAuctionLiquidityManager.Unauthorized.selector);
        manager.withdrawResidualTokens(address(auction), attacker, 10e18);
    }

    function test_WithdrawResidualTokens_WorksAfterRelease() public {
        vm.roll(block.number + 2);
        manager.finalizeAuction(address(auction));

        vm.prank(agentOwner);
        manager.releaseLiquidityAssets(address(auction), lpOperator, 250e18);

        vm.prank(agentOwner);
        manager.withdrawResidualTokens(address(auction), agentOwner, 50e18);
        assertEq(token.balanceOf(agentOwner), 50e18);
    }

    function test_SeedLiquidityFromClearingPrice_UsesBudgetsAndTracksPosition() public {
        vm.roll(block.number + 2);
        manager.finalizeAuction(address(auction));

        uint256 tokenRelease = 250e18;
        vm.prank(agentOwner);
        (uint256 positionTokenId, uint128 liquidity, uint256 currencySpent, uint256 tokenSpent) = manager
            .seedLiquidityFromClearingPrice(address(auction), agentOwner, tokenRelease, block.timestamp + 1 hours);

        assertTrue(positionManager.initialized());
        assertEq(positionTokenId, 1);
        assertEq(manager.auctionPositionTokenId(address(auction)), 1);
        assertTrue(manager.liquiditySeeded(address(auction)));
        assertGt(liquidity, 0);
        assertEq(currencySpent, MAX_LP_USDC);
        assertEq(tokenSpent, tokenRelease);

        (, , , , , , uint256 lpCurrencyBudgetAfter, uint256 lpTokenBudgetAfter, , , bool released) =
            manager.auctions(address(auction));
        assertEq(lpCurrencyBudgetAfter, 0);
        assertEq(lpTokenBudgetAfter, (LP_RESERVE + UNSOLD) - tokenRelease);
        assertFalse(released);

        bool tokenIsCurrency0 = address(token) < address(usdc);
        uint128 expectedAmount0 = tokenIsCurrency0 ? uint128(tokenRelease) : uint128(MAX_LP_USDC);
        uint128 expectedAmount1 = tokenIsCurrency0 ? uint128(MAX_LP_USDC) : uint128(tokenRelease);
        assertEq(positionManager.lastAmount0Max(), expectedAmount0);
        assertEq(positionManager.lastAmount1Max(), expectedAmount1);
        assertEq(positionManager.lastPositionRecipient(), agentOwner);
    }

    function test_SeedLiquidity_RevertsForUnauthorized() public {
        vm.roll(block.number + 2);
        manager.finalizeAuction(address(auction));

        uint160 sqrtPriceX96 = uint160(Math.sqrt(CLEARING_PRICE_Q96 << 96));

        vm.prank(attacker);
        vm.expectRevert(PostAuctionLiquidityManager.Unauthorized.selector);
        manager.seedLiquidity(address(auction), attacker, 100e18, sqrtPriceX96, block.timestamp + 1 hours);
    }

    function test_SeedLiquidity_RevertsWhenPositionManagerMissing() public {
        PostAuctionLiquidityManager managerNoPosm = new PostAuctionLiquidityManager(factory, MAX_LP_USDC);
        MockFinalizableAuction auctionNoPosm = new MockFinalizableAuction(
            address(token),
            address(usdc),
            address(managerNoPosm),
            address(managerNoPosm),
            uint64(block.number + 1),
            RAISED,
            CLEARING_PRICE_Q96
        );

        usdc.mint(address(auctionNoPosm), RAISED);
        token.mint(address(auctionNoPosm), UNSOLD);
        token.mint(address(managerNoPosm), LP_RESERVE);

        vm.prank(factory);
        managerNoPosm.registerAuction({
            agentId: 1,
            agentOwner: agentOwner,
            token: address(token),
            auction: address(auctionNoPosm),
            currency: address(usdc),
            lpReserveTokens: LP_RESERVE
        });

        vm.roll(block.number + 2);
        managerNoPosm.finalizeAuction(address(auctionNoPosm));

        vm.prank(agentOwner);
        vm.expectRevert(PostAuctionLiquidityManager.PositionManagerNotSet.selector);
        managerNoPosm.seedLiquidityFromClearingPrice(address(auctionNoPosm), agentOwner, 100e18, block.timestamp + 1 hours);
    }
}
