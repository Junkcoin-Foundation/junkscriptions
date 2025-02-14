#!/usr/bin/env node

const dogecore = require('./bitcore-lib-junkcoin')
const axios = require('axios')
const fs = require('fs')
const dotenv = require('dotenv')
const mime = require('mime-types')
const express = require('express')
const { PrivateKey, Address, Transaction, Script, Opcode, Output } = dogecore
const { Hash, Signature } = dogecore.crypto

dotenv.config()

if (process.env.TESTNET == 'true') {
	dogecore.Networks.defaultNetwork = dogecore.Networks.testnet
}

if (process.env.FEE_PER_KB) {
	Transaction.FEE_PER_KB = parseInt(process.env.FEE_PER_KB)
} else {
	Transaction.FEE_PER_KB = 100000
}

const WALLET_PATH = process.env.WALLET || '.wallet.json'
const PENDING_PATH = WALLET_PATH.replace('wallet', 'pending-txs')

async function main() {
	let cmd = process.argv[2]

	if (cmd == 'mint') {
		if (fs.existsSync(PENDING_PATH)) {
			console.log('found pending-txs.json. rebroadcasting...')
			const txs = JSON.parse(fs.readFileSync(PENDING_PATH))
			await broadcastAll(
				txs.map((tx) => new Transaction(tx)),
				false
			)
			return
		}
		const count = parseInt(process.argv[5], 10)

		if (!isNaN(count)) {
			for (let i = 0; i < count; i++) {
				await mint()
			}
		} else {
			await mint()
		}
	} else if (cmd == 'mint-junkmap') {
		await mintJunkmap()
	} else if (cmd == 'wallet') {
		await wallet()
	} else if (cmd == 'junk-20') {
		await junk20()
	} else if (cmd == 'server') {
		await server()
	} else if (cmd == 'help') {
		showHelp()
	} else {
		throw new Error(`unknown command: ${cmd}`)
	}
}

async function wallet() {
	let subcmd = process.argv[3]

	if (subcmd == 'new') {
		walletNew()
	} else if (subcmd == 'sync') {
		await walletSync()
	} else if (subcmd == 'balance') {
		walletBalance()
	} else if (subcmd == 'send') {
		await walletSend()
	} else if (subcmd == 'split') {
		await walletSplit()
	} else if (subcmd == 'consolidate') {
		await walletConsolidateNew()
	} else if (subcmd == 'show') {
		walletShowNew()
	} else {
		throw new Error(`unknown subcommand: ${subcmd}`)
	}
}

function walletNew() {
	if (!fs.existsSync(WALLET_PATH)) {
		const privateKey = new PrivateKey()
		const privkey = privateKey.toWIF()
		const address = privateKey.toAddress().toString()
		const json = { privkey, address, utxos: [] }
		fs.writeFileSync(WALLET_PATH, JSON.stringify(json, 0, 2))
		console.log('address', address)
	} else {
		throw new Error('wallet already exists')
	}
}

async function walletSync() {
	if (process.env.TESTNET == 'true') throw new Error('no testnet api')

	let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))

	console.log('syncing utxos with junkcoin api')

	let response = await axios.get(`https://api.junkiewally.xyz/address/${wallet.address}/utxo`)
	wallet.utxos = response.data.map((e) => ({
		txid: e.txid,
		vout: e.vout,
		satoshis: e.value,
		script: Script(new Address(wallet.address)).toHex()
	}))

	fs.writeFileSync(WALLET_PATH, JSON.stringify(wallet, 0, 2))

	let balance = wallet.utxos.reduce((acc, curr) => acc + curr.satoshis, 0)

	console.log('balance', balance)
}

function walletBalance() {
	let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))

	let balance = wallet.utxos.reduce((acc, curr) => acc + curr.satoshis, 0)

	console.log(wallet.address, balance)
}

