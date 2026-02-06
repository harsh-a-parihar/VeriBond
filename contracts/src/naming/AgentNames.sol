// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentNames
 * @notice Simple naming registry for verified VeriBond agents
 * @dev Agents with Trust Score >= 50 can claim a human-readable .veribond name
 *      Names are stored on-chain and indexed for display in the frontend.
 */
contract AgentNames is Ownable {
    // Events
    event NameClaimed(uint256 indexed agentId, string name, address claimedBy);
    event NameRevoked(uint256 indexed agentId, string name);

    // Mappings
    mapping(uint256 => string) public agentToName;    // agentId -> name
    mapping(string => uint256) public nameToAgent;    // name -> agentId
    mapping(string => bool) public nameTaken;         // name -> isUsed
    
    // Minimum trust score required (checked off-chain by frontend/admin)
    uint256 public constant MIN_TRUST_SCORE = 50;
    
    // Reference to IdentityRegistry for owner verification
    address public identityRegistry;

    // Errors
    error NameAlreadyTaken();
    error NameTooShort();
    error NameTooLong();
    error InvalidCharacters();
    error AgentAlreadyHasName();
    error NotAgentOwner();
    error NameNotFound();

    constructor(address _identityRegistry) Ownable(msg.sender) {
        identityRegistry = _identityRegistry;
    }

    /**
     * @notice Claim a name for an agent (admin-controlled for trust verification)
     * @param agentId The ERC-8004 agent ID
     * @param name The desired name (alphanumeric + hyphen, 3-32 chars)
     * @dev In production, this would verify trust score on-chain
     */
    function claimName(uint256 agentId, string calldata name) external onlyOwner {
        // Validate name
        bytes memory nameBytes = bytes(name);
        if (nameBytes.length < 3) revert NameTooShort();
        if (nameBytes.length > 32) revert NameTooLong();
        if (!_isValidName(nameBytes)) revert InvalidCharacters();
        
        // Check if name is available
        if (nameTaken[name]) revert NameAlreadyTaken();
        
        // Check if agent already has a name
        if (bytes(agentToName[agentId]).length > 0) revert AgentAlreadyHasName();
        
        // Store mappings
        agentToName[agentId] = name;
        nameToAgent[name] = agentId;
        nameTaken[name] = true;
        
        emit NameClaimed(agentId, name, msg.sender);
    }

    /**
     * @notice Revoke a name (admin only, for moderation)
     * @param agentId The agent ID whose name to revoke
     */
    function revokeName(uint256 agentId) external onlyOwner {
        string memory name = agentToName[agentId];
        if (bytes(name).length == 0) revert NameNotFound();
        
        // Clear mappings
        delete nameToAgent[name];
        delete nameTaken[name];
        delete agentToName[agentId];
        
        emit NameRevoked(agentId, name);
    }

    /**
     * @notice Get the full name with suffix
     * @param agentId The agent ID
     * @return The full name (e.g., "alpha.veribond")
     */
    function getFullName(uint256 agentId) external view returns (string memory) {
        string memory name = agentToName[agentId];
        if (bytes(name).length == 0) return "";
        return string(abi.encodePacked(name, ".veribond"));
    }

    /**
     * @notice Lookup agent by name
     * @param name The name to lookup (without .veribond suffix)
     * @return The agent ID (0 if not found)
     */
    function getAgentByName(string calldata name) external view returns (uint256) {
        return nameToAgent[name];
    }

    /**
     * @notice Validate name characters (lowercase alphanumeric + hyphen)
     */
    function _isValidName(bytes memory name) internal pure returns (bool) {
        for (uint i = 0; i < name.length; i++) {
            bytes1 char = name[i];
            bool isLowercase = (char >= 0x61 && char <= 0x7A); // a-z
            bool isDigit = (char >= 0x30 && char <= 0x39);     // 0-9
            bool isHyphen = (char == 0x2D);                     // -
            
            if (!isLowercase && !isDigit && !isHyphen) {
                return false;
            }
            
            // Hyphen cannot be first or last character
            if (isHyphen && (i == 0 || i == name.length - 1)) {
                return false;
            }
        }
        return true;
    }

    /**
     * @notice Update identity registry address
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = _identityRegistry;
    }
}
 