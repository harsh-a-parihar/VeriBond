// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Test.sol";
import {AgentTokenFactory} from "../src/tokenization/AgentTokenFactory.sol";
import {AgentToken} from "../src/tokenization/AgentToken.sol";
import {PostAuctionLiquidityManager} from "../src/tokenization/PostAuctionLiquidityManager.sol";
import {AuctionParameters} from "../src/interfaces/cca/IUniswapCCA.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDCForFactory is ERC20 {
    constructor() ERC20("USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract MockIdentityRegistryForFactory {
    mapping(uint256 => address) public owners;

    function setOwner(uint256 agentId, address owner) external {
        owners[agentId] = owner;
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        return owners[agentId];
    }
}

contract MockCCAAuctionForFactory {
    bool public tokensReceived;

    function onTokensReceived() external {
        tokensReceived = true;
    }
}

contract MockCCAFactoryForFactory {
    address public lastToken;
    uint256 public lastAmount;
    bytes32 public lastSalt;
    address public lastCurrency;
    address public lastTokensRecipient;
    address public lastFundsRecipient;
    uint64 public lastStartBlock;
    uint64 public lastEndBlock;
    uint64 public lastClaimBlock;
    uint256 public lastTickSpacing;
    uint256 public lastFloorPrice;
    bytes public lastAuctionStepsData;
    address public lastAuction;

    function initializeDistribution(
        address token,
        uint256 amount,
        bytes calldata configData,
        bytes32 salt
    ) external returns (address) {
        AuctionParameters memory params = abi.decode(configData, (AuctionParameters));

        lastToken = token;
        lastAmount = amount;
        lastSalt = salt;
        lastCurrency = params.currency;
        lastTokensRecipient = params.tokensRecipient;
        lastFundsRecipient = params.fundsRecipient;
        lastStartBlock = params.startBlock;
        lastEndBlock = params.endBlock;
        lastClaimBlock = params.claimBlock;
        lastTickSpacing = params.tickSpacing;
        lastFloorPrice = params.floorPrice;
        lastAuctionStepsData = params.auctionStepsData;

        lastAuction = address(new MockCCAAuctionForFactory());
        return lastAuction;
    }

    function getAuctionAddress(
        address,
        uint256,
        bytes calldata,
        bytes32,
        address
    ) external view returns (address) {
        return lastAuction;
    }
}

contract AgentTokenFactoryLiquidityIntegrationTest is Test {
    AgentTokenFactory internal factory;
    PostAuctionLiquidityManager internal manager;
    MockCCAFactoryForFactory internal ccaFactory;
    MockIdentityRegistryForFactory internal identityRegistry;
    MockUSDCForFactory internal usdc;

    address internal owner = makeAddr("owner");
    address internal agentOwner = makeAddr("agentOwner");
    address internal other = makeAddr("other");
    uint256 internal constant AGENT_ID = 1;
    uint256 internal constant TOKENS_FOR_SALE = 1_000e18;

    function setUp() public {
        ccaFactory = new MockCCAFactoryForFactory();
        identityRegistry = new MockIdentityRegistryForFactory();
        usdc = new MockUSDCForFactory();

        identityRegistry.setOwner(AGENT_ID, agentOwner);

        vm.prank(owner);
        factory = new AgentTokenFactory(address(ccaFactory), address(identityRegistry), address(usdc));

        manager = new PostAuctionLiquidityManager(address(factory), 50e6);
        vm.prank(owner);
        factory.setLiquidityManager(address(manager));
    }

    function test_LaunchAuction_MintsSaleAndLPReserve_AndRegistersManager() public {
        bytes memory steps = hex"11223344";

        vm.prank(agentOwner);
        factory.launchAuction(
            AGENT_ID,
            "Agent One",
            "AONE",
            TOKENS_FOR_SALE,
            2e18,
            1e18,
            100,
            0, // expect default to 200
            steps
        );

        address auctionAddress = factory.getAgentAuction(AGENT_ID);
        address tokenAddress = factory.getAgentToken(AGENT_ID);
        uint256 expectedReserve = (TOKENS_FOR_SALE * 1000) / 10_000;

        assertEq(auctionAddress, ccaFactory.lastAuction());
        assertEq(ccaFactory.lastTokensRecipient(), address(manager));
        assertEq(ccaFactory.lastFundsRecipient(), address(manager));
        assertEq(ccaFactory.lastTickSpacing(), 200);
        assertEq(ccaFactory.lastFloorPrice(), 1e18);
        assertEq(ccaFactory.lastToken(), tokenAddress);
        assertEq(ccaFactory.lastAmount(), TOKENS_FOR_SALE);
        assertEq(keccak256(ccaFactory.lastAuctionStepsData()), keccak256(steps));
        assertEq(uint256(ccaFactory.lastClaimBlock()), uint256(ccaFactory.lastEndBlock()));

        AgentToken token = AgentToken(tokenAddress);
        assertEq(token.balanceOf(auctionAddress), TOKENS_FOR_SALE);
        assertEq(token.balanceOf(address(manager)), expectedReserve);
        assertEq(token.totalSupply(), TOKENS_FOR_SALE + expectedReserve);
        assertTrue(token.auctionEnded());

        (, address recordAgentOwner, address recordToken, address recordCurrency, uint256 lpReserveTokens, , , , bool registered, , ) =
            manager.auctions(auctionAddress);
        assertTrue(registered);
        assertEq(recordAgentOwner, agentOwner);
        assertEq(recordToken, tokenAddress);
        assertEq(recordCurrency, address(usdc));
        assertEq(lpReserveTokens, expectedReserve);

        assertTrue(factory.hasLaunched(AGENT_ID));
    }

    function test_LaunchAuction_RevertsWhenLiquidityManagerNotSet() public {
        vm.prank(owner);
        AgentTokenFactory localFactory = new AgentTokenFactory(address(ccaFactory), address(identityRegistry), address(usdc));

        vm.prank(agentOwner);
        vm.expectRevert(AgentTokenFactory.LiquidityManagerNotSet.selector);
        localFactory.launchAuction(AGENT_ID, "Agent One", "AONE", TOKENS_FOR_SALE, 2e18, 1e18, 100, 200, hex"01");
    }

    function test_LaunchAuction_RevertsForNonAgentOwner() public {
        vm.prank(other);
        vm.expectRevert(AgentTokenFactory.NotAgentOwner.selector);
        factory.launchAuction(AGENT_ID, "Agent One", "AONE", TOKENS_FOR_SALE, 2e18, 1e18, 100, 200, hex"01");
    }

    function test_LaunchAuction_UsesConfiguredReserveBps() public {
        uint256 secondAgentId = 2;
        identityRegistry.setOwner(secondAgentId, agentOwner);

        vm.prank(owner);
        factory.setLpReserveBps(2000); // 20%

        vm.prank(agentOwner);
        factory.launchAuction(secondAgentId, "Agent Two", "ATWO", TOKENS_FOR_SALE, 2e18, 1e18, 100, 200, hex"99");

        address auctionAddress = factory.getAgentAuction(secondAgentId);
        address tokenAddress = factory.getAgentToken(secondAgentId);
        uint256 expectedReserve = (TOKENS_FOR_SALE * 2000) / 10_000;

        AgentToken token = AgentToken(tokenAddress);
        assertEq(token.balanceOf(auctionAddress), TOKENS_FOR_SALE);
        assertEq(token.balanceOf(address(manager)), expectedReserve);
    }
}
