// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

/// @notice One native-coin leg of a two-chain, SHA-256 hash-time-locked swap.
/// @dev A matching lock on the other chain must be independently verified.
///      No oracle, owner, third-party custody or cross-chain callback is used.
contract ObservatoryBnbSwap {
    uint256 public constant AMOUNT_QUANTUM = 1;
    uint256 public constant MIN_LOCK_SECONDS = 1 hours;
    uint256 public constant MAX_LOCK_SECONDS = 7 days;
    uint256 public constant SUPPORTED_CHAIN_ID = 97;
    enum Status { Empty, Locked, Claimed, Refunded }
    struct Swap {
        address recipient;
        uint256 amount;
        bytes32 hashlock;
        uint64 refundAt;
        Status status;
    }
    // The funder owns the namespace: another account cannot reserve its trade id.
    mapping(address => mapping(bytes32 => Swap)) private swaps;
    uint256 public lockedTotal;
    uint256 private entered;

    error InvalidTerms();
    error InvalidAmount();
    error WrongNetwork();
    error SwapAlreadyExists();
    error SwapNotLocked();
    error NotRecipient();
    error WrongSecret();
    error ClaimExpired();
    error RefundNotReady();
    error PaymentFailed();
    error ReentrantCall();

    event Locked(address indexed funder, bytes32 indexed tradeId, address indexed recipient,
                 uint256 amount, bytes32 hashlock, uint64 refundAt);
    event Claimed(address indexed funder, bytes32 indexed tradeId, address indexed recipient,
                  uint256 amount, bytes32 secret);
    event Refunded(address indexed funder, bytes32 indexed tradeId, uint256 amount);

    modifier nonReentrant() {
        if (entered != 0) revert ReentrantCall();
        entered = 1;
        _;
        entered = 0;
    }

    function open(bytes32 tradeId, address recipient, bytes32 hashlock, uint64 refundAt)
        external payable nonReentrant
    {
        if (block.chainid != SUPPORTED_CHAIN_ID) revert WrongNetwork();
        if (tradeId == bytes32(0) || hashlock == bytes32(0) || recipient == address(0)
            || recipient == msg.sender || recipient == address(this)
            || refundAt < block.timestamp + MIN_LOCK_SECONDS
            || refundAt > block.timestamp + MAX_LOCK_SECONDS) revert InvalidTerms();
        if (msg.value == 0 || msg.value % AMOUNT_QUANTUM != 0) revert InvalidAmount();
        if (swaps[msg.sender][tradeId].status != Status.Empty) revert SwapAlreadyExists();
        swaps[msg.sender][tradeId] = Swap(recipient, msg.value, hashlock, refundAt, Status.Locked);
        lockedTotal += msg.value;
        emit Locked(msg.sender, tradeId, recipient, msg.value, hashlock, refundAt);
    }

    function claim(address funder, bytes32 tradeId, bytes32 secret) external nonReentrant {
        Swap storage item = swaps[funder][tradeId];
        if (item.status != Status.Locked) revert SwapNotLocked();
        if (msg.sender != item.recipient) revert NotRecipient();
        if (block.timestamp >= item.refundAt) revert ClaimExpired();
        // The preimage is exactly 32 raw bytes, not the UTF-8 text of its hex form.
        if (sha256(abi.encodePacked(secret)) != item.hashlock) revert WrongSecret();
        item.status = Status.Claimed;
        uint256 amount = item.amount;
        lockedTotal -= amount;
        emit Claimed(funder, tradeId, item.recipient, amount, secret);
        (bool ok, ) = payable(item.recipient).call{value: amount}("");
        if (!ok) revert PaymentFailed();
    }

    function refund(bytes32 tradeId) external nonReentrant {
        Swap storage item = swaps[msg.sender][tradeId];
        if (item.status != Status.Locked) revert SwapNotLocked();
        if (block.timestamp < item.refundAt) revert RefundNotReady();
        item.status = Status.Refunded;
        uint256 amount = item.amount;
        lockedTotal -= amount;
        emit Refunded(msg.sender, tradeId, amount);
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert PaymentFailed();
    }

    function getSwap(address funder, bytes32 tradeId) external view returns (Swap memory) {
        return swaps[funder][tradeId];
    }
}
