// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title OwnerBadge
 * @notice Soulbound ERC-721 token for owner identity (non-transferable)
 * @dev Each address can only have one badge. Used for anti-sybil and accountability.
 */
contract OwnerBadge is ERC721, Ownable {
    uint256 private _nextBadgeId;
    
    // Mapping from owner address to badge ID
    mapping(address => uint256) public ownerToBadge;
    
    // Mapping from badge ID to slash count
    mapping(uint256 => uint256) public slashCount;
    
    // Blacklisted owners
    mapping(address => bool) public isBlacklisted;
    
    // Events
    event BadgeMinted(address indexed owner, uint256 indexed badgeId);
    event SlashRecorded(uint256 indexed badgeId, uint256 totalSlashes);
    event OwnerBlacklisted(address indexed owner);
    
    error AlreadyHasBadge();
    error Blacklisted();
    error SoulboundToken();
    error NoBadge();
    
    constructor() ERC721("VeriBond Owner Badge", "VBOB") Ownable(msg.sender) {
        _nextBadgeId = 1;
    }
    
    /**
     * @notice Mint a new owner badge (one per address, free)
     */
    function mint() external {
        if (isBlacklisted[msg.sender]) revert Blacklisted();
        if (ownerToBadge[msg.sender] != 0) revert AlreadyHasBadge();
        
        uint256 badgeId = _nextBadgeId++;
        ownerToBadge[msg.sender] = badgeId;
        
        _mint(msg.sender, badgeId);
        
        emit BadgeMinted(msg.sender, badgeId);
    }
    
    /**
     * @notice Record a slash against an owner's badge
     * @param badgeId The badge ID to record slash for
     */
    function recordSlash(uint256 badgeId) external onlyOwner {
        slashCount[badgeId]++;
        emit SlashRecorded(badgeId, slashCount[badgeId]);
    }
    
    /**
     * @notice Blacklist an owner address
     * @param owner The address to blacklist
     */
    function blacklist(address owner) external onlyOwner {
        isBlacklisted[owner] = true;
        emit OwnerBlacklisted(owner);
    }
    
    /**
     * @notice Check if an address has a badge
     */
    function hasBadge(address owner) external view returns (bool) {
        return ownerToBadge[owner] != 0;
    }
    
    /**
     * @notice Get badge ID for an owner
     */
    function getBadgeId(address owner) external view returns (uint256) {
        if (ownerToBadge[owner] == 0) revert NoBadge();
        return ownerToBadge[owner];
    }
    
    // ============ Soulbound Overrides ============
    
    /**
     * @dev Override to make tokens non-transferable (soulbound)
     */
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        
        // Allow minting (from == address(0)) but block all transfers
        if (from != address(0)) {
            revert SoulboundToken();
        }
        
        return super._update(to, tokenId, auth);
    }
    
    /**
     * @dev Block approvals for soulbound tokens
     */
    function approve(address, uint256) public pure override {
        revert SoulboundToken();
    }
    
    /**
     * @dev Block operator approvals for soulbound tokens
     */
    function setApprovalForAll(address, bool) public pure override {
        revert SoulboundToken();
    }
}
