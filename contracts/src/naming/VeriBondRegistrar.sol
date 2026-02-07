// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/**
 * @title IL2Registry
 * @notice Interface for Durin's L2Registry (ENS L2 subnames)
 * @dev See: https://github.com/namestonehq/durin
 */
interface IL2Registry {
    function createSubnode(
        bytes32 node,
        string calldata label,
        address owner,
        bytes[] calldata data
    ) external returns (bytes32);
    
    function baseNode() external view returns (bytes32);
    function setAddr(bytes32 node, uint256 coinType, bytes calldata addr) external;
    function setText(bytes32 node, string calldata key, string calldata value) external;
}

/**
 * @title VeriBondRegistrar
 * @notice Custom L2 Registrar for VeriBond agent ENS subnames
 * @dev Integrates with Durin L2Registry to issue names like `agentname.veribond.basetest.eth`
 *      Only allows agents with Trust Score >= 50 to claim names (verified off-chain)
 */
contract VeriBondRegistrar is Ownable, IERC721Receiver {
    // Events
    event NameClaimed(uint256 indexed agentId, string label, address owner, bytes32 node);
    
    // Durin L2Registry
    IL2Registry public immutable registry;
    
    // Parent node for okayrohannn.eth (calculated as namehash)
    bytes32 public parentNode;
    
    // Mappings
    mapping(uint256 => bytes32) public agentToNode;    // agentId -> ENS node
    mapping(bytes32 => uint256) public nodeToAgent;    // ENS node -> agentId
    mapping(string => bool) public labelTaken;         // label -> isUsed
    
    // Errors
    error LabelAlreadyTaken();
    error LabelTooShort();
    error LabelTooLong();
    error InvalidCharacters();
    error AgentAlreadyHasName();

    constructor(address _registry, bytes32 _parentNode) Ownable(msg.sender) {
        registry = IL2Registry(_registry);
        // If parentNode is 0, use registry's baseNode
        parentNode = _parentNode == bytes32(0) ? registry.baseNode() : _parentNode;
    }

    /**
     * @notice Claim an ENS subname for an agent
     * @param agentId The ERC-8004 agent ID
     * @param label The desired subname label (e.g., "alpha" for alpha.veribond.basetest.eth)
     * @param agentWallet The agent's wallet address to set as the name's address record
     * @param trustScore The agent's trust score (verified off-chain by admin)
     * @dev Trust score verification is done off-chain; this is admin-controlled for demo
     */
    function claimName(
        uint256 agentId,
        string calldata label,
        address agentWallet,
        uint256 trustScore
    ) external onlyOwner {
        // Validate label
        bytes memory labelBytes = bytes(label);
        if (labelBytes.length < 3) revert LabelTooShort();
        if (labelBytes.length > 32) revert LabelTooLong();
        if (!_isValidLabel(labelBytes)) revert InvalidCharacters();
        
        // Check availability
        if (labelTaken[label]) revert LabelAlreadyTaken();
        if (agentToNode[agentId] != bytes32(0)) revert AgentAlreadyHasName();
        
        // Create the subnode in L2Registry
        bytes[] memory data = new bytes[](0);
        bytes32 node = registry.createSubnode(
            parentNode,
            label,
            address(this),  // Owner is this registrar (can set records)
            data            // Empty data array
        );
        
        // Set text records for VeriBond metadata
        registry.setText(node, "veribond.agentId", _toString(agentId));
        registry.setText(node, "veribond.trustScore", _toString(trustScore));
        registry.setText(node, "veribond.wallet", _addressToString(agentWallet));
        
        // Store mappings
        agentToNode[agentId] = node;
        nodeToAgent[node] = agentId;
        labelTaken[label] = true;
        
        emit NameClaimed(agentId, label, agentWallet, node);
    }

    /**
     * @notice Update trust score text record for an agent
     * @param agentId The agent ID
     * @param newTrustScore The updated trust score
     */
    function updateTrustScore(uint256 agentId, uint256 newTrustScore) external onlyOwner {
        bytes32 node = agentToNode[agentId];
        require(node != bytes32(0), "Agent has no name");
        registry.setText(node, "veribond.trustScore", _toString(newTrustScore));
    }

    /**
     * @notice Validate label characters (lowercase alphanumeric + hyphen)
     */
    function _isValidLabel(bytes memory label) internal pure returns (bool) {
        for (uint i = 0; i < label.length; i++) {
            bytes1 char = label[i];
            bool isLowercase = (char >= 0x61 && char <= 0x7A); // a-z
            bool isDigit = (char >= 0x30 && char <= 0x39);     // 0-9
            bool isHyphen = (char == 0x2D);                     // -
            
            if (!isLowercase && !isDigit && !isHyphen) {
                return false;
            }
            
            // Hyphen cannot be first or last character
            if (isHyphen && (i == 0 || i == label.length - 1)) {
                return false;
            }
        }
        return true;
    }

    /**
     * @notice Convert uint to string
     */
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    /**
     * @notice Convert address to string
     */
    function _addressToString(address addr) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory data = abi.encodePacked(addr);
        bytes memory str = new bytes(42);
        str[0] = "0";
        str[1] = "x";
        for (uint i = 0; i < 20; i++) {
            str[2 + i * 2] = alphabet[uint(uint8(data[i] >> 4))];
            str[3 + i * 2] = alphabet[uint(uint8(data[i] & 0x0f))];
        }
        return string(str);
    }

    /**
     * @notice Update parent node (if ENS name changes)
     */
    function setParentNode(bytes32 _parentNode) external onlyOwner {
        parentNode = _parentNode;
    }

    /**
     * @notice Required for receiving ENS subname NFTs
     */
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
