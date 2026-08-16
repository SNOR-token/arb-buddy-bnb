// Generated from contracts/FlashArb.sol — kept in sync for the deploy page.
export const FLASH_ARB_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
 * FlashArb — Aave V3 flashloan DEX arbitrage executor for BNB Chain.
 *
 * Flow (single transaction):
 *   1. flashLoanSimple(asset, amount) from the Aave V3 Pool
 *   2. swap asset -> intermediate on buyRouter   (the cheap venue)
 *   3. swap intermediate -> asset on sellRouter  (the rich venue)
 *   4. repay amount + premium, keep the remainder as profit
 *   5. revert unless profit >= minProfit  (atomic: no loss beyond gas)
 *
 * Both routers must be UniswapV2-style (PancakeSwap V2, SushiSwap V2, Biswap...).
 * DEPLOY AND AUDIT AT YOUR OWN RISK. Arbitrage is competitive and can lose gas.
 */

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

contract FlashArb {
    address public immutable owner;
    IPool public immutable POOL;

    error NotOwner();
    error NotPool();
    error Unprofitable(uint256 got, uint256 required);

    event ArbExecuted(
        address indexed asset,
        uint256 amount,
        uint256 premium,
        uint256 profit
    );

    constructor(address pool) {
        owner = msg.sender;
        POOL = IPool(pool);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Kick off a flashloan arbitrage loop.
    function executeArb(
        address asset,
        uint256 amount,
        address intermediate,
        address buyRouter,
        address sellRouter,
        uint256 minProfit
    ) external onlyOwner {
        bytes memory params = abi.encode(intermediate, buyRouter, sellRouter, minProfit);
        POOL.flashLoanSimple(address(this), asset, amount, params, 0);
    }

    /// @notice Aave V3 callback. Only the Pool may call this.
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        if (msg.sender != address(POOL)) revert NotPool();
        if (initiator != address(this)) revert NotOwner();

        (
            address intermediate,
            address buyRouter,
            address sellRouter,
            uint256 minProfit
        ) = abi.decode(params, (address, address, address, uint256));

        // Leg 1: asset -> intermediate on the cheap venue
        _swap(buyRouter, asset, intermediate, amount);

        // Leg 2: intermediate -> asset on the rich venue
        uint256 mid = IERC20(intermediate).balanceOf(address(this));
        _swap(sellRouter, intermediate, asset, mid);

        uint256 owed = amount + premium;
        uint256 balance = IERC20(asset).balanceOf(address(this));
        if (balance < owed + minProfit) revert Unprofitable(balance, owed + minProfit);

        IERC20(asset).approve(address(POOL), owed);
        emit ArbExecuted(asset, amount, premium, balance - owed);
        return true;
    }

    function _swap(address router, address tokenIn, address tokenOut, uint256 amountIn) internal {
        IERC20(tokenIn).approve(router, amountIn);
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        IV2Router(router).swapExactTokensForTokens(
            amountIn,
            0, // profit is enforced atomically at the end of executeOperation
            path,
            address(this),
            block.timestamp
        );
    }

    /// @notice Sweep any token (profits, dust) to the owner.
    function withdraw(address token) external onlyOwner {
        IERC20(token).transfer(owner, IERC20(token).balanceOf(address(this)));
    }

    receive() external payable {}
}
`;
