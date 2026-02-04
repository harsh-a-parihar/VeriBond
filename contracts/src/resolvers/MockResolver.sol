// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IResolver.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockResolver
 * @notice Mock resolver for demo/testing - admin sets outcomes
 * @dev For hackathon demo using historic Polymarket data
 */
contract MockResolver is IResolver, Ownable {
    // Mapping from claim ID to outcome
    mapping(bytes32 => bool) public outcomes;
    
    // Mapping to track if outcome is set
    mapping(bytes32 => bool) public outcomeSet;
    
    event OutcomeSet(bytes32 indexed claimId, bool outcome);
    
    constructor() Ownable(msg.sender) {}
    
    /**
     * @notice Set the outcome for a claim (admin only)
     * @param claimId The claim identifier
     * @param outcome True if claim correct, false if wrong
     */
    function setOutcome(bytes32 claimId, bool outcome) external onlyOwner {
        outcomes[claimId] = outcome;
        outcomeSet[claimId] = true;
        emit OutcomeSet(claimId, outcome);
    }
    
    /**
     * @notice Batch set outcomes for multiple claims
     * @param claimIds Array of claim identifiers
     * @param _outcomes Array of outcomes
     */
    function batchSetOutcomes(
        bytes32[] calldata claimIds, 
        bool[] calldata _outcomes
    ) external onlyOwner {
        require(claimIds.length == _outcomes.length, "Length mismatch");
        
        for (uint256 i = 0; i < claimIds.length; i++) {
            outcomes[claimIds[i]] = _outcomes[i];
            outcomeSet[claimIds[i]] = true;
            emit OutcomeSet(claimIds[i], _outcomes[i]);
        }
    }
    
    /**
     * @inheritdoc IResolver
     */
    function resolve(bytes32 claimId) external view override returns (bool) {
        require(outcomeSet[claimId], "Outcome not set");
        return outcomes[claimId];
    }
    
    /**
     * @inheritdoc IResolver
     */
    function canResolve(bytes32 claimId) external view override returns (bool) {
        return outcomeSet[claimId];
    }
}
