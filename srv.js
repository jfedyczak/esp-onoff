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
		console.log(data)
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
		let payload;
		switch (dev.type) {
			case '433TX':
				dev.send(`>${payload}`, (err, resp) => {
					if (err || resp != 'OK') return c.end('ERROR')
					c.end("OK")
				})
				break;
			case 'TEMP':
				dev.send(payload, (err, resp) => {
					if (err || resp == 'ERROR') return c.end('ERROR')
					c.end(resp)
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

// process.stdin.setRawMode(true)
// process.stdin.on('data', (key) => {
// 	let d = devices['375433ac-c371-4d15-816b-1bbbb4b4f1d4']
// 	// let d = devices['0ac1d020-7cd4-4ae4-9da3-241b4398bb8c']
// 	if (key == "q") process.exit()
// 	if (key == "r") d.send("READ", (err, data) => {
// 		console.log(data)
// 	})
// })
// process.stdin.resume()
