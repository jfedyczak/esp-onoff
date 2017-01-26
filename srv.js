"use strict"

const net = require('net')

let devices = {}

const server = net.createServer((c) => {
	console.log(' -- new connection');
	let guid = false
	let sendQueue = []
	let send = (payload, callback) => {
		sendQueue.push({
			payload: payload,
			callback: callback
		})
		if (sendQueue.length == 1 && payload !== null)
			c.write(`${payload}\n`)
	}
	let ping = () => {
		send('PING', (err, data) => {
			if (data == 'PONG') {
				setTimeout(ping, 5000)
			}
		})
	}
	c.on('close', () => {
		if (guid !== false) {
			console.log(` -- unregistering device ${devices[guid].type} (${guid})...`)
			delete devices[guid]
		}
		sendQueue.forEach((q) => q.callback('disconnected'))
		console.log(' -- closing connection...')
	})
	c.on('data', (data) => {
		data = data.toString().trim()
		if (sendQueue.length) {
			let cb = sendQueue.shift().callback
			if (cb !== null) cb(null, data)
			if (sendQueue.length) {
				c.write(`${sendQueue[0].payload}\n`)
			}
			return
		}
		console.log(` -- ignoring response ${data}`)
	})
	c.on('timeout', () => {
		c.destroy()
	})
	c.setTimeout(10000)

	send(null, (err, data) => {
		if (err)
			return;
		let params = data.split(";")
		if (params.length != 2) {
			c.destroy()
			return
		}
		guid = params[1]
		devices[guid] = {
			conn: c,
			guid: guid,
			type: params[0],
			send: (payload, callback = null) => {
				send(payload, callback)
			}
		}
		console.log(` -- device type ${params[0]} (${params[1]}) registered...`)
	})
	ping()
})

server.on('error', (err) => {
	console.log(` -- error ${err}`)
})

server.listen(37201, () => {
	console.log(' -- server ready')
})

const cmdServer = net.createServer((c) => {
	c.on('close', () => {
	})
	c.on('data', (data) => {
		data = data.toString().trim().split(";")
		let guid = data.shift()
		if (!(guid in devices)) {
			c.end('DEV NOT FOUND')
			return
		}
		let dev = devices[guid]
		switch (dev.type) {
			case '433TX':
				let payload = data.shift()
				dev.send(`>${payload}`, (err, resp) => {
					if (err || resp != 'OK') return c.end('ERROR')
					c.end("OK")
				})
				break;
			default:
				c.end('UNKNOWN DEV TYPE')
		}
	})
	c.on('error', (err) => {
		console.log(` -- eroor ${err}`)
	})
})

cmdServer.on('error', (err) => {
	console.log(` -- error ${err}`)
})

cmdServer.listen(37202, () => {
	console.log(' -- server ready')
})

process.stdin.setRawMode(true)
process.stdin.on('data', (key) => {
	let d = devices['0ac1d020-7cd4-4ae4-9da3-241b4398bb8c']
	if (key == "q") process.exit()

	if (key == "1") d.send(">00010111101011000000111100")
	if (key == "!") d.send(">00010111101011000000011100")

	if (key == "2") d.send(">00010111101011000000101100")
	if (key == "@") d.send(">00010111101011000000001100")

	if (key == "3") d.send(">00010111101011000000110100")
	if (key == "#") d.send(">00010111101011000000010100")
})
process.stdin.resume()
