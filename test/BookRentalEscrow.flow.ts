import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("BookRentalEscrow - Flow", function () {
  async function deployFixture() {
    const [admin, owner, renter, other] = await ethers.getSigners();

    const BookRentalEscrow = await ethers.getContractFactory("BookRentalEscrow");
    const escrow = await BookRentalEscrow.deploy(admin.address);
    await escrow.waitForDeployment();

    return { escrow, admin, owner, renter, other };
  }

  async function logRoleBalances(
    label: string,
    roles: {
      admin?: { address: string };
      owner?: { address: string };
      renter?: { address: string };
      other?: { address: string };
    }
  ) {
    console.log(`\n=== ${label} ===`);

    for (const [role, signer] of Object.entries(roles)) {
      if (!signer) continue;
      const balance = await ethers.provider.getBalance(signer.address);
      console.log(
        `${role}: ${signer.address} -> ${ethers.formatEther(balance)} ETH`
      );
    }
  }

  it("should complete the normal rental flow", async function () {
    const { escrow, admin, owner, renter, other } = await deployFixture();

    await logRoleBalances("Before flow", { admin, owner, renter, other });

    const bookId = 1;
    const deposit = ethers.parseEther("1");
    const shippingFee = ethers.parseEther("0.1");
    const dueDate = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);

    // 1. createRental
    await expect(
      escrow.connect(renter).createRental(
        bookId,
        owner.address,
        deposit,
        shippingFee,
        dueDate
      )
    ).to.emit(escrow, "RentalCreated");

    const rentalId = 1n;

    let rental = await escrow.getRental(rentalId);
    expect(rental.rentalId).to.equal(rentalId);
    expect(rental.bookId).to.equal(bookId);
    expect(rental.owner).to.equal(owner.address);
    expect(rental.renter).to.equal(renter.address);
    expect(rental.deposit).to.equal(deposit);
    expect(rental.shippingFee).to.equal(shippingFee);
    expect(rental.status).to.equal(0); // Requested

    // 2. acceptRental
    await expect(
      escrow.connect(owner).acceptRental(rentalId)
    ).to.emit(escrow, "RentalAccepted");
    expect(await escrow.getRentalStatus(rentalId)).to.equal(1); // Accepted

    // 3. payDepositAndShipping
    const totalAmount = deposit + shippingFee;
    await expect(
      escrow.connect(renter).payDepositAndShipping(rentalId, {
        value: totalAmount,
      })
    ).to.emit(escrow, "DepositPaid");
    expect(await escrow.getRentalStatus(rentalId)).to.equal(3); // Paid

    // 4. markShipped
    await expect(
      escrow.connect(owner).markShipped(rentalId)
    ).to.emit(escrow, "Shipped");
    expect(await escrow.getRentalStatus(rentalId)).to.equal(4); // Shipped

    // 5. confirmDelivered
    await expect(
      escrow.connect(renter).confirmDelivered(rentalId)
    ).to.emit(escrow, "Delivered");
    expect(await escrow.getRentalStatus(rentalId)).to.equal(5); // Delivered

    // 6. requestReturn
    await expect(
      escrow.connect(renter).requestReturn(rentalId)
    ).to.emit(escrow, "ReturnRequested");
    expect(await escrow.getRentalStatus(rentalId)).to.equal(6); // ReturnRequested

    // 7. confirmReturnAndComplete
    await expect(
      escrow.connect(owner).confirmReturnAndComplete(rentalId)
    ).to.emit(escrow, "RentalCompleted");
    expect(await escrow.getRentalStatus(rentalId)).to.equal(7); // Completed

    // 8. claimable balances
    expect(await escrow.claimableBalanceOf(owner.address)).to.equal(shippingFee);
    expect(await escrow.claimableBalanceOf(renter.address)).to.equal(deposit);

    await logRoleBalances("Before withdraw", { admin, owner, renter, other });

    // 9. withdraw
    await expect(
      escrow.connect(owner).withdraw()
    ).to.emit(escrow, "Withdrawn");

    await expect(
      escrow.connect(renter).withdraw()
    ).to.emit(escrow, "Withdrawn");

    // 10. claimable balances should be zero
    expect(await escrow.claimableBalanceOf(owner.address)).to.equal(0);
    expect(await escrow.claimableBalanceOf(renter.address)).to.equal(0);

    await logRoleBalances("After withdraw", { admin, owner, renter, other });
  });
});