// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract BookRentalEscrow is AccessControl, ReentrancyGuard, Pausable {
    // =========================================================
    // Global Roles
    // =========================================================
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // =========================================================
    // Enums
    // =========================================================
    enum RentalStatus {
        Requested,
        Accepted,
        Rejected,
        Paid,
        Shipped,
        Delivered,
        ReturnRequested,
        Completed,
        Cancelled,
        Disputed
    }

    // =========================================================
    // Structs
    // =========================================================
    struct Rental {
        uint256 rentalId;
        uint256 bookId;
        address owner;
        address renter;
        uint256 deposit;
        uint256 shippingFee;
        uint256 createdAt;
        uint256 dueDate;
        RentalStatus status;
    }

    // =========================================================
    // Storage
    // =========================================================
    mapping(uint256 => Rental) public rentals;
    mapping(address => uint256) private claimableBalances;
    uint256 public nextRentalId;

    // =========================================================    
    // Events
    // =========================================================
    event RentalCreated(
        uint256 indexed rentalId,
        uint256 indexed bookId,
        address indexed renter,
        address owner,
        uint256 deposit,
        uint256 shippingFee,
        uint256 dueDate
    );

    event RentalAccepted(uint256 indexed rentalId);
    event RentalRejected(uint256 indexed rentalId);
    event RentalCancelled(uint256 indexed rentalId);
    event DepositPaid(uint256 indexed rentalId, uint256 amount);
    event Shipped(uint256 indexed rentalId);
    event Delivered(uint256 indexed rentalId);
    event ReturnRequested(uint256 indexed rentalId);
    event RentalCompleted(
        uint256 indexed rentalId,
        uint256 ownerAmount,
        uint256 renterAmount
    );
    event RentalDisputed(uint256 indexed rentalId);
    event DisputeResolved(
        uint256 indexed rentalId,
        uint256 ownerAmount,
        uint256 renterAmount
    );
    event ClaimableBalanceIncreased(
        uint256 indexed rentalId,
        address indexed account,
        uint256 amount
    );
    event Withdrawn(address indexed account, uint256 amount);

    // =========================================================
    // Errors
    // =========================================================
    error RentalNotFound();
    error InvalidStatus();
    error NotOwner();
    error NotRenter();
    error NotParticipant();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidDueDate();
    error WrongPaymentAmount();
    error TransferFailed();
    error NoClaimableBalance();
    error OverdueNotReached();

    // =========================================================
    // Constructor
    // =========================================================
    constructor(address admin) {
        if (admin == address(0)) revert InvalidAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);

        nextRentalId = 1;
    }

    // =========================================================
    // Main Functions
    // =========================================================

    /// @notice renter가 대여 요청 생성
    function createRental(
        uint256 bookId,
        address owner,
        uint256 deposit,
        uint256 shippingFee,
        uint256 dueDate
    ) external whenNotPaused returns (uint256 rentalId) {
        if (owner == address(0)) revert InvalidAddress();
        if (deposit == 0 && shippingFee == 0) revert InvalidAmount();
        if (dueDate <= block.timestamp) revert InvalidDueDate();

        rentalId = nextRentalId;
        nextRentalId++;

        rentals[rentalId] = Rental({
            rentalId: rentalId,
            bookId: bookId,
            owner: owner,
            renter: msg.sender,
            deposit: deposit,
            shippingFee: shippingFee,
            createdAt: block.timestamp,
            dueDate: dueDate,
            status: RentalStatus.Requested
        });

        emit RentalCreated(
            rentalId,
            bookId,
            msg.sender,
            owner,
            deposit,
            shippingFee,
            dueDate
        );
    }

    /// @notice owner가 대여 요청 수락
    function acceptRental(uint256 rentalId) external whenNotPaused {
        Rental storage rental = _getRental(rentalId);

        if (msg.sender != rental.owner) revert NotOwner();
        if (rental.status != RentalStatus.Requested) revert InvalidStatus();

        rental.status = RentalStatus.Accepted;

        emit RentalAccepted(rentalId);
    }

    /// @notice owner가 대여 요청 거절
    function rejectRental(uint256 rentalId) external whenNotPaused {
        Rental storage rental = _getRental(rentalId);

        if (msg.sender != rental.owner) revert NotOwner();
        if (rental.status != RentalStatus.Requested) revert InvalidStatus();

        rental.status = RentalStatus.Rejected;

        emit RentalRejected(rentalId);
    }

    /// @notice renter 또는 owner가 취소
    function cancelRental(uint256 rentalId) external whenNotPaused {
        Rental storage rental = _getRental(rentalId);

        // Requested: renter만 철회 가능
        if (rental.status == RentalStatus.Requested) {
            if (msg.sender != rental.renter) revert NotRenter();
        }
        // Accepted: owner / renter 둘 다 가능
        else if (rental.status == RentalStatus.Accepted) {
            if (msg.sender != rental.owner && msg.sender != rental.renter) {
                revert NotParticipant();
            }
        } else {
            revert InvalidStatus();
        }

        rental.status = RentalStatus.Cancelled;

        emit RentalCancelled(rentalId);
    }

    /// @notice renter가 보증금 + 배송비 예치
    function payDepositAndShipping(uint256 rentalId)
        external
        payable
        whenNotPaused
    {
        Rental storage rental = _getRental(rentalId);

        if (msg.sender != rental.renter) revert NotRenter();
        if (rental.status != RentalStatus.Accepted) revert InvalidStatus();

        uint256 totalAmount = rental.deposit + rental.shippingFee;
        if (msg.value != totalAmount) revert WrongPaymentAmount();

        rental.status = RentalStatus.Paid;

        emit DepositPaid(rentalId, msg.value);
    }

    /// @notice owner가 발송 완료 처리
    function markShipped(uint256 rentalId) external whenNotPaused {
        Rental storage rental = _getRental(rentalId);

        if (msg.sender != rental.owner) revert NotOwner();
        if (rental.status != RentalStatus.Paid) revert InvalidStatus();

        rental.status = RentalStatus.Shipped;

        emit Shipped(rentalId);
    }

    /// @notice renter가 수령 확인
    function confirmDelivered(uint256 rentalId) external whenNotPaused {
        Rental storage rental = _getRental(rentalId);

        if (msg.sender != rental.renter) revert NotRenter();
        if (rental.status != RentalStatus.Shipped) revert InvalidStatus();

        rental.status = RentalStatus.Delivered;

        emit Delivered(rentalId);
    }

    /// @notice renter가 반납 완료 표시
    function requestReturn(uint256 rentalId) external whenNotPaused {
        Rental storage rental = _getRental(rentalId);

        if (msg.sender != rental.renter) revert NotRenter();
        if (rental.status != RentalStatus.Delivered) revert InvalidStatus();

        rental.status = RentalStatus.ReturnRequested;

        emit ReturnRequested(rentalId);
    }

    /// @notice owner가 반납 확인 후 정산 완료
    function confirmReturnAndComplete(uint256 rentalId)
        external
        whenNotPaused
        nonReentrant
    {
        Rental storage rental = _getRental(rentalId);

        if (msg.sender != rental.owner) revert NotOwner();
        if (rental.status != RentalStatus.ReturnRequested) revert InvalidStatus();

        uint256 ownerAmount = rental.shippingFee;
        uint256 renterAmount = rental.deposit;

        rental.status = RentalStatus.Completed;

        _increaseClaimable(rentalId, rental.owner, ownerAmount);
        _increaseClaimable(rentalId, rental.renter, renterAmount);

        emit RentalCompleted(rentalId, ownerAmount, renterAmount);
    }

    /// @notice owner 또는 renter가 분쟁 제기
    /// @dev Overdue 상태를 별도 enum으로 두지 않고, dueDate 초과를 분쟁 진입 근거로 사용한다.
    ///      Delivered 상태에서는 owner가 dueDate 초과 시에만 분쟁 제기 가능하다.
    function markDisputed(uint256 rentalId) external whenNotPaused {
        Rental storage rental = _getRental(rentalId);

        if (msg.sender != rental.owner && msg.sender != rental.renter) {
            revert NotParticipant();
        }

        if (
            rental.status != RentalStatus.Paid &&
            rental.status != RentalStatus.Shipped &&
            rental.status != RentalStatus.Delivered &&
            rental.status != RentalStatus.ReturnRequested
        ) revert InvalidStatus();

        if (
            rental.status == RentalStatus.Delivered &&
            msg.sender == rental.owner &&
            block.timestamp <= rental.dueDate
        ) revert OverdueNotReached();

        rental.status = RentalStatus.Disputed;

        emit RentalDisputed(rentalId);
    }

    /// @notice admin이 분쟁 정산
    /// @dev 현재 분쟁 정산은 관리자 중재 기반의 MVP 정책이다.
    ///      자동 판정 로직/온체인 증빙 기반 정책은 아직 구현하지 않았고,
    ///      향후 멀티시그/타임락/정책 기반 정산으로 확장 가능하다.
    function resolveDispute(
        uint256 rentalId,
        uint256 ownerAmount,
        uint256 renterAmount
    ) external whenNotPaused onlyRole(ADMIN_ROLE) nonReentrant {
        Rental storage rental = _getRental(rentalId);

        if (rental.status != RentalStatus.Disputed) revert InvalidStatus();

        uint256 totalLocked = rental.deposit + rental.shippingFee;
        if (ownerAmount + renterAmount != totalLocked) revert InvalidAmount();

        rental.status = RentalStatus.Completed;

        _increaseClaimable(rentalId, rental.owner, ownerAmount);
        _increaseClaimable(rentalId, rental.renter, renterAmount);

        emit DisputeResolved(rentalId, ownerAmount, renterAmount);
    }

    // =========================================================
    // View Functions
    // =========================================================

    function getRental(uint256 rentalId) external view returns (Rental memory) {
        Rental memory rental = rentals[rentalId];
        if (rental.owner == address(0)) revert RentalNotFound();
        return rental;
    }

    function getRentalStatus(uint256 rentalId)
        external
        view
        returns (RentalStatus)
    {
        Rental memory rental = rentals[rentalId];
        if (rental.owner == address(0)) revert RentalNotFound();
        return rental.status;
    }

    function claimableBalanceOf(address account) external view returns (uint256) {
        return claimableBalances[account];
    }

    // =========================================================
    // Admin Functions
    // =========================================================

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function withdraw() external nonReentrant whenNotPaused {
        uint256 amount = claimableBalances[msg.sender];
        if (amount == 0) revert NoClaimableBalance();

        claimableBalances[msg.sender] = 0;
        _sendETH(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    // =========================================================
    // Internal Helpers
    // =========================================================

    function _getRental(uint256 rentalId)
        internal
        view
        returns (Rental storage rental)
    {
        rental = rentals[rentalId];
        if (rental.owner == address(0)) revert RentalNotFound();
    }

    function _increaseClaimable(
        uint256 rentalId,
        address account,
        uint256 amount
    ) internal {
        if (amount == 0) return;

        claimableBalances[account] += amount;
        emit ClaimableBalanceIncreased(rentalId, account, amount);
    }

    function _sendETH(address to, uint256 amount) internal {
        (bool success, ) = payable(to).call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}