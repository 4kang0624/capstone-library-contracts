# capstone-library-contracts

Capstone Design Library Project의 P2P 도서 대여용 스마트 컨트랙트 저장소입니다.

## Stack

- Solidity `0.8.28`
- Hardhat `3.x`
- TypeScript
- OpenZeppelin Contracts
- Hardhat Ignition

## Project Structure

```text
contracts/
	BookRentalEscrow.sol
ignition/modules/
	BookRentalEscrow.ts
test/
	BookRentalEscrow.unit.ts
	BookRentalEscrow.flow.ts
hardhat.config.ts
```

## Prerequisites

- Node.js 20+
- npm

## Install

```bash
npm install
```

## Compile

```bash
npx hardhat compile
```

## Test

`package.json`의 `test` 스크립트는 기본 placeholder이므로, Hardhat 명령으로 실행합니다.

```bash
npx hardhat test
```

## Run Local Hardhat Node

```bash
npx hardhat node
```

기본 로컬 계정(Account #0):

```text
0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

## Deploy With Hardhat Ignition (localhost)

배포 모듈은 `ignition/modules/BookRentalEscrow.ts`를 사용합니다.

기본 admin 주소(Account #0)로 배포:

```bash
npx hardhat ignition deploy ignition/modules/BookRentalEscrow.ts --network localhost
```

### Override admin Parameter

모듈은 `admin` 파라미터를 받습니다. 다른 주소를 쓰려면 파라미터 파일을 사용합니다.

예시 `ignition/parameters.json`:

```json
{
	"BookRentalEscrowModule": {
		"admin": "0xYourAdminAddressHere"
	}
}
```

배포 명령:

```bash
npx hardhat ignition deploy ignition/modules/BookRentalEscrow.ts --network localhost --parameters ignition/parameters.json
```

## Main Contract

`BookRentalEscrow` 생성자:

```solidity
constructor(address admin)
```

핵심 기능:

- 대여 요청 생성/수락/거절/취소
- 보증금 + 배송비 에스크로 예치
- 배송/수령/반납 상태 전이
- 분쟁 처리 및 정산
- 출금(Claimable Balance)

## Notes

- 본 저장소는 컨트랙트 중심 저장소입니다.
- 실제 서비스 배포 시에는 `admin`을 운영자 지갑으로 반드시 변경하세요.
