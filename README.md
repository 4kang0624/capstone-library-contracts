# capstone-library-contracts

Hardhat project for a capstone P2P library platform.

## Contract

`BookRentalEscrow.sol` supports:
- lender-created rental offers
- renter escrow payment (`rent + deposit + shipping fee`)
- shipping confirmation flow
- settlement with optional deposit deduction for damages
- pull-based withdrawals for safer payouts

## Quick start

```bash
npm install
cp .env.example .env
npm run compile
npm test
```

## Environment variables

Use `.env` (see `.env.example`):
- `SEPOLIA_RPC_URL` - RPC endpoint for testnet deployment
- `PRIVATE_KEY` - deployer private key
