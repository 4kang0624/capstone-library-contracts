import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("BookRentalEscrow - Unit", function () {
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

  function futureDueDate(days = 7) {
    return BigInt(Math.floor(Date.now() / 1000) + days * 24 * 60 * 60);
  }

  async function createRequestedRental(
    escrow: any,
    renter: any,
    owner: any,
    overrides?: {
      bookId?: number;
      deposit?: bigint;
      shippingFee?: bigint;
      dueDate?: bigint;
    }
  ) {
    const bookId = overrides?.bookId ?? 1;
    const deposit = overrides?.deposit ?? ethers.parseEther("1");
    const shippingFee = overrides?.shippingFee ?? ethers.parseEther("0.1");
    const dueDate = overrides?.dueDate ?? futureDueDate();

    await escrow
      .connect(renter)
      .createRental(bookId, owner.address, deposit, shippingFee, dueDate);

    return {
      rentalId: 1n,
      bookId,
      deposit,
      shippingFee,
      dueDate,
      totalAmount: deposit + shippingFee,
    };
  }

  async function createAcceptedRental(escrow: any, renter: any, owner: any) {
    const data = await createRequestedRental(escrow, renter, owner);
    await escrow.connect(owner).acceptRental(data.rentalId);
    return data;
  }

  async function createPaidRental(escrow: any, renter: any, owner: any) {
    const data = await createAcceptedRental(escrow, renter, owner);
    await escrow.connect(renter).payDepositAndShipping(data.rentalId, {
      value: data.totalAmount,
    });
    return data;
  }

  async function createShippedRental(escrow: any, renter: any, owner: any) {
    const data = await createPaidRental(escrow, renter, owner);
    await escrow.connect(owner).markShipped(data.rentalId);
    return data;
  }

  async function createDeliveredRental(escrow: any, renter: any, owner: any) {
    const data = await createShippedRental(escrow, renter, owner);
    await escrow.connect(renter).confirmDelivered(data.rentalId);
    return data;
  }

  async function createReturnRequestedRental(
    escrow: any,
    renter: any,
    owner: any
  ) {
    const data = await createDeliveredRental(escrow, renter, owner);
    await escrow.connect(renter).requestReturn(data.rentalId);
    return data;
  }

  describe("constructor", function () {
    it("should grant DEFAULT_ADMIN_ROLE and ADMIN_ROLE to admin", async function () {
      const { escrow, admin } = await deployFixture();

      const DEFAULT_ADMIN_ROLE = await escrow.DEFAULT_ADMIN_ROLE();
      const ADMIN_ROLE = await escrow.ADMIN_ROLE();

      expect(await escrow.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.equal(true);
      expect(await escrow.hasRole(ADMIN_ROLE, admin.address)).to.equal(true);
      expect(await escrow.nextRentalId()).to.equal(1n);
    });
  });

  describe("createRental", function () {
    it("should create rental successfully", async function () {
      const { escrow, admin, owner, renter, other } = await deployFixture();

      await logRoleBalances("Before createRental", { admin, owner, renter, other });

      const deposit = ethers.parseEther("1");
      const shippingFee = ethers.parseEther("0.1");
      const dueDate = futureDueDate();

      await expect(
        escrow
          .connect(renter)
          .createRental(1, owner.address, deposit, shippingFee, dueDate)
      ).to.emit(escrow, "RentalCreated");

      const rental = await escrow.getRental(1n);

      expect(rental.rentalId).to.equal(1n);
      expect(rental.bookId).to.equal(1n);
      expect(rental.owner).to.equal(owner.address);
      expect(rental.renter).to.equal(renter.address);
      expect(rental.deposit).to.equal(deposit);
      expect(rental.shippingFee).to.equal(shippingFee);
      expect(rental.status).to.equal(0); // Requested

      await logRoleBalances("After createRental", { admin, owner, renter, other });
    });

    it("should revert if owner is zero address", async function () {
      const { escrow, renter } = await deployFixture();

      await expect(
        escrow.connect(renter).createRental(
          1,
          ethers.ZeroAddress,
          ethers.parseEther("1"),
          ethers.parseEther("0.1"),
          futureDueDate()
        )
      ).to.be.revertedWithCustomError(escrow, "InvalidAddress");
    });

    it("should revert if deposit and shipping fee are both zero", async function () {
      const { escrow, owner, renter } = await deployFixture();

      await expect(
        escrow.connect(renter).createRental(
          1,
          owner.address,
          0,
          0,
          futureDueDate()
        )
      ).to.be.revertedWithCustomError(escrow, "InvalidAmount");
    });

    it("should revert if dueDate is not in the future", async function () {
      const { escrow, owner, renter } = await deployFixture();

      const pastDueDate = BigInt(Math.floor(Date.now() / 1000) - 10);

      await expect(
        escrow.connect(renter).createRental(
          1,
          owner.address,
          ethers.parseEther("1"),
          ethers.parseEther("0.1"),
          pastDueDate
        )
      ).to.be.revertedWithCustomError(escrow, "InvalidDueDate");
    });
  });

  describe("acceptRental", function () {
    it("should allow only owner to accept", async function () {
      const { escrow, owner, renter, other } = await deployFixture();
      await createRequestedRental(escrow, renter, owner);

      await expect(
        escrow.connect(other).acceptRental(1n)
      ).to.be.revertedWithCustomError(escrow, "NotOwner");

      await expect(
        escrow.connect(owner).acceptRental(1n)
      ).to.emit(escrow, "RentalAccepted");

      expect(await escrow.getRentalStatus(1n)).to.equal(1); // Accepted
    });

    it("should revert if status is not Requested", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createRequestedRental(escrow, renter, owner);
      await escrow.connect(owner).rejectRental(1n);

      await expect(
        escrow.connect(owner).acceptRental(1n)
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("rejectRental", function () {
    it("should allow only owner to reject", async function () {
      const { escrow, owner, renter, other } = await deployFixture();
      await createRequestedRental(escrow, renter, owner);

      await expect(
        escrow.connect(other).rejectRental(1n)
      ).to.be.revertedWithCustomError(escrow, "NotOwner");

      await expect(
        escrow.connect(owner).rejectRental(1n)
      ).to.emit(escrow, "RentalRejected");

      expect(await escrow.getRentalStatus(1n)).to.equal(2); // Rejected
    });

    it("should revert if status is not Requested", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createRequestedRental(escrow, renter, owner);
      await escrow.connect(owner).acceptRental(1n);

      await expect(
        escrow.connect(owner).rejectRental(1n)
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("cancelRental", function () {
    it("should allow renter to cancel in Requested", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createRequestedRental(escrow, renter, owner);

      await expect(
        escrow.connect(renter).cancelRental(1n)
      ).to.emit(escrow, "RentalCancelled");

      expect(await escrow.getRentalStatus(1n)).to.equal(8); // Cancelled
    });

    it("should not allow owner to cancel in Requested", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createRequestedRental(escrow, renter, owner);

      await expect(
        escrow.connect(owner).cancelRental(1n)
      ).to.be.revertedWithCustomError(escrow, "NotRenter");
    });

    it("should allow owner to cancel in Accepted", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createAcceptedRental(escrow, renter, owner);

      await expect(
        escrow.connect(owner).cancelRental(1n)
      ).to.emit(escrow, "RentalCancelled");

      expect(await escrow.getRentalStatus(1n)).to.equal(8); // Cancelled
    });

    it("should allow renter to cancel in Accepted", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createAcceptedRental(escrow, renter, owner);

      await expect(
        escrow.connect(renter).cancelRental(1n)
      ).to.emit(escrow, "RentalCancelled");

      expect(await escrow.getRentalStatus(1n)).to.equal(8); // Cancelled
    });

    it("should not allow non-participant to cancel in Accepted", async function () {
      const { escrow, owner, renter, other } = await deployFixture();
      await createAcceptedRental(escrow, renter, owner);

      await expect(
        escrow.connect(other).cancelRental(1n)
      ).to.be.revertedWithCustomError(escrow, "NotParticipant");
    });

    it("should revert if status is not Requested or Accepted", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createPaidRental(escrow, renter, owner);

      await expect(
        escrow.connect(renter).cancelRental(1n)
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("payDepositAndShipping", function () {
    it("should allow renter to pay correct amount only in Accepted", async function () {
      const { escrow, owner, renter, other } = await deployFixture();
      const data = await createAcceptedRental(escrow, renter, owner);

      await logRoleBalances("Before payment", { owner, renter, other });

      await expect(
        escrow.connect(other).payDepositAndShipping(1n, {
          value: data.totalAmount,
        })
      ).to.be.revertedWithCustomError(escrow, "NotRenter");

      await expect(
        escrow.connect(renter).payDepositAndShipping(1n, {
          value: data.deposit,
        })
      ).to.be.revertedWithCustomError(escrow, "WrongPaymentAmount");

      await expect(
        escrow.connect(renter).payDepositAndShipping(1n, {
          value: data.totalAmount,
        })
      ).to.emit(escrow, "DepositPaid");

      expect(await escrow.getRentalStatus(1n)).to.equal(3); // Paid

      await logRoleBalances("After payment", { owner, renter, other });
    });

    it("should revert if status is not Accepted", async function () {
      const { escrow, owner, renter } = await deployFixture();
      const data = await createRequestedRental(escrow, renter, owner);

      await expect(
        escrow.connect(renter).payDepositAndShipping(1n, {
          value: data.totalAmount,
        })
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("markShipped", function () {
    it("should allow only owner to mark shipped in Paid", async function () {
      const { escrow, owner, renter, other } = await deployFixture();
      await createPaidRental(escrow, renter, owner);

      await expect(
        escrow.connect(other).markShipped(1n)
      ).to.be.revertedWithCustomError(escrow, "NotOwner");

      await expect(
        escrow.connect(owner).markShipped(1n)
      ).to.emit(escrow, "Shipped");

      expect(await escrow.getRentalStatus(1n)).to.equal(4); // Shipped
    });

    it("should revert if status is not Paid", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createAcceptedRental(escrow, renter, owner);

      await expect(
        escrow.connect(owner).markShipped(1n)
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("confirmDelivered", function () {
    it("should allow only renter to confirm delivered in Shipped", async function () {
      const { escrow, owner, renter, other } = await deployFixture();
      await createShippedRental(escrow, renter, owner);

      await expect(
        escrow.connect(other).confirmDelivered(1n)
      ).to.be.revertedWithCustomError(escrow, "NotRenter");

      await expect(
        escrow.connect(renter).confirmDelivered(1n)
      ).to.emit(escrow, "Delivered");

      expect(await escrow.getRentalStatus(1n)).to.equal(5); // Delivered
    });

    it("should revert if status is not Shipped", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createPaidRental(escrow, renter, owner);

      await expect(
        escrow.connect(renter).confirmDelivered(1n)
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("requestReturn", function () {
    it("should allow only renter to request return in Delivered", async function () {
      const { escrow, owner, renter, other } = await deployFixture();
      await createDeliveredRental(escrow, renter, owner);

      await expect(
        escrow.connect(other).requestReturn(1n)
      ).to.be.revertedWithCustomError(escrow, "NotRenter");

      await expect(
        escrow.connect(renter).requestReturn(1n)
      ).to.emit(escrow, "ReturnRequested");

      expect(await escrow.getRentalStatus(1n)).to.equal(6); // ReturnRequested
    });

    it("should revert if status is not Delivered", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createShippedRental(escrow, renter, owner);

      await expect(
        escrow.connect(renter).requestReturn(1n)
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("confirmReturnAndComplete", function () {
    it("should allow only owner to complete in ReturnRequested and increase claimable balances", async function () {
      const { escrow, owner, renter, other } = await deployFixture();
      const data = await createReturnRequestedRental(escrow, renter, owner);

      await expect(
        escrow.connect(other).confirmReturnAndComplete(1n)
      ).to.be.revertedWithCustomError(escrow, "NotOwner");

      await expect(
        escrow.connect(owner).confirmReturnAndComplete(1n)
      ).to.emit(escrow, "RentalCompleted");

      expect(await escrow.getRentalStatus(1n)).to.equal(7); // Completed
      expect(await escrow.claimableBalanceOf(owner.address)).to.equal(data.shippingFee);
      expect(await escrow.claimableBalanceOf(renter.address)).to.equal(data.deposit);
    });

    it("should revert if status is not ReturnRequested", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createDeliveredRental(escrow, renter, owner);

      await expect(
        escrow.connect(owner).confirmReturnAndComplete(1n)
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("markDisputed", function () {
    it("should allow owner or renter to dispute in Paid", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createPaidRental(escrow, renter, owner);

      await expect(
        escrow.connect(owner).markDisputed(1n)
      ).to.emit(escrow, "RentalDisputed");

      expect(await escrow.getRentalStatus(1n)).to.equal(9); // Disputed
    });

    it("should allow owner or renter to dispute in Shipped", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createShippedRental(escrow, renter, owner);

      await expect(
        escrow.connect(renter).markDisputed(1n)
      ).to.emit(escrow, "RentalDisputed");

      expect(await escrow.getRentalStatus(1n)).to.equal(9); // Disputed
    });

    it("should allow renter to dispute in Delivered before dueDate", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createDeliveredRental(escrow, renter, owner);

      await expect(
        escrow.connect(renter).markDisputed(1n)
      ).to.emit(escrow, "RentalDisputed");

      expect(await escrow.getRentalStatus(1n)).to.equal(9); // Disputed
    });

    it("should not allow owner to dispute in Delivered before dueDate", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createDeliveredRental(escrow, renter, owner);

      await expect(
        escrow.connect(owner).markDisputed(1n)
      ).to.be.revertedWithCustomError(escrow, "OverdueNotReached");
    });

    it("should allow owner to dispute in Delivered after dueDate", async function () {
      const { escrow, owner, renter } = await deployFixture();

      const deposit = ethers.parseEther("1");
      const shippingFee = ethers.parseEther("0.1");
      const latestBlock = await ethers.provider.getBlock("latest");
      const currentTimestamp = BigInt(latestBlock!.timestamp);
      const shortDueDate = currentTimestamp + 5n;

      await escrow.connect(renter).createRental(
        1,
        owner.address,
        deposit,
        shippingFee,
        shortDueDate
      );
      await escrow.connect(owner).acceptRental(1n);
      await escrow.connect(renter).payDepositAndShipping(1n, {
        value: deposit + shippingFee,
      });
      await escrow.connect(owner).markShipped(1n);
      await escrow.connect(renter).confirmDelivered(1n);

      await ethers.provider.send("evm_increaseTime", [5]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        escrow.connect(owner).markDisputed(1n)
      ).to.emit(escrow, "RentalDisputed");

      expect(await escrow.getRentalStatus(1n)).to.equal(9); // Disputed
    });

    it("should allow dispute in ReturnRequested", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createReturnRequestedRental(escrow, renter, owner);

      await expect(
        escrow.connect(owner).markDisputed(1n)
      ).to.emit(escrow, "RentalDisputed");

      expect(await escrow.getRentalStatus(1n)).to.equal(9); // Disputed
    });

    it("should revert if non-participant tries to dispute", async function () {
      const { escrow, owner, renter, other } = await deployFixture();
      await createPaidRental(escrow, renter, owner);

      await expect(
        escrow.connect(other).markDisputed(1n)
      ).to.be.revertedWithCustomError(escrow, "NotParticipant");
    });

    it("should revert if status is not disputable", async function () {
      const { escrow, owner, renter } = await deployFixture();
      await createRequestedRental(escrow, renter, owner);

      await expect(
        escrow.connect(renter).markDisputed(1n)
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("resolveDispute", function () {
    it("should allow only admin to resolve dispute", async function () {
      const { escrow, admin, owner, renter, other } = await deployFixture();
      const data = await createPaidRental(escrow, renter, owner);

      await escrow.connect(owner).markDisputed(1n);

      const ownerAmount = data.shippingFee;
      const renterAmount = data.deposit;

      await expect(
        escrow.connect(other).resolveDispute(1n, ownerAmount, renterAmount)
      ).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");

      await expect(
        escrow.connect(admin).resolveDispute(1n, ownerAmount, renterAmount)
      ).to.emit(escrow, "DisputeResolved");

      expect(await escrow.getRentalStatus(1n)).to.equal(7); // Completed
      expect(await escrow.claimableBalanceOf(owner.address)).to.equal(ownerAmount);
      expect(await escrow.claimableBalanceOf(renter.address)).to.equal(renterAmount);
    });

    it("should revert if status is not Disputed", async function () {
      const { escrow, admin, owner, renter } = await deployFixture();
      const data = await createPaidRental(escrow, renter, owner);

      await expect(
        escrow.connect(admin).resolveDispute(1n, data.shippingFee, data.deposit)
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });

    it("should revert if split amounts do not match total locked amount", async function () {
      const { escrow, admin, owner, renter } = await deployFixture();
      const data = await createPaidRental(escrow, renter, owner);

      await escrow.connect(owner).markDisputed(1n);

      await expect(
        escrow.connect(admin).resolveDispute(
          1n,
          data.shippingFee,
          data.deposit - 1n
        )
      ).to.be.revertedWithCustomError(escrow, "InvalidAmount");
    });
  });

  describe("withdraw", function () {
    it("should revert if no claimable balance", async function () {
      const { escrow, owner } = await deployFixture();

      await expect(
        escrow.connect(owner).withdraw()
      ).to.be.revertedWithCustomError(escrow, "NoClaimableBalance");
    });

    it("should withdraw and reset claimable balance to zero", async function () {
      const { escrow, owner, renter } = await deployFixture();
      const data = await createReturnRequestedRental(escrow, renter, owner);

      await escrow.connect(owner).confirmReturnAndComplete(1n);

      expect(await escrow.claimableBalanceOf(owner.address)).to.equal(data.shippingFee);
      expect(await escrow.claimableBalanceOf(renter.address)).to.equal(data.deposit);

      await logRoleBalances("Before withdraw", { owner, renter });

      await expect(
        escrow.connect(owner).withdraw()
      ).to.emit(escrow, "Withdrawn");

      expect(await escrow.claimableBalanceOf(owner.address)).to.equal(0);

      await expect(
        escrow.connect(renter).withdraw()
      ).to.emit(escrow, "Withdrawn");

      expect(await escrow.claimableBalanceOf(renter.address)).to.equal(0);

      await logRoleBalances("After withdraw", { owner, renter });
    });
  });

  describe("pause / unpause", function () {
    it("should allow only admin to pause and unpause", async function () {
      const { escrow, admin, owner } = await deployFixture();

      await expect(
        escrow.connect(owner).pause()
      ).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");

      await escrow.connect(admin).pause();
      expect(await escrow.paused()).to.equal(true);

      await expect(
        escrow.connect(owner).unpause()
      ).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");

      await escrow.connect(admin).unpause();
      expect(await escrow.paused()).to.equal(false);
    });

    it("should block whenNotPaused functions while paused", async function () {
      const { escrow, admin, owner, renter } = await deployFixture();

      await escrow.connect(admin).pause();

      await expect(
        escrow.connect(renter).createRental(
          1,
          owner.address,
          ethers.parseEther("1"),
          ethers.parseEther("0.1"),
          futureDueDate()
        )
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });
  });

  describe("not found cases", function () {
    it("should revert when rental does not exist", async function () {
      const { escrow } = await deployFixture();

      await expect(
        escrow.getRental(999n)
      ).to.be.revertedWithCustomError(escrow, "RentalNotFound");

      await expect(
        escrow.getRentalStatus(999n)
      ).to.be.revertedWithCustomError(escrow, "RentalNotFound");
    });
  });
});