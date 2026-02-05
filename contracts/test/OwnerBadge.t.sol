// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/identity/OwnerBadge.sol";

contract OwnerBadgeTest is Test {
    OwnerBadge public badge;
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    
    function setUp() public {
        badge = new OwnerBadge();
    }
    
    function test_MintBadge() public {
        vm.prank(alice);
        badge.mint();
        
        assertTrue(badge.hasBadge(alice));
        assertEq(badge.getBadgeId(alice), 1);
        assertEq(badge.ownerOf(1), alice);
    }
    
    function test_CannotMintTwice() public {
        vm.prank(alice);
        badge.mint();
        
        vm.prank(alice);
        vm.expectRevert(OwnerBadge.AlreadyHasBadge.selector);
        badge.mint();
    }
    
    function test_MultipleMints() public {
        vm.prank(alice);
        badge.mint();
        
        vm.prank(bob);
        badge.mint();
        
        assertEq(badge.getBadgeId(alice), 1);
        assertEq(badge.getBadgeId(bob), 2);
    }
    
    function test_Soulbound_CannotTransfer() public {
        vm.prank(alice);
        badge.mint();
        
        vm.prank(alice);
        vm.expectRevert(OwnerBadge.SoulboundToken.selector);
        badge.transferFrom(alice, bob, 1);
    }
    
    function test_Soulbound_CannotApprove() public {
        vm.prank(alice);
        badge.mint();
        
        vm.prank(alice);
        vm.expectRevert(OwnerBadge.SoulboundToken.selector);
        badge.approve(bob, 1);
    }
    
    function test_Soulbound_CannotSetApprovalForAll() public {
        vm.prank(alice);
        badge.mint();
        
        vm.prank(alice);
        vm.expectRevert(OwnerBadge.SoulboundToken.selector);
        badge.setApprovalForAll(bob, true);
    }
    
    function test_RecordSlash() public {
        vm.prank(alice);
        badge.mint();
        
        badge.recordSlash(1);
        assertEq(badge.slashCount(1), 1);
        
        badge.recordSlash(1);
        assertEq(badge.slashCount(1), 2);
    }
    
    function test_Blacklist() public {
        vm.prank(alice);
        badge.mint();
        
        badge.blacklist(bob);
        assertTrue(badge.isBlacklisted(bob));
        
        vm.prank(bob);
        vm.expectRevert(OwnerBadge.Blacklisted.selector);
        badge.mint();
    }
    
    function test_NoBadge_Reverts() public {
        vm.expectRevert(OwnerBadge.NoBadge.selector);
        badge.getBadgeId(alice);
    }
}
