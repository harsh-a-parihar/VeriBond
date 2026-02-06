// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/staking/TruthStake.sol";
import "../src/resolvers/MockResolver.sol";
import "../src/interfaces/IIdentityRegistry.sol";
import "../src/interfaces/IReputationRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

// Mock USDC
contract MockUSDC is ERC20 {
    constructor() ERC20("USDC", "USDC") {
        _mint(msg.sender, 1_000_000 * 1e6);
    }
    
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

// Mock Identity Registry
contract MockIdentityRegistry is IIdentityRegistry, ERC721 {
    uint256 private _nextId = 1;
    mapping(uint256 => address) private _agentWallets;

    constructor() ERC721("MockAgent", "MA") {}

    function register(string memory) external returns (uint256) {
        uint256 id = _nextId++;
        _mint(msg.sender, id);
        _agentWallets[id] = msg.sender;
        return id;
    }

    function setAgentWallet(uint256 agentId, address wallet) external {
        require(ownerOf(agentId) == msg.sender, "Not owner");
        _agentWallets[agentId] = wallet;
    }

    function setAgentWallet(uint256, address, uint256, bytes calldata) external {}
    function getAgentWallet(uint256 agentId) external view returns (address) {
        return _agentWallets[agentId];
    }
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool) {
        return spender == ownerOf(agentId);
    }
}

// Mock Reputation Registry
contract MockReputationRegistry is IReputationRegistry {
    mapping(uint256 => int256) public scores;

    function giveFeedback(uint256 agentId, int128 value, uint8, string calldata, string calldata, string calldata, string calldata, bytes32) external {
        scores[agentId] += int256(value);
    }

    function getSummary(uint256 agentId, address[] calldata, string calldata, string calldata) external view returns (uint64, int128, uint8) {
        return (1, int128(scores[agentId]), 0);
    }
}

