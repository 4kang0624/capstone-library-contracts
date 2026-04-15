// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract BookRentalEscrow {
    enum Status {
        Created,
        Accepted,
        Shipped,
        Received,
        Settled,
        Cancelled
    }

    struct Rental {
        address lender;
        address renter;
        string bookId;
        uint256 rentPrice;
        uint256 deposit;
        uint256 shippingFee;
        uint256 durationDays;
        Status status;
    }

    uint256 public nextRentalId;
    mapping(uint256 => Rental) public rentals;
    mapping(address => uint256) public pendingWithdrawals;

    event OfferCreated(uint256 indexed rentalId, address indexed lender, string bookId);
    event OfferAccepted(uint256 indexed rentalId, address indexed renter);
    event BookShipped(uint256 indexed rentalId);
    event BookReceived(uint256 indexed rentalId);
    event RentalSettled(uint256 indexed rentalId, uint256 lenderShare, uint256 renterShare);
    event OfferCancelled(uint256 indexed rentalId);
    event Withdrawal(address indexed user, uint256 amount);

    function createOffer(
        string calldata bookId,
        uint256 rentPrice,
        uint256 deposit,
        uint256 shippingFee,
        uint256 durationDays
    ) external returns (uint256 rentalId) {
        require(bytes(bookId).length > 0, "bookId required");
        require(durationDays > 0, "duration required");

        rentalId = nextRentalId++;
        rentals[rentalId] = Rental({
            lender: msg.sender,
            renter: address(0),
            bookId: bookId,
            rentPrice: rentPrice,
            deposit: deposit,
            shippingFee: shippingFee,
            durationDays: durationDays,
            status: Status.Created
        });

        emit OfferCreated(rentalId, msg.sender, bookId);
    }

    function acceptOffer(uint256 rentalId) external payable {
        Rental storage rental = rentals[rentalId];
        require(rental.lender != address(0), "invalid rental");
        require(rental.status == Status.Created, "not open");
        require(msg.sender != rental.lender, "lender cannot rent");

        uint256 totalRequired = rental.rentPrice + rental.deposit + rental.shippingFee;
        require(msg.value == totalRequired, "incorrect escrow amount");

        rental.renter = msg.sender;
        rental.status = Status.Accepted;

        emit OfferAccepted(rentalId, msg.sender);
    }

    function markShipped(uint256 rentalId) external {
        Rental storage rental = rentals[rentalId];
        require(msg.sender == rental.lender, "only lender");
        require(rental.status == Status.Accepted, "invalid status");

        rental.status = Status.Shipped;
        emit BookShipped(rentalId);
    }

    function confirmReceived(uint256 rentalId) external {
        Rental storage rental = rentals[rentalId];
        require(msg.sender == rental.renter, "only renter");
        require(rental.status == Status.Shipped, "invalid status");

        rental.status = Status.Received;
        _credit(rental.lender, rental.rentPrice + rental.shippingFee);

        emit BookReceived(rentalId);
    }

    function settleRental(uint256 rentalId, uint256 lenderDamageShare) external {
        Rental storage rental = rentals[rentalId];
        require(msg.sender == rental.lender, "only lender");
        require(rental.status == Status.Received, "invalid status");
        require(lenderDamageShare <= rental.deposit, "damage exceeds deposit");

        rental.status = Status.Settled;
        uint256 renterShare = rental.deposit - lenderDamageShare;

        if (lenderDamageShare > 0) {
            _credit(rental.lender, lenderDamageShare);
        }

        if (renterShare > 0) {
            _credit(rental.renter, renterShare);
        }

        emit RentalSettled(rentalId, lenderDamageShare, renterShare);
    }

    function cancelOffer(uint256 rentalId) external {
        Rental storage rental = rentals[rentalId];
        require(msg.sender == rental.lender, "only lender");
        require(rental.status == Status.Created, "cannot cancel");

        rental.status = Status.Cancelled;
        emit OfferCancelled(rentalId);
    }

    function withdraw() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "nothing to withdraw");

        pendingWithdrawals[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "withdraw failed");

        emit Withdrawal(msg.sender, amount);
    }

    function _credit(address user, uint256 amount) internal {
        pendingWithdrawals[user] += amount;
    }
}
