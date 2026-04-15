const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BookRentalEscrow", function () {
  async function setupFixture() {
    const [lender, renter, other] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("BookRentalEscrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    const rentPrice = ethers.parseEther("0.1");
    const deposit = ethers.parseEther("0.2");
    const shippingFee = ethers.parseEther("0.01");

    return { escrow, lender, renter, other, rentPrice, deposit, shippingFee };
  }

  function totalEscrow(rentPrice, deposit, shippingFee) {
    return rentPrice + deposit + shippingFee;
  }

  it("creates and accepts an offer with deposit and shipping fee", async function () {
    const { escrow, lender, renter, rentPrice, deposit, shippingFee } = await setupFixture();

    await expect(
      escrow.connect(lender).createOffer("BOOK-001", rentPrice, deposit, shippingFee, 7)
    )
      .to.emit(escrow, "OfferCreated")
      .withArgs(0n, lender.address, "BOOK-001");

    await expect(
      escrow.connect(renter).acceptOffer(0, { value: totalEscrow(rentPrice, deposit, shippingFee) })
    ).to.emit(escrow, "OfferAccepted");

    const rental = await escrow.rentals(0);
    expect(rental.renter).to.equal(renter.address);
  });

  it("settles escrow by paying lender rent+shipping and splitting deposit", async function () {
    const { escrow, lender, renter, rentPrice, deposit, shippingFee } = await setupFixture();

    await escrow.connect(lender).createOffer("BOOK-002", rentPrice, deposit, shippingFee, 7);
    await escrow
      .connect(renter)
      .acceptOffer(0, { value: totalEscrow(rentPrice, deposit, shippingFee) });
    await escrow.connect(lender).markShipped(0);
    await escrow.connect(renter).confirmReceived(0);

    expect(await escrow.pendingWithdrawals(lender.address)).to.equal(rentPrice + shippingFee);

    const damageShare = ethers.parseEther("0.05");
    await escrow.connect(lender).settleRental(0, damageShare);

    expect(await escrow.pendingWithdrawals(lender.address)).to.equal(
      rentPrice + shippingFee + damageShare
    );
    expect(await escrow.pendingWithdrawals(renter.address)).to.equal(deposit - damageShare);
  });

  it("returns full deposit to renter when there is no damage", async function () {
    const { escrow, lender, renter, rentPrice, deposit, shippingFee } = await setupFixture();

    await escrow.connect(lender).createOffer("BOOK-008", rentPrice, deposit, shippingFee, 7);
    await escrow
      .connect(renter)
      .acceptOffer(0, { value: totalEscrow(rentPrice, deposit, shippingFee) });
    await escrow.connect(lender).markShipped(0);
    await escrow.connect(renter).confirmReceived(0);

    await escrow.connect(lender).settleRental(0, 0);

    expect(await escrow.pendingWithdrawals(lender.address)).to.equal(rentPrice + shippingFee);
    expect(await escrow.pendingWithdrawals(renter.address)).to.equal(deposit);
  });

  it("allows full deposit claim when damage equals deposit", async function () {
    const { escrow, lender, renter, rentPrice, deposit, shippingFee } = await setupFixture();

    await escrow.connect(lender).createOffer("BOOK-004", rentPrice, deposit, shippingFee, 7);
    await escrow
      .connect(renter)
      .acceptOffer(0, { value: totalEscrow(rentPrice, deposit, shippingFee) });
    await escrow.connect(lender).markShipped(0);
    await escrow.connect(renter).confirmReceived(0);

    await escrow.connect(lender).settleRental(0, deposit);

    expect(await escrow.pendingWithdrawals(lender.address)).to.equal(
      rentPrice + shippingFee + deposit
    );
    expect(await escrow.pendingWithdrawals(renter.address)).to.equal(0);
  });

  it("supports lender cancellation while offer is open", async function () {
    const { escrow, lender, other, rentPrice, deposit, shippingFee } = await setupFixture();

    await escrow.connect(lender).createOffer("BOOK-005", rentPrice, deposit, shippingFee, 7);

    await expect(escrow.connect(other).cancelOffer(0)).to.be.revertedWith("only lender");

    await expect(escrow.connect(lender).cancelOffer(0)).to.emit(escrow, "OfferCancelled");
  });

  it("rejects cancellation after offer was accepted", async function () {
    const { escrow, lender, renter, rentPrice, deposit, shippingFee } = await setupFixture();

    await escrow.connect(lender).createOffer("BOOK-009", rentPrice, deposit, shippingFee, 7);
    await escrow
      .connect(renter)
      .acceptOffer(0, { value: totalEscrow(rentPrice, deposit, shippingFee) });

    await expect(escrow.connect(lender).cancelOffer(0)).to.be.revertedWith("cannot cancel");
  });

  it("allows credited users to withdraw", async function () {
    const { escrow, lender, renter, rentPrice, deposit, shippingFee } = await setupFixture();

    await escrow.connect(lender).createOffer("BOOK-006", rentPrice, deposit, shippingFee, 7);
    await escrow
      .connect(renter)
      .acceptOffer(0, { value: totalEscrow(rentPrice, deposit, shippingFee) });
    await escrow.connect(lender).markShipped(0);
    await escrow.connect(renter).confirmReceived(0);

    await expect(escrow.connect(lender).withdraw()).to.emit(escrow, "Withdrawal");
    expect(await escrow.pendingWithdrawals(lender.address)).to.equal(0);
  });

  it("enforces shipping transition permissions", async function () {
    const { escrow, lender, renter, other, rentPrice, deposit, shippingFee } = await setupFixture();

    await escrow.connect(lender).createOffer("BOOK-007", rentPrice, deposit, shippingFee, 7);
    await escrow
      .connect(renter)
      .acceptOffer(0, { value: totalEscrow(rentPrice, deposit, shippingFee) });

    await expect(escrow.connect(other).markShipped(0)).to.be.revertedWith("only lender");

    await escrow.connect(lender).markShipped(0);
    await expect(escrow.connect(other).confirmReceived(0)).to.be.revertedWith("only renter");
  });

  it("prevents lender from accepting their own offer", async function () {
    const { escrow, lender, rentPrice, deposit, shippingFee } = await setupFixture();

    await escrow.connect(lender).createOffer("BOOK-010", rentPrice, deposit, shippingFee, 7);

    await expect(
      escrow.connect(lender).acceptOffer(0, { value: totalEscrow(rentPrice, deposit, shippingFee) })
    ).to.be.revertedWith("lender cannot rent");
  });

  it("rejects incorrect escrow amount", async function () {
    const { escrow, lender, renter, rentPrice, deposit, shippingFee } = await setupFixture();

    await escrow.connect(lender).createOffer("BOOK-003", rentPrice, deposit, shippingFee, 7);

    await expect(
      escrow.connect(renter).acceptOffer(0, { value: rentPrice + deposit })
    ).to.be.revertedWith("incorrect escrow amount");
  });
});