async function walletSend() {
	const argAddress = process.argv[4]
	const argAmount = process.argv[5]

	let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))

	let balance = wallet.utxos.reduce((acc, curr) => acc + curr.satoshis, 0)
	if (balance == 0) throw new Error('no funds to send')

	let receiver = new Address(argAddress)
	let amount = parseInt(argAmount)

	let tx = new Transaction()
	if (amount) {
		tx.to(receiver, amount)
		fund(wallet, tx)
	} else {
		tx.from(wallet.utxos)
		tx.change(receiver)
		tx.sign(wallet.privkey)
	}

	await broadcast(tx, true)

	console.log(tx.hash)
}

async function walletSplit() {
	let splits = parseInt(process.argv[4])

	let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))

	let balance = wallet.utxos.reduce((acc, curr) => acc + curr.satoshis, 0)
	if (balance == 0) throw new Error('no funds to split')

	let tx = new Transaction()
	tx.from(wallet.utxos)
	for (let i = 0; i < splits - 1; i++) {
		tx.to(wallet.address, Math.floor(balance / splits))
	}
	tx.change(wallet.address)
	tx.sign(wallet.privkey)

	await broadcast(tx, true)

	console.log(tx.hash)
}

async function walletConsolidateNew() {
    const wallet = JSON.parse(fs.readFileSync(WALLET_PATH));

    // Validate wallet.utxos
    if (!Array.isArray(wallet.utxos) || wallet.utxos.length === 0) {
        throw new Error('Invalid or empty UTXO list in wallet');
    }

    // Validate and calculate total balance
    const balance = wallet.utxos.reduce((acc, curr) => {
        if (typeof curr.satoshis !== 'number' || curr.satoshis <= 0) {
            throw new Error(`Invalid UTXO value: ${JSON.stringify(curr)}`);
        }
        return acc + curr.satoshis;
    }, 0);

    if (balance === 0) throw new Error('No funds to consolidate');
    if (wallet.utxos.length <= 1) {
        console.log('No need to consolidate');
        return;
    }

    console.log(`Consolidating ${wallet.utxos.length} UTXOs with total balance ${balance} satoshis...`);

    const tx = new Transaction();
    tx.from(wallet.utxos);

    // Calculate estimated fee
    const txSize = tx.toBuffer().length; // Initial size estimation
    const estimatedFee = Math.ceil((txSize + 34) * Transaction.FEE_PER_KB / 1000); // Add 34 bytes for a single output

    // Calculate amount after fee
    const consolidatedAmount = balance - estimatedFee;

    console.log('Estimated Fee:', estimatedFee);
    console.log('Consolidated Amount:', consolidatedAmount);

    // Ensure the amount is a positive integer above the dust threshold
    if (consolidatedAmount <= Transaction.DUST_AMOUNT) {
        throw new Error('Consolidated amount would be below dust threshold');
    }

    if (consolidatedAmount <= 0) {
        throw new Error('Invalid consolidated amount: must be greater than zero');
    }

    // Create the output and sign the transaction
    tx.to(wallet.address, consolidatedAmount);
    tx.sign(wallet.privkey);

    // Broadcast and update wallet
    console.log('Broadcasting consolidation transaction...');
    await broadcast(tx, true);
    await updateWallet(wallet, tx); // Update wallet to reflect the new state
    fs.writeFileSync(WALLET_PATH, JSON.stringify(wallet, null, 2));

    console.log('Successfully consolidated into 1 UTXO');
    console.log('Transaction:', tx.hash);
}





function walletShowNew() {
    const wallet = JSON.parse(fs.readFileSync(WALLET_PATH))
    console.log('Address:', wallet.address)
    console.log('Private Key:', wallet.privkey)
}

async function mintJunkmap() {
	const argAddress = process.argv[3]
	const start = parseInt(process.argv[4], 10)
	const end = parseInt(process.argv[5], 10)
	let address = new Address(argAddress)

	for (let i = start; i <= end; i++) {
		const data = Buffer.from(`${i}.junkmap`, 'utf8')
		const contentType = 'text/plain'

		let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))
		let txs = inscribe(wallet, address, contentType, data)
		console.log(`${i}.junkmap`)
		await broadcastAll(txs, false)
	}
}

