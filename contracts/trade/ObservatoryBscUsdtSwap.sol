// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

/// @notice A fixed-token, SHA-256 hash-time-locked swap leg for BSC testnet.
/// @dev The token is selected at deployment and cannot be changed. Both chain
///      locks must be independently verified before revealing the secret.
///      Fee-on-transfer, rebasing and dishonest tokens are not supported.
contract ObservatoryBscUsdtSwap {
    uint256 public constant MIN_LOCK_SECONDS = 1 hours;
    uint256 public constant MAX_LOCK_SECONDS = 7 days;
    uint256 public constant SUPPORTED_CHAIN_ID = 97;
    uint8 public constant TOKEN_DECIMALS = 18;
    // Assigned only in the constructor. Storage keeps deployed runtime identical
    // between deployments; verifying the runtime alone does NOT verify the token.
    address public token;
    enum Status { Empty, Locked, Claimed, Refunded }
    struct Swap {
        address recipient;
        uint256 amount;
        bytes32 hashlock;
        uint64 refundAt;
        Status status;
    }
    mapping(address => mapping(bytes32 => Swap)) private swaps;
    uint256 public lockedTotal;
    uint256 private entered;

    error InvalidTerms();
    error InvalidAmount();
    error InvalidToken();
    error WrongNetwork();
    error SwapAlreadyExists();
    error SwapNotLocked();
    error NotRecipient();
    error WrongSecret();
    error ClaimExpired();
    error RefundNotReady();
    error PaymentFailed();
    error InexactTransfer();
    error ReentrantCall();

    event Locked(address indexed funder, bytes32 indexed tradeId, address indexed recipient,
                 uint256 amount, bytes32 hashlock, uint64 refundAt);
    event Claimed(address indexed funder, bytes32 indexed tradeId, address indexed recipient,
                  uint256 amount, bytes32 secret);
    event Refunded(address indexed funder, bytes32 indexed tradeId, uint256 amount);

    constructor(address token_) {
        if (block.chainid != SUPPORTED_CHAIN_ID) revert WrongNetwork();
        if (token_ == address(0) || token_.code.length == 0) revert InvalidToken();
        token = token_;
        (bool ok, bytes memory data) = token_.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || data.length != 32 || abi.decode(data, (uint256)) != TOKEN_DECIMALS) revert InvalidToken();
        _balance(address(this));
    }

    modifier nonReentrant() {
        if (entered != 0) revert ReentrantCall();
        entered = 1;
        _;
        entered = 0;
    }

    /// @notice Approve this contract for exactly amount tokens before opening.
    /// @dev Nonpayable: native BNB is used only for transaction fees.
    function open(bytes32 tradeId, address recipient, bytes32 hashlock, uint256 amount, uint64 refundAt)
        external nonReentrant
    {
        if (block.chainid != SUPPORTED_CHAIN_ID) revert WrongNetwork();
        if (tradeId == bytes32(0) || hashlock == bytes32(0) || recipient == address(0)
            || recipient == msg.sender || recipient == address(this) || recipient == token
            || refundAt < block.timestamp + MIN_LOCK_SECONDS
            || refundAt > block.timestamp + MAX_LOCK_SECONDS) revert InvalidTerms();
        if (amount == 0) revert InvalidAmount();
        if (swaps[msg.sender][tradeId].status != Status.Empty) revert SwapAlreadyExists();
        uint256 beforeEscrow = _balance(address(this));
        uint256 beforeFunder = _balance(msg.sender);
        swaps[msg.sender][tradeId] = Swap(recipient, amount, hashlock, refundAt, Status.Locked);
        lockedTotal += amount;
        _transfer(abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount));
        uint256 afterEscrow = _balance(address(this));
        uint256 afterFunder = _balance(msg.sender);
        if (afterEscrow < beforeEscrow || afterEscrow - beforeEscrow != amount
            || beforeFunder < afterFunder || beforeFunder - afterFunder != amount) revert InexactTransfer();
        emit Locked(msg.sender, tradeId, recipient, amount, hashlock, refundAt);
    }

    function claim(address funder, bytes32 tradeId, bytes32 secret) external nonReentrant {
        Swap storage item = swaps[funder][tradeId];
        if (item.status != Status.Locked) revert SwapNotLocked();
        if (msg.sender != item.recipient) revert NotRecipient();
        if (block.timestamp >= item.refundAt) revert ClaimExpired();
        if (sha256(abi.encodePacked(secret)) != item.hashlock) revert WrongSecret();
        item.status = Status.Claimed;
        uint256 amount = item.amount;
        lockedTotal -= amount;
        emit Claimed(funder, tradeId, item.recipient, amount, secret);
        _pay(item.recipient, amount);
    }

    function refund(bytes32 tradeId) external nonReentrant {
        Swap storage item = swaps[msg.sender][tradeId];
        if (item.status != Status.Locked) revert SwapNotLocked();
        if (block.timestamp < item.refundAt) revert RefundNotReady();
        item.status = Status.Refunded;
        uint256 amount = item.amount;
        lockedTotal -= amount;
        emit Refunded(msg.sender, tradeId, amount);
        _pay(msg.sender, amount);
    }

    function getSwap(address funder, bytes32 tradeId) external view returns (Swap memory) {
        return swaps[funder][tradeId];
    }

    function _balance(address account) private view returns (uint256 value) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", account));
        if (!ok || data.length != 32) revert InvalidToken();
        value = abi.decode(data, (uint256));
    }

    function _transfer(bytes memory callData) private {
        if (token.code.length == 0) revert InvalidToken();
        (bool ok, bytes memory data) = token.call(callData);
        // Legacy USDT-style no-return transfers and standard true returns only.
        if (!ok || (data.length != 0 && (data.length != 32 || abi.decode(data, (uint256)) != 1))) revert PaymentFailed();
    }

    function _pay(address recipient, uint256 amount) private {
        uint256 beforeEscrow = _balance(address(this));
        uint256 beforeRecipient = _balance(recipient);
        _transfer(abi.encodeWithSignature("transfer(address,uint256)", recipient, amount));
        uint256 afterEscrow = _balance(address(this));
        uint256 afterRecipient = _balance(recipient);
        if (beforeEscrow < afterEscrow || beforeEscrow - afterEscrow != amount
            || afterRecipient < beforeRecipient || afterRecipient - beforeRecipient != amount) revert InexactTransfer();
    }
}
