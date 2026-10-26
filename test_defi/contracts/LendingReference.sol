// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

/// @notice Offline ERC20 reference: one funded offer becomes one fixed-term loan.
/// @dev NOT compatible with the current native UTXO tUSDT in Nodus Wallet.
///      The test token is MockUSDT6; native-token custody needs a separate adapter.
/// @dev EXPERIMENTAL. There is deliberately no price oracle or credit-score gate.
///      A lender chooses an exact NODUS collateral amount, not a live LTV ratio.
///      Default awards ALL agreed collateral to the lender, even if worth more
///      than the debt. This test rule is unsuitable for a production credit market.
///      Compile with Nodus addr256 Solidity: stock Ethereum addresses are 20 bytes.
contract LendingReference {
    uint256 public constant SUPPORTED_CHAIN_ID = 0xa48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114;
    uint256 public constant NODUS_QUANTUM = 10000000000;
    uint256 public constant MAX_PRINCIPAL = 1e24; // MockUSDT6 has six decimal places.
    uint256 public constant MAX_COLLATERAL = 1e34; // NODUS raw8 * 1e10 VM wei.
    uint256 private constant INTEREST_DENOMINATOR = 10000 * 365;

    enum Status { Empty, Open, Active, Repaid, Cancelled, Defaulted }
    struct Offer {
        address lender;
        address borrower;
        uint256 principal;
        uint256 collateral;
        uint256 interest;
        uint64 expiresAt;
        uint64 acceptedAt;
        uint64 dueAt;
        uint64 deadline;
        uint16 aprBps;
        uint16 termDays;
        uint8 graceDays;
        Status status;
    }

    // Configured once at deployment; no administrator or token replacement exists.
    address public token;
    uint256 public nextOfferId = 1;
    mapping(uint256 => Offer) private offers;
    mapping(address => uint256) public tokenCredit;
    mapping(address => uint256) public collateralCredit;
    // Liabilities include open escrow/active collateral AND unwithdrawn credits.
    uint256 public tokenLiability;
    uint256 public collateralLiability;
    uint256 private entered;

    error WrongNetwork();
    error InvalidToken();
    error InvalidTerms();
    error InvalidAmount();
    error InvalidState();
    error Unauthorized();
    error Expired();
    error TooEarly();
    error TokenTransferFailed();
    error NativeTransferFailed();
    error ReentrantCall();

    event Offered(uint256 indexed id, address indexed lender, uint256 principal,
        uint256 collateral, uint256 interest, uint64 expiresAt, uint16 aprBps,
        uint16 termDays, uint8 graceDays);
    event Accepted(uint256 indexed id, address indexed borrower, uint64 dueAt, uint64 deadline);
    event Repaid(uint256 indexed id, uint256 amount);
    event Cancelled(uint256 indexed id);
    event Defaulted(uint256 indexed id);
    event TokenWithdrawn(address indexed owner, address indexed recipient, uint256 amount);
    event CollateralWithdrawn(address indexed owner, address indexed recipient, uint256 amount);

    modifier nonReentrant() {
        if (entered != 0) revert ReentrantCall();
        entered = 1;
        _;
        entered = 0;
    }

    constructor(address tokenAddress) {
        if (block.chainid != SUPPORTED_CHAIN_ID) revert WrongNetwork();
        if (tokenAddress.code.length == 0) revert InvalidToken();
        (bool ok, bytes memory result) = tokenAddress.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || result.length != 32 || abi.decode(result, (uint256)) != 6) revert InvalidToken();
        token = tokenAddress;
    }

    /// @notice Interest is charged for the whole agreed term, also on early repayment.
    /// @dev Round UP once in MockUSDT6's smallest unit; bounded inputs avoid overflow.
    function calculateInterest(uint256 principal, uint16 aprBps, uint16 termDays)
        public pure returns (uint256)
    {
        if (principal == 0 || principal > MAX_PRINCIPAL || aprBps == 0 || aprBps > 5000
            || termDays == 0 || termDays > 365) revert InvalidTerms();
        uint256 numerator = principal * uint256(aprBps) * uint256(termDays);
        return (numerator + INTEREST_DENOMINATOR - 1) / INTEREST_DENOMINATOR;
    }

    /// @notice Fund the entire offer now; it cannot promise unavailable liquidity.
    /// @dev Offers are indivisible. Cancel unused offers to recover their token credit.
    function createOffer(uint256 principal, uint256 collateral, uint16 aprBps,
        uint16 termDays, uint8 graceDays, uint64 expiresAt) external nonReentrant returns (uint256 id)
    {
        uint256 interest = calculateInterest(principal, aprBps, termDays);
        if (collateral == 0 || collateral > MAX_COLLATERAL || collateral % NODUS_QUANTUM != 0)
            revert InvalidAmount();
        if (graceDays == 0 || graceDays > 30 || expiresAt <= block.timestamp
            || expiresAt > block.timestamp + 30 days) revert InvalidTerms();
        id = nextOfferId++;
        offers[id] = Offer(msg.sender, address(0), principal, collateral, interest,
            expiresAt, 0, 0, 0, aprBps, termDays, graceDays, Status.Open);
        tokenLiability += principal;
        _moveToken(msg.sender, address(this), principal, true);
        emit Offered(id, msg.sender, principal, collateral, interest, expiresAt, aprBps, termDays, graceDays);
    }

    function cancel(uint256 id) external nonReentrant {
        Offer storage item = offers[id];
        if (item.status != Status.Open) revert InvalidState();
        if (msg.sender != item.lender) revert Unauthorized();
        item.status = Status.Cancelled;
        tokenCredit[msg.sender] += item.principal;
        emit Cancelled(id);
    }

    /// @notice Exchange exact NODUS collateral for the full offered mock-token principal.
    function accept(uint256 id) external payable nonReentrant {
        Offer storage item = offers[id];
        if (item.status != Status.Open) revert InvalidState();
        if (msg.sender == item.lender) revert Unauthorized();
        if (block.timestamp >= item.expiresAt) revert Expired();
        if (msg.value != item.collateral) revert InvalidAmount();
        item.status = Status.Active;
        item.borrower = msg.sender;
        item.acceptedAt = uint64(block.timestamp);
        item.dueAt = uint64(block.timestamp + uint256(item.termDays) * 1 days);
        item.deadline = uint64(uint256(item.dueAt) + uint256(item.graceDays) * 1 days);
        collateralLiability += msg.value;
        tokenLiability -= item.principal;
        _moveToken(address(this), msg.sender, item.principal, false);
        emit Accepted(id, msg.sender, item.dueAt, item.deadline);
    }

    /// @notice Repayment remains possible during the agreed grace period.
    /// @dev Strict boundary: at deadline repayment ends and lender default begins.
    function repay(uint256 id) external nonReentrant {
        Offer storage item = offers[id];
        if (item.status != Status.Active) revert InvalidState();
        if (msg.sender != item.borrower) revert Unauthorized();
        if (block.timestamp >= item.deadline) revert Expired();
        uint256 amount = item.principal + item.interest;
        item.status = Status.Repaid;
        tokenLiability += amount;
        tokenCredit[item.lender] += amount;
        collateralCredit[item.borrower] += item.collateral;
        _moveToken(msg.sender, address(this), amount, true);
        emit Repaid(id, amount);
    }

    function claimDefault(uint256 id) external nonReentrant {
        Offer storage item = offers[id];
        if (item.status != Status.Active) revert InvalidState();
        if (msg.sender != item.lender) revert Unauthorized();
        if (block.timestamp < item.deadline) revert TooEarly();
        item.status = Status.Defaulted;
        collateralCredit[item.lender] += item.collateral;
        emit Defaulted(id);
    }

    /// @notice Credits separate settlement from payment to a possibly rejecting recipient.
    /// @dev Owner can choose another destination; failed withdrawal preserves the credit.
    function withdrawCollateral(address payable recipient) external nonReentrant {
        uint256 amount = collateralCredit[msg.sender];
        if (amount == 0 || recipient == address(0) || recipient == address(this)) revert InvalidAmount();
        collateralCredit[msg.sender] = 0;
        collateralLiability -= amount;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
        emit CollateralWithdrawn(msg.sender, recipient, amount);
    }

    function withdrawToken(address recipient) external nonReentrant {
        uint256 amount = tokenCredit[msg.sender];
        if (amount == 0 || recipient == address(0) || recipient == address(this)) revert InvalidAmount();
        tokenCredit[msg.sender] = 0;
        tokenLiability -= amount;
        _moveToken(address(this), recipient, amount, false);
        emit TokenWithdrawn(msg.sender, recipient, amount);
    }

    function getOffer(uint256 id) external view returns (Offer memory) { return offers[id]; }

    function _balance(address account) private view returns (uint256) {
        (bool ok, bytes memory result) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", account));
        if (!ok || result.length != 32) revert TokenTransferFailed();
        return abi.decode(result, (uint256));
    }

    // This MVP supports only exact, standard bool-returning token transfers.
    // Checking both deltas rejects taxed/rebasing transfers and false-success tokens.
    // A malicious configurable token remains a trust assumption, not solved by checks.
    function _moveToken(address from, address to, uint256 amount, bool pull) private {
        uint256 beforeFrom = _balance(from);
        uint256 beforeTo = _balance(to);
        bytes memory input = pull
            ? abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount)
            : abi.encodeWithSignature("transfer(address,uint256)", to, amount);
        (bool ok, bytes memory result) = token.call(input);
        if (!ok || result.length != 32 || abi.decode(result, (uint256)) != 1) revert TokenTransferFailed();
        uint256 afterFrom = _balance(from);
        uint256 afterTo = _balance(to);
        if (beforeFrom < amount || afterFrom != beforeFrom - amount || afterTo < beforeTo
            || afterTo - beforeTo != amount) revert TokenTransferFailed();
    }
}