async function mint() {
	const argAddress = process.argv[3]
	const argContentTypeOrFilename = process.argv[4]

	let address = new Address(argAddress)
	let contentType
	let data

	if (fs.existsSync(argContentTypeOrFilename)) {
		contentType = mime.contentType(mime.lookup(argContentTypeOrFilename))
		data = fs.readFileSync(argContentTypeOrFilename)
	} else {
		process.exit()
	}

	if (data.length == 0) {
		throw new Error('no data to mint')
	}

	if (contentType.length > MAX_SCRIPT_ELEMENT_SIZE) {
		throw new Error('content type too long')
	}

	let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))
	let txs = inscribe(wallet, address, contentType, data)
	await broadcastAll(txs, false)
}

async function junk20() {
    const subcmd = process.argv[3]
    
    if (subcmd === 'deploy') {
        await junk20DeployNew()
    } else if (subcmd === 'mint') {
        await junk20MintNew()
    } else if (subcmd === 'transfer') {
        await junk20TransferNew()
    } else {
        throw new Error(`unknown junk-20 subcommand: ${subcmd}`)
    }
}

async function junk20DeployNew() {
    if (process.argv.length < 7) {
        throw new Error('Usage: junk-20 deploy <address> <tick> <max> <lim>')
    }

    const address = process.argv[4]
    const tick = process.argv[5]
    const max = parseInt(process.argv[6])
    const lim = parseInt(process.argv[7])

    if (isNaN(max) || isNaN(lim)) {
        throw new Error('max and lim must be numbers')
    }

    const wallet = JSON.parse(fs.readFileSync(WALLET_PATH))
    const data = JSON.stringify({
        p: 'junk-20',
        op: 'deploy',
        tick: tick,
        max: max.toString(),
        lim: lim.toString()
    })

    const contentType = 'application/json'
    const txs = await inscribe(wallet, address, contentType, Buffer.from(data))
    await broadcastAll(txs, true)
}

async function junk20MintNew() {
    if (process.argv.length < 7) {
        throw new Error('Usage: junk-20 mint <address> <tick> <amt> [repeat]')
    }

    const address = process.argv[4]
    const tick = process.argv[5]
    const amt = parseInt(process.argv[6])
    const repeat = parseInt(process.argv[7]) || 1

    if (isNaN(amt)) {
        throw new Error('amt must be a number')
    }

    console.log(`Minting ${amt} ${tick} tokens, repeating ${repeat} times...`)
    const wallet = JSON.parse(fs.readFileSync(WALLET_PATH))

    for (let i = 0; i < repeat; i++) {
        console.log(`\nMint operation ${i + 1} of ${repeat}:`)
        const data = JSON.stringify({
            p: 'junk-20',
            op: 'mint',
            tick: tick,
            amt: amt.toString()
        })

        const contentType = 'application/json'
        const txs = await inscribe(wallet, address, contentType, Buffer.from(data))
        console.log('Broadcasting transactions...')
        await broadcastAll(txs, true)
        console.log('Mint transaction completed.')
        
        // Save updated wallet state
        fs.writeFileSync(WALLET_PATH, JSON.stringify(wallet, null, 2))
    }
    
    console.log('\nAll mint operations completed successfully!')
}


async function junk20TransferNew() {
    if (process.argv.length < 7) {
        throw new Error('Usage: junk-20 transfer <address> <tick> <amt>')
    }

    const address = process.argv[4]
    const tick = process.argv[5]
    const amt = parseInt(process.argv[6])

    if (isNaN(amt)) {
        throw new Error('amt must be a number')
    }

    const wallet = JSON.parse(fs.readFileSync(WALLET_PATH))
    const data = JSON.stringify({
        p: 'junk-20',
        op: 'transfer',
        tick: tick,
        amt: amt.toString()
    })

    const contentType = 'application/json'
    const txs = await inscribe(wallet, address, contentType, Buffer.from(data))
    await broadcastAll(txs, true)
}


async function broadcastAll(txs, retry) {
	for (let i = 0; i < txs.length; i++) {
		try {
			await broadcast(txs[i], retry)
		} catch (e) {
			console.log('❌ broadcast failed', e)
			fs.writeFileSync(PENDING_PATH, JSON.stringify(txs.slice(i).map((tx) => tx.toString())))
			process.exit(1)
		}
	}

	try {
		fs.rmSync(PENDING_PATH)
	} catch (e) {}

	console.log('✅ inscription txid:', txs[1].hash)
	return true
}

