const BN = web3.utils.BN;
const truffleAssert = require('truffle-assertions');
const assert = require("chai").assert;
const splitterContract = artifacts.require("./Splitter.sol");

contract("Splitter", async (accounts) => {
    let alice;
    let bob;
    let carol;
    let splitter;

    beforeEach('setup contract for each test', async () => {
        [alice, bob, carol] = accounts;
        splitter = await splitterContract.new({from: alice});
    });

    /*
     * Ownable part.
     */
    it("should allow the owner to transfer ownership", async () => {
        let ownership = await splitter.changeOwnership(carol, {from: alice});
        assert.equal(await splitter.getOwner({from: carol}), carol, "Carol should be the owner now");
        truffleAssert.eventEmitted(ownership, 'LogOwnerChanged', (ev) => {
            return ev.previous === alice && ev.current === carol;
        });
    });

    it("should disallow a random user to change ownership", async () => {
        await truffleAssert.fails(splitter.changeOwnership(carol, {from: bob}));
    });

    /*
     * Suspendable part.
     */
    it("should be possible to the owner to suspend the splitter", async () => {
        let suspend = await splitter.suspend({from: alice});
        truffleAssert.eventEmitted(suspend, 'LogSuspend', (ev) => {
            return ev.who === alice;
        });
    });

    it("should be possible to the owner to wake up the splitter", async () => {
        await splitter.suspend({from: alice});
        let suspend = await splitter.wakeUp({from: alice});
        truffleAssert.eventEmitted(suspend, 'LogWakeUp', (ev) => {
            return ev.who === alice;
        });
    });

    it("should be impossible to a non owner to suspend or wake up the splitter", async () => {
        await truffleAssert.fails(splitter.suspend({from: bob}));
        await truffleAssert.fails(splitter.wakeUp({from: bob}));
    });

    it('should fail the splitFunds call when contract is suspended', async () => {
        await splitter.suspend({from: alice});
        await truffleAssert.fails(splitter.splitFunds(bob, carol, {from: alice, value: 10}));
    });

    it('should fail the withdraw call when contract is suspended', async () => {
        await splitter.suspend({from: alice});
        await truffleAssert.fails(splitter.withdraw({from: alice}));
    });

    /*
     * Splitter part.
     */
    it('should be impossible to split 0 wei', async () => {
        await truffleAssert.fails(splitter.splitFunds(bob, carol, {from: alice, value: 0}));
    });

    it('should be impossible to split an amount to incorrect addressees', async () => {
        const zeroAddress = "0x0000000000000000000000000000000000000000";
        await truffleAssert.fails(splitter.splitFunds(zeroAddress, zeroAddress, {from: alice, value: 10}));
        await truffleAssert.fails(splitter.splitFunds(bob, zeroAddress, {from: alice, value: 10}));
        await truffleAssert.fails(splitter.splitFunds(zeroAddress, carol, {from: alice, value: 10}));
    });

    it('should split in two equal parts to the correct targets the amount', async () => {
        let result = await splitter.splitFunds(bob, carol, {from: alice, value: 10});
        truffleAssert.eventEmitted(result, 'LogLoad', (ev) => {
            return ev.initiator === alice && ev.howMuch == 10 && ev.remainder == 0;
        });

        const contractBalance = await web3.eth.getBalance(splitter.address);
        const bobBalance = await splitter.consultBalance(bob);
        const carolBalance = await splitter.consultBalance(carol);
        assert.equal(contractBalance, 10);
        assert.equal(bobBalance, 5);
        assert.equal(carolBalance, 5);
    });

    it('should split in two equal parts and send back the remainder to the caller', async () => {
        let result = await splitter.splitFunds(bob, carol, {from: alice, value: 11});
        truffleAssert.eventEmitted(result, 'LogLoad', (ev) => {
            return ev.initiator === alice && ev.howMuch == 11 && ev.remainder == 1;
        });

        const contractBalance = await web3.eth.getBalance(splitter.address);
        let bobBalance = await splitter.consultBalance(bob);
        let carolBalance = await splitter.consultBalance(carol);
        assert.equal(contractBalance, 10);
        assert.equal(bobBalance, 5);
        assert.equal(carolBalance, 5);
    });

    it('should prevent a withdraw if the user has an empty balance', async () => {
        await splitter.splitFunds(bob, carol, {from: alice, value: 10});
        await truffleAssert.fails(splitter.withdraw({from: alice}));
    });

    it('should permit a withdraw if the user has a positive balance', async () => {
        await splitter.splitFunds(bob, alice, {from: carol, value: 100});
        assert.equal(await splitter.consultBalance(bob), 50, "Bob should have 50 on its balance");
        await splitter.withdraw({from: bob});
        assert.equal(await splitter.consultBalance(bob), 0, "Bob should have zero on its balance");
        await truffleAssert.fails(splitter.withdraw({from: bob}));
    });

    it('should pass a full scenario', async () => {
        const beforehandAliceBalance = await web3.eth.getBalance(alice);
        const beforehandBobBalance = await web3.eth.getBalance(bob);
        const beforehandCarolBalance = await web3.eth.getBalance(carol);
        const gasPrice = 50;

        const aliceTx = await splitter.splitFunds(bob, carol, {
            from: alice,
            value: 21,
            gasPrice: gasPrice
        });

        const aliceDebit = new BN(-21 + 1 - aliceTx.receipt.gasUsed * gasPrice);
        const expectedAliceBalance = new BN(beforehandAliceBalance).add(aliceDebit);
        const afterhandAlicelBalance = await web3.eth.getBalance(alice);
        assert.strictEqual(aliceTx.receipt.status, true, "Fail: Alice");
        assert.strictEqual(afterhandAlicelBalance, expectedAliceBalance.toString(), "Incorrect balance for Alice");

        const bobTx = await splitter.withdraw({from: bob, gasPrice: gasPrice});
        const bobCredit = new BN(10 - bobTx.receipt.gasUsed * gasPrice);
        const expectedBobBalance = new BN(beforehandBobBalance).add(bobCredit);
        const afterhandBobBalance = await web3.eth.getBalance(bob);
        assert.strictEqual(bobTx.receipt.status, true, "Fail: Bob");
        assert.strictEqual(afterhandBobBalance, expectedBobBalance.toString(), "Incorrect balance for Bob");

        const carolTx = await splitter.withdraw({from: carol, gasPrice: gasPrice});
        const carolCredit = new BN(10 - carolTx.receipt.gasUsed * gasPrice);
        const expectedCarolBalance = new BN(beforehandCarolBalance).add(carolCredit);
        const afterhandCarolBalance = await web3.eth.getBalance(carol);
        assert.strictEqual(carolTx.receipt.status, true, "Fail: Carol");
        assert.strictEqual(afterhandCarolBalance, expectedCarolBalance.toString(), "Incorrect balance for Carol");
    });
});
