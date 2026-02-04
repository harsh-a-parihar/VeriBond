// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IResolver
 * @notice Interface for claim resolution oracles
 */
interface IResolver {
    /**
     * @notice Resolve a claim's outcome
     * @param claimId The unique identifier of the claim
     * @return outcome True if claim was correct, false otherwise
     */
    function resolve(bytes32 claimId) external view returns (bool outcome);
    
    /**
     * @notice Check if a claim can be resolved
     * @param claimId The unique identifier of the claim
     * @return canResolve True if claim is ready for resolution
     */
    function canResolve(bytes32 claimId) external view returns (bool canResolve);
}