contract TruthStakeTest is Test {
    TruthStake public truthStake;
    MockUSDC public usdc;
    MockIdentityRegistry public identityRegistry;
    MockReputationRegistry public reputationRegistry;
    MockResolver public resolver;

    address public owner = makeAddr("owner");
    address public agentWallet = makeAddr("agentWallet");
    address public treasury = makeAddr("treasury");

    uint256 public agentId;

    function setUp() public {
        vm.startPrank(owner);

        usdc = new MockUSDC();
        identityRegistry = new MockIdentityRegistry();
        reputationRegistry = new MockReputationRegistry();
        resolver = new MockResolver();

        // Register agent and set agent wallet
        agentId = identityRegistry.register("ipfs://agent");
        identityRegistry.setAgentWallet(agentId, agentWallet);

        // Deploy TruthStake
        truthStake = new TruthStake(
            address(usdc),
            address(identityRegistry),
            address(reputationRegistry),
            address(resolver),
            treasury
        );

        // Fund agent wallet
        usdc.transfer(agentWallet, 10_000 * 1e6);

        vm.stopPrank();
    }

    function test_SubmitClaim() public {
        vm.startPrank(agentWallet);
        usdc.approve(address(truthStake), 100 * 1e6);

        bytes32 claimHash = keccak256("ETH > 3000");
        uint256 stake = 50 * 1e6;
        uint256 resolvesAt = block.timestamp + 1 days;

        bytes32 claimId = truthStake.submitClaim(agentId, claimHash, stake, resolvesAt, true);

        TruthStake.Claim memory claim = truthStake.getClaim(claimId);
        assertEq(claim.agentId, agentId);
        assertEq(claim.stake, stake);
        assertEq(claim.submitter, agentWallet);
        assertFalse(claim.resolved);
        vm.stopPrank();
    }

    function test_SubmitClaim_UnauthorizedWallet() public {
        address randomWallet = makeAddr("random");
        vm.prank(owner);
        usdc.transfer(randomWallet, 100 * 1e6);

        vm.startPrank(randomWallet);
        usdc.approve(address(truthStake), 100 * 1e6);

        bytes32 claimHash = keccak256("ETH > 3000");
        vm.expectRevert(TruthStake.UnauthorizedAgentWallet.selector);
        truthStake.submitClaim(agentId, claimHash, 50 * 1e6, block.timestamp + 1 days, true);
        vm.stopPrank();
    }

    function test_Resolve_Correct() public {
        // Submit claim
        vm.startPrank(agentWallet);
        usdc.approve(address(truthStake), 100 * 1e6);
        bytes32 claimHash = keccak256("ETH > 3000");
        bytes32 claimId = truthStake.submitClaim(agentId, claimHash, 50 * 1e6, block.timestamp + 1 days, true);
        vm.stopPrank();

        // Set outcome
        vm.prank(owner);
        resolver.setOutcome(claimHash, true);

        // Warp time
        vm.warp(block.timestamp + 2 days);

        uint256 balanceBefore = usdc.balanceOf(agentWallet);

        // Resolve
        truthStake.resolve(claimId);

        // Agent gets stake back
        assertEq(usdc.balanceOf(agentWallet), balanceBefore + 50 * 1e6);
        (uint256 correct, uint256 total) = truthStake.getAgentAccuracy(agentId);
        assertEq(correct, 1);
        assertEq(total, 1);
    }

    function test_Resolve_Wrong() public {
        // Submit claim
        vm.startPrank(agentWallet);
        usdc.approve(address(truthStake), 100 * 1e6);
        bytes32 claimHash = keccak256("ETH > 3000");
        bytes32 claimId = truthStake.submitClaim(agentId, claimHash, 100 * 1e6, block.timestamp + 1 days, true);
        vm.stopPrank();

        // Set outcome (wrong prediction)
        vm.prank(owner);
        resolver.setOutcome(claimHash, false);

        // Warp time
        vm.warp(block.timestamp + 2 days);

        uint256 agentBalanceBefore = usdc.balanceOf(agentWallet);
        uint256 treasuryBalanceBefore = usdc.balanceOf(treasury);

        // Resolve
        truthStake.resolve(claimId);

        // Agent gets 50% back (50 USDC)
        assertEq(usdc.balanceOf(agentWallet), agentBalanceBefore + 50 * 1e6);
        // Slash split defaults: 50% reward vault, 50% treasury.
        // Slash amount = 50 USDC => reward vault +25, treasury +25.
        assertEq(usdc.balanceOf(treasury), treasuryBalanceBefore + 25 * 1e6);
        assertEq(truthStake.agentRewardVault(agentId), 25 * 1e6);

        (uint256 correct, uint256 total) = truthStake.getAgentAccuracy(agentId);
        assertEq(correct, 0);
        assertEq(total, 1);
    }

    function test_Resolve_CorrectWithBonusFromRewardVault() public {
        // Use deterministic timestamps to avoid edge cases around relative warps.
        uint256 t0 = 1_700_000_000;
        vm.warp(t0);

        // 1) First claim is wrong to fund reward vault.
        uint256 firstResolvesAt = t0 + 1 days;
        vm.startPrank(agentWallet);
        usdc.approve(address(truthStake), 300 * 1e6);
        bytes32 claimHash1 = keccak256("ETH > 3000");
        bytes32 claimId1 = truthStake.submitClaim(agentId, claimHash1, 100 * 1e6, firstResolvesAt, true);
        vm.stopPrank();

        vm.prank(owner);
        resolver.setOutcome(claimHash1, false);
        vm.warp(firstResolvesAt + 1);
        truthStake.resolve(claimId1);

        // Reward vault now has 25 USDC from slash split.
        assertEq(truthStake.agentRewardVault(agentId), 25 * 1e6);

        // 2) Second claim is correct and should pay stake + bonus.
        uint256 secondSubmitTime = firstResolvesAt + 2;
        vm.warp(secondSubmitTime);
        uint256 secondResolvesAt = secondSubmitTime + 1 days;
        vm.startPrank(agentWallet);
        bytes32 claimHash2 = keccak256("BTC > 50000");
        bytes32 claimId2 = truthStake.submitClaim(agentId, claimHash2, 100 * 1e6, secondResolvesAt, true);
        vm.stopPrank();

        vm.prank(owner);
        resolver.setOutcome(claimHash2, true);
        vm.warp(secondResolvesAt + 1);

        uint256 beforeBalance = usdc.balanceOf(agentWallet);
        truthStake.resolve(claimId2);
        uint256 afterBalance = usdc.balanceOf(agentWallet);

        // Bonus config default: 5% of stake = 5 USDC, capped by vault and maxBonusPerClaim.
        assertEq(afterBalance - beforeBalance, 105 * 1e6);
        assertEq(truthStake.agentRewardVault(agentId), 20 * 1e6);
    }

    function test_FundRewardVault() public {
        address funder = makeAddr("funder");
        vm.prank(owner);
        usdc.transfer(funder, 100 * 1e6);

        vm.startPrank(funder);
        usdc.approve(address(truthStake), 100 * 1e6);
        truthStake.fundRewardVault(agentId, 40 * 1e6);
        vm.stopPrank();

        assertEq(truthStake.agentRewardVault(agentId), 40 * 1e6);
    }

    function test_SetSlashSplit() public {
        vm.prank(owner);
        truthStake.setSlashSplit(4000, 3000, 3000);
        assertEq(truthStake.rewardSlashBps(), 4000);
        assertEq(truthStake.protocolSlashBps(), 3000);
        assertEq(truthStake.marketSlashBps(), 3000);
    }
}
