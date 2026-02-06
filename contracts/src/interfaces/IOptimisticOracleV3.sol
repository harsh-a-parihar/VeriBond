// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IOptimisticOracleV3
 * @notice Minimal interface for UMA OptimisticOracleV3
 */
interface IOptimisticOracleV3 {
    /**
     * @notice Asserts a truth about the world, returning an assertionId.
     * @param claim The truth claim to assert.
     * @param asserter Receives bond at resolution.
     * @param callbackRecipient Receives callback on resolution.
     * @param escalationManager Address of escalation manager (0 = none).
     * @param liveness Challenge window duration in seconds.
     * @param currency ERC20 token for bond.
     * @param bond Amount of bond.
     * @param identifier Registered identifier (e.g., ASSERT_TRUTH).
     * @param domainId Optional domain (0 = none).
     * @return assertionId Unique ID for this assertion.
     */
    function assertTruth(
        bytes memory claim,
        address asserter,
        address callbackRecipient,
        address escalationManager,
        uint64 liveness,
        IERC20 currency,
        uint256 bond,
        bytes32 identifier,
        bytes32 domainId
    ) external returns (bytes32);

    /**
     * @notice Settles an assertion and returns the result.
     * @param assertionId The assertion to settle.
     * @return result True if assertion was truthful.
     */
    function settleAndGetAssertionResult(bytes32 assertionId) external returns (bool);

    /**
     * @notice Get the minimum bond for a currency.
     * @param currency The bond currency.
     * @return Minimum bond amount.
     */
    function getMinimumBond(address currency) external view returns (uint256);

    /**
     * @notice Get the default identifier used for assertions.
     * @return The default identifier bytes32.
     */
    function defaultIdentifier() external view returns (bytes32);

    /**
     * @notice Get assertion details.
     * @param assertionId The assertion to query.
     * @return The assertion struct data.
     */
    function getAssertion(bytes32 assertionId) external view returns (Assertion memory);

    struct Assertion {
        address asserter;
        bool settled;
        bool settlementResolution;
        uint64 assertionTime;
        uint64 expirationTime;
        IERC20 currency;
        uint256 bond;
        bytes32 identifier;
        address callbackRecipient;
    }
}
