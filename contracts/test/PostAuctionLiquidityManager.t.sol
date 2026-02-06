// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PostAuctionLiquidityManager} from "../src/tokenization/PostAuctionLiquidityManager.sol";

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

    constructor(
        address _token,
        address _currency,
        address _fundsRecipient,
        address _tokensRecipient,
        uint64 _endBlock,
        uint256 _currencyRaised
    ) {
        token = MockERC20Token(_token);
        currency = MockERC20Token(_currency);
        fundsRecipient = _fundsRecipient;
        tokensRecipient = _tokensRecipient;
        endBlock = _endBlock;
        currencyRaised = _currencyRaised;
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

contract PostAuctionLiquidityManagerTest is Test {
    PostAuctionLiquidityManager internal manager;
    MockERC20Token internal token;
    MockERC20Token internal usdc;
    MockFinalizableAuction internal auction;

    address internal factory = makeAddr("factory");
    address internal agentOwner = makeAddr("agentOwner");
    address internal lpOperator = makeAddr("lpOperator");
    address internal attacker = makeAddr("attacker");

    uint256 internal constant MAX_LP_USDC = 50e6;
    uint256 internal constant RAISED = 120e6;
    uint256 internal constant LP_RESERVE = 100e18;
    uint256 internal constant UNSOLD = 300e18;

    function setUp() public {
        token = new MockERC20Token("Agent Token", "AGT", 18);
        usdc = new MockERC20Token("USDC", "USDC", 6);

        manager = new PostAuctionLiquidityManager(factory, MAX_LP_USDC);
        auction = new MockFinalizableAuction(
            address(token),
            address(usdc),
            address(manager),
            address(manager),
            uint64(block.number + 1),
            RAISED
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
}
