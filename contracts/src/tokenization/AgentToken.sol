// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentToken
 * @notice ERC-20 token for an ERC-8004 agent, launched via CCA auction
 * @dev Minted during auction, then traded on Uniswap v4
 */
contract AgentToken is ERC20, Ownable {
    uint256 public immutable agentId;
    address public immutable factory;
    
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10**18; // 1B tokens
    
    bool public auctionEnded;
    
    event AuctionEnded(uint256 totalRaised, uint256 tokensMinted);
    
    error OnlyFactory();
    error AuctionNotEnded();
    error AuctionAlreadyEnded();
    error ExceedsMaxSupply();

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    constructor(
        uint256 _agentId,
        string memory _name,
        string memory _symbol,
        address _owner
    ) ERC20(_name, _symbol) Ownable(_owner) {
        agentId = _agentId;
        factory = msg.sender;
        auctionEnded = false;
    }

    /**
     * @notice Mint tokens during auction - only callable by factory
     * @param to Recipient of tokens
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyFactory {
        if (auctionEnded) revert AuctionAlreadyEnded();
        if (totalSupply() + amount > MAX_SUPPLY) revert ExceedsMaxSupply();
        _mint(to, amount);
    }

    /**
     * @notice Mark auction as ended - only callable by factory
     */
    function endAuction() external onlyFactory {
        if (auctionEnded) revert AuctionAlreadyEnded();
        auctionEnded = true;
        emit AuctionEnded(0, totalSupply());
    }

    /**
     * @notice Burn tokens (for LP burn mechanism)
     * @param amount Amount to burn from caller
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
