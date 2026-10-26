// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

/// @notice A valueless, fixed-supply EVM asset for manual Nodus testnet trials.
/// @dev This is NOT native tUSDT, a wrapped token, a stablecoin or a redeemable dollar.
///      The deployer receives all tokens once. There is no mint or administrator.
///      Compile with the Nodus addr256 compiler, not stock Ethereum Solidity.
contract SandboxDollar6 {
    string public constant name = "Observatory Sandbox Dollar";
    string public constant symbol = "OSD6";
    uint8 public constant decimals = 6;
    uint256 public constant totalSupply = 1_000_000 * 1e6;
    uint256 public constant SUPPORTED_CHAIN_ID = 0xa48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    error WrongNetwork();
    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor() {
        if (block.chainid != SUPPORTED_CHAIN_ID) revert WrongNetwork();
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        uint256 available = allowance[from][msg.sender];
        if (available < amount) revert InsufficientAllowance();
        // No unlimited allowance special case: every spend consumes exactly its amount.
        allowance[from][msg.sender] = available - amount;
        emit Approval(from, msg.sender, available - amount);
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();
        uint256 available = balanceOf[from];
        if (available < amount) revert InsufficientBalance();
        // These writes deliberately support self-transfers without changing supply.
        balanceOf[from] = available - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
