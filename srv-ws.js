"use strict"

const PORT_WS = 38000
const PORT_CMD = 38001

const net = require('net')
const EventEmitter = require('events')

const parseNum = (n) => {
	let parts = /^(-[0-9]+)\.0-([0-9]+)$/.exec(n)
	if (parts) {
		return +`${parts[1]}.${parts[2].length < 2 ? '0' : ''}${parts[2]}`
	} else {
		return +n;
	}
}

let dataEmitter = new EventEmitter()

let lastReadout = {
	t: null,
	p: null,
	h: null,
	ts: 0
}

net.createServer((c) => {
	// console.log(' -- new connection')
	c.on('close', () => {
		// console.log(' -- closing connection...')
	})
	c.on('data', (data) => {
		data = data.toString().trim().split(';').map(parseNum)
		lastReadout.t = data[0]
		lastReadout.p = data[1]
		lastReadout.h = data[2]
		lastReadout.ts = +new Date()
		console.log(`[${new Date()}] ${JSON.stringify(lastReadout)}`)
		dataEmitter.emit('readout', lastReadout)
	})
	c.on('timeout', () => {
		c.destroy()
	})
}).on('error', (err) => {
	console.log(` -- error ${err}`)
}).listen(PORT_WS, () => {
	console.log(' -- server ready')
})

net.createServer((c) => {
	let handler = (data) => {
		c.write(`${JSON.stringify(data)}\n`)
	}
	c.on('close', () => {
		dataEmitter.removeListener('readout', handler)
	})
	dataEmitter.on('readout', handler)
	c.write(`${JSON.stringify(lastReadout)}\n`)
}).on('error', (err) => {
	console.log(` -- error ${err}`)
}).listen(PORT_CMD, () => {
	console.log(' -- cmd server ready')
})