function bufferToChunk(b, type) {
	b = Buffer.from(b, type)
	return {
		buf: b.length ? b : undefined,
		len: b.length,
		opcodenum: b.length <= 75 ? b.length : b.length <= 255 ? 76 : 77
	}
}

function numberToChunk(n) {
	return {
		buf: n <= 16 ? undefined : n < 128 ? Buffer.from([n]) : Buffer.from([n % 256, n / 256]),
		len: n <= 16 ? 0 : n < 128 ? 1 : 2,
		opcodenum: n == 0 ? 0 : n <= 16 ? 80 + n : n < 128 ? 1 : 2
	}
}

function opcodeToChunk(op) {
	return { opcodenum: op }
}

const MAX_SCRIPT_ELEMENT_SIZE = 520

const MAX_CHUNK_LEN = 240
const MAX_PAYLOAD_LEN = 1500

function inscribe(wallet, address, contentType, data) {
	let txs = []

	let privateKey = new PrivateKey(wallet.privkey)
	let publicKey = privateKey.toPublicKey()

	let parts = []
	while (data.length) {
		let part = data.slice(0, Math.min(MAX_CHUNK_LEN, data.length))
		data = data.slice(part.length)
		parts.push(part)
	}

	let inscription = new Script()
	inscription.chunks.push(bufferToChunk('ord'))
	inscription.chunks.push(numberToChunk(parts.length))
	inscription.chunks.push(bufferToChunk(contentType))
	parts.forEach((part, n) => {
		inscription.chunks.push(numberToChunk(parts.length - n - 1))
		inscription.chunks.push(bufferToChunk(part))
	})

	let p2shInput
	let lastLock
	let lastPartial

	while (inscription.chunks.length) {
		let partial = new Script()

		if (txs.length == 0) {
			partial.chunks.push(inscription.chunks.shift())
		}

		while (partial.toBuffer().length <= MAX_PAYLOAD_LEN && inscription.chunks.length) {
			partial.chunks.push(inscription.chunks.shift())
			partial.chunks.push(inscription.chunks.shift())
		}

		if (partial.toBuffer().length > MAX_PAYLOAD_LEN) {
			inscription.chunks.unshift(partial.chunks.pop())
			inscription.chunks.unshift(partial.chunks.pop())
		}

		let lock = new Script()
		lock.chunks.push(bufferToChunk(publicKey.toBuffer()))
		lock.chunks.push(opcodeToChunk(Opcode.OP_CHECKSIGVERIFY))
		partial.chunks.forEach(() => {
			lock.chunks.push(opcodeToChunk(Opcode.OP_DROP))
		})
		lock.chunks.push(opcodeToChunk(Opcode.OP_TRUE))

		let lockhash = Hash.ripemd160(Hash.sha256(lock.toBuffer()))

		let p2sh = new Script()
		p2sh.chunks.push(opcodeToChunk(Opcode.OP_HASH160))
		p2sh.chunks.push(bufferToChunk(lockhash))
		p2sh.chunks.push(opcodeToChunk(Opcode.OP_EQUAL))

		let p2shOutput = new Transaction.Output({
			script: p2sh,
			satoshis: 100000
		})

		let tx = new Transaction()
		if (p2shInput) tx.addInput(p2shInput)
		tx.addOutput(p2shOutput)
		fund(wallet, tx)

		if (p2shInput) {
			let signature = Transaction.sighash.sign(tx, privateKey, Signature.SIGHASH_ALL, 0, lastLock)
			let txsignature = Buffer.concat([signature.toBuffer(), Buffer.from([Signature.SIGHASH_ALL])])

			let unlock = new Script()
			unlock.chunks = unlock.chunks.concat(lastPartial.chunks)
			unlock.chunks.push(bufferToChunk(txsignature))
			unlock.chunks.push(bufferToChunk(lastLock.toBuffer()))
			tx.inputs[0].setScript(unlock)
		}

		updateWallet(wallet, tx)
		txs.push(tx)

		p2shInput = new Transaction.Input({
			prevTxId: tx.hash,
			outputIndex: 0,
			output: tx.outputs[0],
			script: ''
		})

		p2shInput.clearSignatures = () => {}
		p2shInput.getSignatures = () => {}

		lastLock = lock
		lastPartial = partial
	}

	let tx = new Transaction()
	tx.addInput(p2shInput)
	tx.to(address, 100000)
	fund(wallet, tx)

	let signature = Transaction.sighash.sign(tx, privateKey, Signature.SIGHASH_ALL, 0, lastLock)
	let txsignature = Buffer.concat([signature.toBuffer(), Buffer.from([Signature.SIGHASH_ALL])])

	let unlock = new Script()
	unlock.chunks = unlock.chunks.concat(lastPartial.chunks)
	unlock.chunks.push(bufferToChunk(txsignature))
	unlock.chunks.push(bufferToChunk(lastLock.toBuffer()))
	tx.inputs[0].setScript(unlock)

	updateWallet(wallet, tx)
	txs.push(tx)

	return txs
}

