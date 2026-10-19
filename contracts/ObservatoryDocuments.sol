// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

/// @notice An immutable record of a publisher's claim about a SHA-256 digest.
/// @dev Use the Nodus address256 compiler. A record proves neither authorship,
///      publisher identity nor the truth of a document's contents.
contract ObservatoryDocuments {
    struct DocumentRecord {
        bool exists;
        uint256 blockNumber;
        uint256 timestamp;
        bool revoked;
    }

    mapping(address => mapping(bytes32 => DocumentRecord)) private records;

    event Registered(address indexed publisher, bytes32 indexed digest, uint256 blockNumber, uint256 timestamp);
    event Revoked(address indexed publisher, bytes32 indexed digest);

    function register(bytes32 digest) external {
        require(digest != bytes32(0), "zero digest");
        DocumentRecord storage entry = records[msg.sender][digest];
        require(!entry.exists, "already registered");
        entry.exists = true;
        entry.blockNumber = block.number;
        entry.timestamp = block.timestamp;
        emit Registered(msg.sender, digest, block.number, block.timestamp);
    }

    function revoke(bytes32 digest) external {
        DocumentRecord storage entry = records[msg.sender][digest];
        require(entry.exists, "not registered by sender");
        require(!entry.revoked, "already revoked");
        entry.revoked = true;
        emit Revoked(msg.sender, digest);
    }

    function record(address publisher, bytes32 digest) external view returns (
        bool exists, uint256 blockNumber, uint256 timestamp, bool revoked
    ) {
        DocumentRecord storage entry = records[publisher][digest];
        return (entry.exists, entry.blockNumber, entry.timestamp, entry.revoked);
    }
}
