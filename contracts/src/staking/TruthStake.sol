// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IResolver.sol";

/**
 * @title TruthStake
 * @notice Core staking contract for agent claims
 * @dev Agents stake USDC on predictions, get slashed if wrong
 */
contract TruthStake is Ownable {
    using SafeERC20 for IERC20;
    
    // ============ Structs ============
    
    struct Claim {
        uint256 agentId;
        address submitter;           // The agent wallet that submitted
        bytes32 claimHash;           // Hash of claim data (for verification)
        uint256 stake;               // USDC staked
        uint256 submittedAt;
        uint256 resolvesAt;          // When claim can be resolved
        bool predictedOutcome;       // Agent's prediction (true/false)
        bool resolved;
        bool wasCorrect;
    }
    
    // ============ State ============
    
    IERC20 public immutable usdc;
    IResolver public resolver;
    
    // Claim storage
    mapping(bytes32 => Claim) public claims;
    bytes32[] public claimIds;
    
    // Agent stats
    mapping(uint256 => uint256) public agentCorrectClaims;
    mapping(uint256 => uint256) public agentTotalClaims;
    mapping(uint256 => uint256) public agentTotalSlashed;
    
    // Config
    uint256 public minStake = 1e6;        // 1 USDC (6 decimals)
    uint256 public slashPercent = 50;     // 50% of stake slashed on wrong
    uint256 public burnPercent = 50;      // 50% of slash burned (50% to protocol)
    
    // ============ Events ============
    
    event ClaimSubmitted(
        bytes32 indexed claimId,
        uint256 indexed agentId,
        address submitter,
        bytes32 claimHash,
        uint256 stake,
        uint256 resolvesAt,
        bool predictedOutcome
    );
    
    event ClaimResolved(
        bytes32 indexed claimId,
        uint256 indexed agentId,
        bool wasCorrect,
        uint256 slashAmount
    );
    
    event ResolverUpdated(address indexed oldResolver, address indexed newResolver);
    
    // ============ Errors ============
    
    error ClaimAlreadyExists();
    error ClaimNotFound();
    error ClaimAlreadyResolved();
    error CannotResolveYet();
    error StakeTooLow();
    error InvalidResolvesAt();
    
    // ============ Constructor ============
    
    constructor(address _usdc, address _resolver) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        resolver = IResolver(_resolver);
    }
    
    // ============ Core Functions ============
    
    /**
     * @notice Submit a new claim with stake
     * @param agentId The agent making the claim
     * @param claimHash Hash identifying the claim (e.g., Polymarket market ID + prediction)
     * @param stake Amount of USDC to stake
     * @param resolvesAt Timestamp when claim can be resolved
     * @param predictedOutcome Agent's prediction (true/false)
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
        
        // Generate unique claim ID
        claimId = keccak256(abi.encodePacked(agentId, claimHash, block.timestamp, msg.sender));
        
        if (claims[claimId].submittedAt != 0) revert ClaimAlreadyExists();
        
        // Transfer stake from submitter
        usdc.safeTransferFrom(msg.sender, address(this), stake);
        
        // Store claim
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
        
        emit ClaimSubmitted(
            claimId,
            agentId,
            msg.sender,
            claimHash,
            stake,
            resolvesAt,
            predictedOutcome
        );
    }
    
    /**
     * @notice Resolve a claim (anyone can call after resolvesAt)
     * @param claimId The claim to resolve
     */
    function resolve(bytes32 claimId) external {
        Claim storage claim = claims[claimId];
        
        if (claim.submittedAt == 0) revert ClaimNotFound();
        if (claim.resolved) revert ClaimAlreadyResolved();
        if (block.timestamp < claim.resolvesAt) revert CannotResolveYet();
        if (!resolver.canResolve(claim.claimHash)) revert CannotResolveYet();
        
        // Get outcome from resolver
        bool actualOutcome = resolver.resolve(claim.claimHash);
        bool wasCorrect = (claim.predictedOutcome == actualOutcome);
        
        claim.resolved = true;
        claim.wasCorrect = wasCorrect;
        
        uint256 slashAmount = 0;
        
        if (wasCorrect) {
            // Return stake to submitter
            usdc.safeTransfer(claim.submitter, claim.stake);
            agentCorrectClaims[claim.agentId]++;
        } else {
            // Calculate slash
            slashAmount = (claim.stake * slashPercent) / 100;
            uint256 burnAmount = (slashAmount * burnPercent) / 100;
            uint256 protocolAmount = slashAmount - burnAmount;
            
            // Return remaining stake
            uint256 returnAmount = claim.stake - slashAmount;
            if (returnAmount > 0) {
                usdc.safeTransfer(claim.submitter, returnAmount);
            }
            
            // Protocol keeps its share (could be sent to treasury)
            // For now, stays in contract
            
            // TODO: Burn from Uniswap pool reserve
            // For MVP, we'll track slashed amount
            
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
}
