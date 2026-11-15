import { parseAbi } from "viem"

export const ORACLE_ABI = parseAbi([
  "function getCell(bytes32 cellId) view returns ((uint32 epoch, int16 tempBiasX10, uint16 rainRatioBps, uint16 moistureX100, uint16 qualityBps, uint8 accepted))",
  "function lastSettledEpoch() view returns (uint256)",
  "function claimed(uint256 epoch, address account) view returns (bool)",
  "function claim(uint256 epoch, uint256 amount, bytes32[] proof)",
])

export const TOKEN_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function redeem(uint256 fieldAmount)",
  "function usdcValue(uint256 fieldAmount) view returns (uint256)",
])

export const SUBSCRIPTION_ABI = parseAbi([
  "function isActive(address farmer) view returns (bool)",
  "function paidUntil(address farmer) view returns (uint256)",
  "function PRICE_PER_PERIOD() view returns (uint256)",
  "function subscribe(uint256 periods)",
])

export const USDC_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function faucet(address to, uint256 amount)",
])
