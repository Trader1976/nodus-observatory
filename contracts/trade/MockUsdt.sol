// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

/// @notice Freely minted TEST-USDT for BSC testnet only. No monetary value.
/// @dev This is NOT Tether USDt or Binance-Peg USDT and has no backing.
contract MockUsdt {
    string public constant name = "Observatory test token - no value";
    string public constant symbol = "TEST-USDT";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    error WrongNetwork();
    error InvalidTransfer();
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() { if (block.chainid != 97) revert WrongNetwork(); }

    function faucet() external {
        uint256 value = 1_000_000 * 10 ** 18;
        totalSupply += value;
        balanceOf[msg.sender] += value;
        emit Transfer(address(0), msg.sender, value);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < value) revert InvalidTransfer();
        allowance[from][msg.sender] = allowed - value;
        _move(from, to, value);
        return true;
    }

    function _move(address from, address to, uint256 value) private {
        if (to == address(0) || balanceOf[from] < value) revert InvalidTransfer();
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
