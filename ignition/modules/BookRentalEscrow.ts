import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const BookRentalEscrowModule = buildModule("BookRentalEscrowModule", (m) => {
    // 테스트용 로컬네트워크에서 사용할 관리자 주소를 기본값으로 설정합니다. 실제 배포 시에는 이 값을 변경해야 합니다.
	const admin = m.getParameter(
		"admin",
		"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
	);

	const bookRentalEscrow = m.contract("BookRentalEscrow", [admin]);

	return { bookRentalEscrow };
});

export default BookRentalEscrowModule;
