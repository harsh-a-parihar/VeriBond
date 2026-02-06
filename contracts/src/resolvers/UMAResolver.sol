// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IResolver.sol";
import "../interfaces/IOptimisticOracleV3.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title UMAResolver
 * @notice Decentralized claim resolver using UMA OptimisticOracleV3
 * @dev Integrates with UMA for dispute-based truth verification
 * 
 * Flow:
 * 1. requestResolution() - Submits claim to UMA OOV3
 * 2. Liveness period passes (configurable, default 5 min for testnet)
 * 3. assertionResolvedCallback() - OOV3 calls back with result
 * 4. resolve() - Returns verified outcome to TruthStake
 */
contract UMAResolver is IResolver, Ownable {
    using SafeERC20 for IERC20;

    // UMA OptimisticOracleV3 instance
    IOptimisticOracleV3 public immutable oov3;
    
    // Bond currency (TestnetERC20 on Base Sepolia)
    IERC20 public immutable bondCurrency;
    
    // Default identifier from OOV3
    bytes32 public immutable defaultIdentifier;
    
    // Liveness period in seconds (configurable)
    uint64 public liveness = 300; // 5 minutes for hackathon demo
    
    // Mapping: claimHash -> assertionId
    mapping(bytes32 => bytes32) public claimAssertions;
    
    // Mapping: assertionId -> claimHash (reverse lookup)
    mapping(bytes32 => bytes32) public assertionClaims;
    
    // Mapping: claimHash -> resolution outcome
    mapping(bytes32 => bool) public outcomes;
    
    // Mapping: claimHash -> whether resolved
    mapping(bytes32 => bool) public outcomeSet;
    
    // Mapping: claimHash -> whether assertion pending
    mapping(bytes32 => bool) public assertionPending;

    // Events
    event ResolutionRequested(
        bytes32 indexed claimHash,
        bytes32 indexed assertionId,
        address requester,
        string claimText
    );
    
    event ResolutionCompleted(
        bytes32 indexed claimHash,
        bytes32 indexed assertionId,
        bool outcome
    );
    
    event LivenessUpdated(uint64 oldLiveness, uint64 newLiveness);

    constructor(
        address _oov3,
        address _bondCurrency
    ) Ownable(msg.sender) {
        oov3 = IOptimisticOracleV3(_oov3);
        bondCurrency = IERC20(_bondCurrency);
        defaultIdentifier = oov3.defaultIdentifier();
    }

    /**
     * @notice Request resolution for a claim via UMA OOV3
     * @param claimHash The unique hash identifying the claim
     * @param claimText Human-readable claim text for UMA verifiers
     * @param predictedOutcome The predicted outcome (true = claim is true)
     */
    function requestResolution(
        bytes32 claimHash,
        string calldata claimText,
        bool predictedOutcome
    ) external {
        require(!outcomeSet[claimHash], "Already resolved");
        require(!assertionPending[claimHash], "Assertion already pending");
        
        // Get minimum bond from OOV3
        uint256 bond = oov3.getMinimumBond(address(bondCurrency));
        
        // Pull bond from caller
        bondCurrency.safeTransferFrom(msg.sender, address(this), bond);
        bondCurrency.forceApprove(address(oov3), bond);
        
        // Construct the assertion claim
        // Format: "Claim [claimHash] with text '[claimText]' has outcome: [true/false]"
        bytes memory assertionClaim = abi.encodePacked(
            "VeriBond Claim Resolution: The following claim is ",
            predictedOutcome ? "TRUE" : "FALSE",
            ": '",
            claimText,
            "'. Claim hash: ",
            _bytes32ToHexString(claimHash),
            ". Verify via VeriBond at ",
            _addressToString(address(this))
        );
        
        // Submit assertion to OOV3
        bytes32 assertionId = oov3.assertTruth(
            assertionClaim,
            msg.sender,           // asserter receives bond back if correct
            address(this),        // callback recipient
            address(0),           // no escalation manager
            liveness,             // challenge window
            bondCurrency,
            bond,
            defaultIdentifier,
            bytes32(0)            // no domain
        );
        
        // Store mappings
        claimAssertions[claimHash] = assertionId;
        assertionClaims[assertionId] = claimHash;
        assertionPending[claimHash] = true;
        
        // Pre-store the predicted outcome (will be confirmed/rejected by callback)
        outcomes[claimHash] = predictedOutcome;
        
        emit ResolutionRequested(claimHash, assertionId, msg.sender, claimText);
    }

    /**
     * @notice Callback from OOV3 when assertion is resolved
     * @param assertionId The assertion that was resolved
     * @param assertedTruthfully Whether the assertion was truthful (not disputed)
     */
    function assertionResolvedCallback(
        bytes32 assertionId,
        bool assertedTruthfully
    ) external {
        require(msg.sender == address(oov3), "Only OOV3 can callback");
        
        bytes32 claimHash = assertionClaims[assertionId];
        require(claimHash != bytes32(0), "Unknown assertion");
        
        // If assertion was truthful (not disputed), keep the predicted outcome
        // If disputed and rejected, flip the outcome
        if (assertedTruthfully) {
            // The predicted outcome stands
            outcomeSet[claimHash] = true;
        } else {
            // Assertion was disputed and rejected - flip the outcome
            outcomes[claimHash] = !outcomes[claimHash];
            outcomeSet[claimHash] = true;
        }
        
        assertionPending[claimHash] = false;
        
        emit ResolutionCompleted(claimHash, assertionId, outcomes[claimHash]);
    }

    /**
     * @notice Callback for disputed assertions (required by OOV3)
     * @param assertionId The disputed assertion
     */
    function assertionDisputedCallback(bytes32 assertionId) external {
        // Just acknowledge - resolution will happen via DVM
    }

    /**
     * @notice Manually settle an assertion after liveness period
     * @param claimHash The claim to settle
     */
    function settleAssertion(bytes32 claimHash) external {
        bytes32 assertionId = claimAssertions[claimHash];
        require(assertionId != bytes32(0), "No assertion for claim");
        require(!outcomeSet[claimHash], "Already resolved");
        
        // This will trigger assertionResolvedCallback
        oov3.settleAndGetAssertionResult(assertionId);
    }

    // ============ IResolver Interface ============

    /**
     * @inheritdoc IResolver
     */
    function resolve(bytes32 claimHash) external view override returns (bool) {
        require(outcomeSet[claimHash], "Outcome not set");
        return outcomes[claimHash];
    }

    /**
     * @inheritdoc IResolver
     */
    function canResolve(bytes32 claimHash) external view override returns (bool) {
        return outcomeSet[claimHash];
    }

    // ============ Admin Functions ============

    /**
     * @notice Update liveness period (owner only)
     * @param _liveness New liveness in seconds
     */
    function setLiveness(uint64 _liveness) external onlyOwner {
        require(_liveness >= 60, "Liveness too short"); // Min 1 minute
        require(_liveness <= 604800, "Liveness too long"); // Max 1 week
        
        emit LivenessUpdated(liveness, _liveness);
        liveness = _liveness;
    }

    // ============ View Functions ============

    /**
     * @notice Get assertion status for a claim
     * @param claimHash The claim to query
     */
    function getAssertionStatus(bytes32 claimHash) external view returns (
        bool pending,
        bool resolved,
        bool outcome,
        bytes32 assertionId
    ) {
        return (
            assertionPending[claimHash],
            outcomeSet[claimHash],
            outcomes[claimHash],
            claimAssertions[claimHash]
        );
    }

    /**
     * @notice Get the current minimum bond required
     */
    function getMinBond() external view returns (uint256) {
        return oov3.getMinimumBond(address(bondCurrency));
    }

    // ============ Internal Helpers ============

    function _bytes32ToHexString(bytes32 data) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(66);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            str[2 + i * 2] = alphabet[uint8(data[i] >> 4)];
            str[3 + i * 2] = alphabet[uint8(data[i] & 0x0f)];
        }
        return string(str);
    }

    function _addressToString(address addr) internal pure returns (string memory) {
        return _bytes32ToHexString(bytes32(uint256(uint160(addr)) << 96));
    }
}
