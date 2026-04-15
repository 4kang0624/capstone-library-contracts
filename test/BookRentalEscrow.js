const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BookRentalEscrow", function () {
  async function setupFixture() {
    const [lender, renter] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("BookRentalEscrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    const rentPrice = ethers.parseEther("0.1");
    const deposit = ethers.parseEther("0.2");
    const shippingFee = ethers.parseEther("0.01");

    return { escrow, lender, renter, rentPrice, deposit, shippingFee };
  }

  it("creates and accepts an offer with deposit and shipping fee", async function () {
    const { escrow, lender, renter, rentPrice, deposit, shippingFee } = await setupFixture();

    await expect(
      escrow.connect(lender).createOffer("BOOK-001", rentPrice, deposit, shippingFee, 7)
    )
      .to.emit(escrow, "OfferCreated")
      .withArgs(0, lender.address, "BOOK-001");

    const totalEscrow = rentPrice + deposit + shippingFee;

    await expect(
      escrow.connect(renter).acceptOffer(0, { value: totalEscrow })
    ).to.emit(escrow, "OfferAccepted");

    const rental = await escrow.rentals(0);
    expect(rental.renter).to.equal(renter.address);
  });

  it("settles escrow by paying lender rent+shipping and splitting deposit", async function () {
    const { escrow, lender, renter, rentPrice, deposit, shippingFee } = await setupFixture();

    await escrow.connect(lender).createOffer("BOOK-002", rentPrice, deposit, shippingFee, 7);
    await escrow.connect(renter).acceptOffer(0, { value: rentPrice + deposit + shippingFee });
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

  it("rejects incorrect escrow amount", async function () {
    const { escrow, lender, renter, rentPrice, deposit, shippingFee } = await setupFixture();

    await escrow.connect(lender).createOffer("BOOK-003", rentPrice, deposit, shippingFee, 7);

    await expect(
      escrow.connect(renter).acceptOffer(0, { value: rentPrice + deposit })
    ).to.be.revertedWith("incorrect escrow amount");
  });
});