function fund(wallet, tx) {
	tx.change(wallet.address)
	delete tx._fee

	for (const utxo of wallet.utxos) {
		if (tx.inputs.length && tx.outputs.length && tx.inputAmount >= tx.outputAmount + tx.getFee()) {
			break
		}

		delete tx._fee
		tx.from(utxo)
		tx.change(wallet.address)
		tx.sign(wallet.privkey)
	}

	if (tx.inputAmount < tx.outputAmount + tx.getFee()) {
		throw new Error('not enough funds')
	}
}

function updateWallet(wallet, tx) {
	wallet.utxos = wallet.utxos.filter((utxo) => {
		for (const input of tx.inputs) {
			if (input.prevTxId.toString('hex') == utxo.txid && input.outputIndex == utxo.vout) {
				return false
			}
		}
		return true
	})

	tx.outputs.forEach((output, vout) => {
		if (output.script.toAddress().toString() == wallet.address) {
			wallet.utxos.push({
				txid: tx.hash,
				vout,
				script: Script(new Address(wallet.address)).toHex(),
				satoshis: output.satoshis
			})
		}
	})
}

async function broadcast(tx, retry) {
	const body = {
		jsonrpc: '1.0',
		id: 0,
		method: 'sendrawtransaction',
		params: [tx.toString()]
	}

	const options = {
		auth: {
			username: process.env.NODE_RPC_USER,
			password: process.env.NODE_RPC_PASS
		}
	}

	while (true) {
		try {
			await axios.post(process.env.NODE_RPC_URL, body, options)
			break
		} catch (e) {
			if (!retry) {
				let m = e && e.response && e.response.data
				throw m ? JSON.stringify(m) : e
			}

			let msg =
				e.response && e.response.data && e.response.data.error && e.response.data.error.message
			if (msg && msg.includes('too-long-mempool-chain')) {
				console.warn('retrying, too-long-mempool-chain')
				await new Promise((resolve) => setTimeout(resolve, 1000))
			} else {
				throw e
			}
		}
	}

	let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))

	updateWallet(wallet, tx)

	fs.writeFileSync(WALLET_PATH, JSON.stringify(wallet, 0, 2))
}

function chunkToNumber(chunk) {
	if (chunk.opcodenum == 0) return 0
	if (chunk.opcodenum == 1) return chunk.buf[0]
	if (chunk.opcodenum == 2) return chunk.buf[1] * 255 + chunk.buf[0]
	if (chunk.opcodenum > 80 && chunk.opcodenum <= 96) return chunk.opcodenum - 80
	return undefined
}

