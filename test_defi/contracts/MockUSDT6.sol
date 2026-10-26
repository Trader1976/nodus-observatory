// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

/// @dev Test helper only. Anyone can mint or change behavior; never deploy as money.
contract MockUSDT6 {
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint8 public mode; // 1=false; 2=recipient tax; 3=sender tax; 4=success/no movement.
    address public hookTarget;
    bytes public hookData;
    bytes4 public hookError;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function setMode(uint8 value) external { mode = value; }
    function setDecimals(uint8 value) external { decimals = value; }
    function setHook(address target, bytes calldata data) external { hookTarget = target; hookData = data; }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount; return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        return _move(msg.sender, to, amount);
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        return _move(from, to, amount);
    }
    function _move(address from, address to, uint256 amount) private returns (bool) {
        if (hookTarget != address(0)) {
            (bool ok, bytes memory result) = hookTarget.call(hookData);
            require(!ok && result.length >= 4, "hook must fail");
            hookError = bytes4(result);
        }
        if (mode == 1) return false;
        if (mode == 4) return true;
        uint256 debit = amount + (mode == 3 ? 1 : 0);
        require(balanceOf[from] >= debit, "balance");
        balanceOf[from] -= debit;
        balanceOf[to] += amount - (mode == 2 ? 1 : 0);
        return true;
    }
}

/// @dev Reverts native withdrawals to verify rollback and alternative destinations.
contract MockRejectNative { receive() external payable { revert(); } }

/// @dev Records the guard error when withdrawal invokes an external receiver.
contract MockReenterNative {
    address public target;
    bytes4 public hookError;
    constructor(address loan) { target = loan; }
    receive() external payable {
        (bool ok, bytes memory result) = target.call(abi.encodeWithSignature("withdrawCollateral(address)", address(this)));
        require(!ok && result.length >= 4, "hook must fail");
        hookError = bytes4(result);
    }
}
