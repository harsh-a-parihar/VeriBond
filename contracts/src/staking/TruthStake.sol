// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IIdentityRegistry.sol";
import "../interfaces/IReputationRegistry.sol";
import "../interfaces/IResolver.sol";

/**
 * @title TruthStake
 * @notice Core staking contract for agent predictions
 * @dev Agents stake USDC on predictions. Wrong = slashed. Right = returned.
 *      Uses ERC-8004 for identity verification.
 *      Relies on Base Spend Permissions for delegation (off-chain).
 */
contract TruthStake is Ownable {
    using SafeERC20 for IERC20;
    
    struct Claim {
        uint256 agentId;
        address submitter;      // The agent wallet that submitted
        bytes32 claimHash;
        uint256 stake;
        uint256 submittedAt;
        uint256 resolvesAt;
        bool predictedOutcome;
        bool resolved;
        bool wasCorrect;
    }
    
    IERC20 public immutable usdc;
    IIdentityRegistry public immutable identityRegistry;
    IReputationRegistry public immutable reputationRegistry;
    IResolver public resolver;
    
    mapping(bytes32 => Claim) public claims;
    bytes32[] public claimIds;
    
    // Stats per agent
    mapping(uint256 => uint256) public agentCorrectClaims;
    mapping(uint256 => uint256) public agentTotalClaims;
    mapping(uint256 => uint256) public agentTotalSlashed;
    
    uint256 public minStake = 1e6; // 1 USDC (6 decimals)
    uint256 public slashPercent = 50;
    
    // Treasury for slashed funds (could be burn address or protocol treasury)
    address public slashTreasury;
    
    event ClaimSubmitted(bytes32 indexed claimId, uint256 indexed agentId, address submitter, bytes32 claimHash, uint256 stake);
    event ClaimResolved(bytes32 indexed claimId, uint256 indexed agentId, bool wasCorrect, uint256 slashAmount);
    event ResolverUpdated(address indexed oldResolver, address indexed newResolver);
    
    error ClaimAlreadyExists();
    error ClaimNotFound();
    error ClaimAlreadyResolved();
    error CannotResolveYet();
    error StakeTooLow();
    error InvalidResolvesAt();
    error UnauthorizedAgentWallet();
    
    constructor(
        address _usdc, 
        address _identityRegistry,
        address _reputationRegistry,
        address _resolver,
        address _slashTreasury
    ) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        reputationRegistry = IReputationRegistry(_reputationRegistry);
        resolver = IResolver(_resolver);
        slashTreasury = _slashTreasury;
    }
    
    /**
     * @notice Submit a prediction claim with USDC stake
     * @dev Caller must be the authorized agentWallet for the agentId
     *      Caller must have approved USDC to this contract (or have Spend Permission)
     * @param agentId The ERC-8004 agent ID making the prediction
     * @param claimHash Hash identifying the claim (e.g., Polymarket market ID)
     * @param stake Amount of USDC to stake
     * @param resolvesAt Timestamp when claim can be resolved
     * @param predictedOutcome The agent's prediction (true/false)
     */
    function submitClaim(
        uint256 agentId,
        bytes32 claimHash,
        uint256 stake,
        uint256 resolvesAt,
        bool predictedOutcome
    ) external returns (bytes32 claimId) {
        if (stake < minStake) revert StakeTooLow();
        if (resolvesAt <= block.timestamp) revert InvalidResolvesAt();
        
        // Verify msg.sender is the authorized agent wallet for this agentId
        address agentWallet = identityRegistry.getAgentWallet(agentId);
        if (msg.sender != agentWallet) revert UnauthorizedAgentWallet();
        
        claimId = keccak256(abi.encodePacked(agentId, claimHash, block.timestamp, msg.sender));
        if (claims[claimId].submittedAt != 0) revert ClaimAlreadyExists();
        
        // Pull USDC from caller (agent wallet)
        // Note: If using Base Spend Permissions, the agent wallet can spend from owner's account
        usdc.safeTransferFrom(msg.sender, address(this), stake);
        
        claims[claimId] = Claim({
            agentId: agentId,
            submitter: msg.sender,
            claimHash: claimHash,
            stake: stake,
            submittedAt: block.timestamp,
            resolvesAt: resolvesAt,
            predictedOutcome: predictedOutcome,
            resolved: false,
            wasCorrect: false
        });
        
        claimIds.push(claimId);
        agentTotalClaims[agentId]++;
        
        emit ClaimSubmitted(claimId, agentId, msg.sender, claimHash, stake);
    }
    
    /**
     * @notice Resolve a claim after resolution time
     * @dev Anyone can call this to trigger resolution
     */
    function resolve(bytes32 claimId) external {
        Claim storage claim = claims[claimId];
        
        if (claim.submittedAt == 0) revert ClaimNotFound();
        if (claim.resolved) revert ClaimAlreadyResolved();
        if (block.timestamp < claim.resolvesAt) revert CannotResolveYet();
        if (!resolver.canResolve(claim.claimHash)) revert CannotResolveYet();
        
        bool actualOutcome = resolver.resolve(claim.claimHash);
        bool wasCorrect = (claim.predictedOutcome == actualOutcome);
        
        claim.resolved = true;
        claim.wasCorrect = wasCorrect;
        
        uint256 slashAmount = 0;
        
        if (wasCorrect) {
            // Return stake to submitter
            usdc.safeTransfer(claim.submitter, claim.stake);
            agentCorrectClaims[claim.agentId]++;
            
            // Record success in ERC-8004 Reputation Registry
            try reputationRegistry.giveFeedback(
                claim.agentId, 10, 0, "SUCCESS", "PREDICTION", "", "", bytes32(0)
            ) {} catch {}
            
        } else {
            slashAmount = (claim.stake * slashPercent) / 100;
            uint256 returnAmount = claim.stake - slashAmount;
            
            // Return remainder to submitter
            if (returnAmount > 0) {
                usdc.safeTransfer(claim.submitter, returnAmount);
            }
            
            // Send slashed amount to treasury (or burn)
            if (slashAmount > 0) {
                usdc.safeTransfer(slashTreasury, slashAmount);
            }
            
            // Record slash in ERC-8004 Reputation Registry
            try reputationRegistry.giveFeedback(
                claim.agentId, -100, 0, "SLASH", "PREDICTION", "", "", bytes32(0)
            ) {} catch {}
            
            agentTotalSlashed[claim.agentId] += slashAmount;
        }
        
        emit ClaimResolved(claimId, claim.agentId, wasCorrect, slashAmount);
    }
    
    // ============ View Functions ============
    
    function getClaim(bytes32 claimId) external view returns (Claim memory) {
        return claims[claimId];
    }
    
    function getClaimCount() external view returns (uint256) {
        return claimIds.length;
    }
    
    function getAgentAccuracy(uint256 agentId) external view returns (uint256 correct, uint256 total) {
        return (agentCorrectClaims[agentId], agentTotalClaims[agentId]);
    }
    
    // ============ Admin Functions ============
    
    function setResolver(address _resolver) external onlyOwner {
        emit ResolverUpdated(address(resolver), _resolver);
        resolver = IResolver(_resolver);
    }
    
    function setMinStake(uint256 _minStake) external onlyOwner {
        minStake = _minStake;
    }
    
    function setSlashPercent(uint256 _slashPercent) external onlyOwner {
        require(_slashPercent <= 100, "Invalid percent");
        slashPercent = _slashPercent;
    }
    
    function setSlashTreasury(address _slashTreasury) external onlyOwner {
        slashTreasury = _slashTreasury;
    }
}