async function extract(txid) {
	let resp = await axios.get(`https://api.junkiewally.xyz/tx/${txid}/raw`)
	let transaction = resp.data.transaction
	let script = Script.fromHex(transaction.inputs[0].scriptSig.hex)
	let chunks = script.chunks

	let prefix = chunks.shift().buf.toString('utf8')
	if (prefix != 'ord') {
		throw new Error('not a doginal')
	}

	let pieces = chunkToNumber(chunks.shift())

	let contentType = chunks.shift().buf.toString('utf8')

	let data = Buffer.alloc(0)
	let remaining = pieces

	while (remaining && chunks.length) {
		let n = chunkToNumber(chunks.shift())

		if (n !== remaining - 1) {
			txid = transaction.outputs[0].spent.hash
			resp = await axios.get(`https://api.junkiewally.xyz/tx/${txid}/raw`)
			transaction = resp.data.transaction
			script = Script.fromHex(transaction.inputs[0].scriptSig.hex)
			chunks = script.chunks
			continue
		}

		data = Buffer.concat([data, chunks.shift().buf])
		remaining -= 1
	}

	return {
		contentType,
		data
	}
}

function server() {
	const app = express()
	const port = process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT) : 3000

	app.get('/tx/:txid', (req, res) => {
		extract(req.params.txid)
			.then((result) => {
				res.setHeader('content-type', result.contentType)
				res.send(result.data)
			})
			.catch((e) => res.send(e.message))
	})

	app.listen(port, () => {
		console.log(`Listening on port ${port}`)
		console.log()
		console.log(`Example:`)
		console.log(
			`http://localhost:${port}/tx/15f3b73df7e5c072becb1d84191843ba080734805addfccb650929719080f62e`
		)
	})
}

function showHelp() {
    const asciiArt = `
       __            __                  _       __  _                 
      / /_  ______  / /_________________(_)___  / /_(_)___  ____  _____
 __  / / / / / __ \\/ //_/ ___/ ___/ ___/ / __ \\/ __/ / __ \\/ __ \\/ ___/
/ /_/ / /_/ / / / / ,< (__  ) /__/ /  / / /_/ / /_/ / /_/ / / / (__  ) 
\\____/\\__,_/_/ /_/_/|_/____/\\___/_/  /_/ .___/\\__/_/\\____/_/ /_/____/  
                                      /_/                              
`;

    const sections = {
        'Wallet Management': [
            ['wallet new', 'Create a new wallet'],
            ['wallet sync', 'Sync wallet UTXOs'],
            ['wallet balance', 'Show wallet balance'],
            ['wallet show', 'Show wallet address and private key'],
            ['wallet split <number-of-split>', 'Split UTXOs'],
            ['wallet consolidate', 'Consolidate UTXOs']
        ],
        'Inscription Commands': [
            ['mint <address> <file-path>', 'Inscribe file'],
            ['mint-junkmap <address> <start> <end>', 'Mint junkmap']
        ],
        'JUNK-20 Token Operations': [
            ['junk-20 deploy <address> <tick> <max> <lim>', 'Deploy new token'],
            ['junk-20 mint <address> <tick> <amt> [repeat]', 'Mint tokens'],
            ['junk-20 transfer <address> <tick> <amt>', 'Transfer tokens']
        ]
    };

    const examples = [
        ['node . wallet new', 'Create new wallet'],
        ['node . junk-20 deploy JKCaddress sail 1000000 100', 'Deploy sail token'],
        ['node . junk-20 mint JKCaddress sail 100 10', 'Mint sail tokens 10 times'],
        ['node . mint JKCaddress ./junk.png', 'Inscribe image file'],
        ['node . mint-junkmap JKCaddress 1 100', 'Mint junkmap from 1 to 100']
    ];

    console.log(asciiArt);
    console.log('\nJunkscriptions CLI v1.0.0\n');

    Object.entries(sections).forEach(([title, commands]) => {
        console.log(`\x1b[1m\x1b[34m${title}\x1b[0m`);
        console.log('─'.repeat(title.length));
        commands.forEach(([cmd, desc]) => {
            console.log(`  \x1b[33m${cmd.padEnd(45)}\x1b[0m ${desc}`);
        });
        console.log();
    });

    console.log('\x1b[1m\x1b[34mExample Usage\x1b[0m');
    console.log('─'.repeat(12));
    examples.forEach(([cmd, desc]) => {
        console.log(`  \x1b[32m${cmd}\x1b[0m`);
        console.log(`  ${desc}\n`);
    });
}

main().catch((e) => {
	let reason =
		e.response && e.response.data && e.response.data.error && e.response.data.error.message
	console.error(reason ? e.message + ':' + reason : e.message)
})
