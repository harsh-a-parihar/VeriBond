// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/resolvers/UMAResolver.sol";
import "../src/interfaces/IOptimisticOracleV3.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockOptimisticOracleV3
 * @notice Mock OOV3 for testing UMAResolver
 */
contract MockOptimisticOracleV3 {
    bytes32 public defaultIdentifier = bytes32("ASSERT_TRUTH");
    uint256 public minBond = 100e18; // 100 tokens
    
    uint256 private assertionCounter;
    mapping(bytes32 => bool) public assertionSettled;
    mapping(bytes32 => bool) public assertionResult;
    mapping(bytes32 => address) public assertionCallbackRecipient;
    
    function getMinimumBond(address) external view returns (uint256) {
        return minBond;
    }
    
    function assertTruth(
        bytes memory,
        address,
        address callbackRecipient,
        address,
        uint64,
        IERC20,
        uint256,
        bytes32,
        bytes32
    ) external returns (bytes32) {
        assertionCounter++;
        bytes32 assertionId = bytes32(assertionCounter);
        assertionCallbackRecipient[assertionId] = callbackRecipient;
        return assertionId;
    }
    
    function settleAndGetAssertionResult(bytes32 assertionId) external returns (bool) {
        assertionSettled[assertionId] = true;
        bool result = assertionResult[assertionId];
        
        // Call the callback
        address recipient = assertionCallbackRecipient[assertionId];
        if (recipient != address(0)) {
            UMAResolver(recipient).assertionResolvedCallback(assertionId, result);
        }
        
        return result;
    }
    
    // Test helper to set assertion result
    function setAssertionResult(bytes32 assertionId, bool result) external {
        assertionResult[assertionId] = result;
    }
    
    function getAssertion(bytes32) external pure returns (IOptimisticOracleV3.Assertion memory) {
        revert("Not implemented");
    }
}

/**
 * @title MockBondToken
 * @notice Mock ERC20 for bond payments
 */
contract MockBondToken is ERC20 {
    constructor() ERC20("Mock Bond", "BOND") {
        _mint(msg.sender, 1_000_000e18);
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title UMAResolverTest
 * @notice Tests for UMAResolver contract
 */
contract UMAResolverTest is Test {
    UMAResolver public resolver;
    MockOptimisticOracleV3 public mockOOV3;
    MockBondToken public bondToken;
    
    address public alice = address(0x1);
    address public bob = address(0x2);
    
    bytes32 public testClaimHash = keccak256("Test claim");
    string public testClaimText = "BTC will reach $100k by end of 2026";

    function setUp() public {
        // Deploy mocks
        mockOOV3 = new MockOptimisticOracleV3();
        bondToken = new MockBondToken();
        
        // Deploy UMAResolver
        resolver = new UMAResolver(
            address(mockOOV3),
            address(bondToken)
        );
        
        // Fund alice
        bondToken.mint(alice, 1000e18);
        
        // Approve resolver to spend alice's tokens
        vm.prank(alice);
        bondToken.approve(address(resolver), type(uint256).max);
    }

    function test_initialization() public view {
        assertEq(address(resolver.oov3()), address(mockOOV3));
        assertEq(address(resolver.bondCurrency()), address(bondToken));
        assertEq(resolver.liveness(), 300); // 5 minutes default
        assertEq(resolver.defaultIdentifier(), bytes32("ASSERT_TRUTH"));
    }

    function test_requestResolution() public {
        vm.prank(alice);
        resolver.requestResolution(testClaimHash, testClaimText, true);
        
        // Check assertion is pending
        (bool pending, bool resolved, bool outcome, bytes32 assertionId) = 
            resolver.getAssertionStatus(testClaimHash);
        
        assertTrue(pending, "Should be pending");
        assertFalse(resolved, "Should not be resolved yet");
        assertTrue(outcome, "Predicted outcome should be true");
        assertNotEq(assertionId, bytes32(0), "Should have assertion ID");
    }

    function test_cannotRequestResolutionTwice() public {
        vm.prank(alice);
        resolver.requestResolution(testClaimHash, testClaimText, true);
        
        vm.prank(alice);
        vm.expectRevert("Assertion already pending");
        resolver.requestResolution(testClaimHash, testClaimText, true);
    }

    function test_resolveAfterSettlement() public {
        // Request resolution
        vm.prank(alice);
        resolver.requestResolution(testClaimHash, testClaimText, true);
        
        // Get assertion ID
        (, , , bytes32 assertionId) = resolver.getAssertionStatus(testClaimHash);
        
        // Set result to true (assertion was truthful)
        mockOOV3.setAssertionResult(assertionId, true);
        
        // Settle
        resolver.settleAssertion(testClaimHash);
        
        // Check resolution
        assertTrue(resolver.canResolve(testClaimHash), "Should be resolvable");
        assertTrue(resolver.resolve(testClaimHash), "Outcome should be true");
    }

    function test_resolveWithDisputedAssertion() public {
        // Request resolution predicting TRUE
        vm.prank(alice);
        resolver.requestResolution(testClaimHash, testClaimText, true);
        
        // Get assertion ID
        (, , , bytes32 assertionId) = resolver.getAssertionStatus(testClaimHash);
        
        // Set result to false (assertion was disputed and rejected)
        mockOOV3.setAssertionResult(assertionId, false);
        
        // Settle
        resolver.settleAssertion(testClaimHash);
        
        // Outcome should be flipped (predicted true, but assertion rejected = false)
        assertTrue(resolver.canResolve(testClaimHash), "Should be resolvable");
        assertFalse(resolver.resolve(testClaimHash), "Outcome should be flipped to false");
    }

    function test_cannotResolveBeforeSettlement() public {
        vm.prank(alice);
        resolver.requestResolution(testClaimHash, testClaimText, true);
        
        assertFalse(resolver.canResolve(testClaimHash), "Should not be resolvable yet");
        
        vm.expectRevert("Outcome not set");
        resolver.resolve(testClaimHash);
    }

    function test_setLiveness() public {
        // Only owner can set
        vm.prank(alice);
        vm.expectRevert();
        resolver.setLiveness(600);
        
        // Owner can set
        resolver.setLiveness(600);
        assertEq(resolver.liveness(), 600);
    }

    function test_livenessConstraints() public {
        // Too short
        vm.expectRevert("Liveness too short");
        resolver.setLiveness(30);
        
        // Too long
        vm.expectRevert("Liveness too long");
        resolver.setLiveness(2_000_000);
    }

    function test_getMinBond() public view {
        assertEq(resolver.getMinBond(), 100e18);
    }

    function test_IResolverInterface() public {
        // Request and settle
        vm.prank(alice);
        resolver.requestResolution(testClaimHash, testClaimText, true);
        
        (, , , bytes32 assertionId) = resolver.getAssertionStatus(testClaimHash);
        mockOOV3.setAssertionResult(assertionId, true);
        resolver.settleAssertion(testClaimHash);
        
        // Test IResolver interface
        IResolver iResolver = IResolver(address(resolver));
        assertTrue(iResolver.canResolve(testClaimHash));
        assertTrue(iResolver.resolve(testClaimHash));
    }
}
