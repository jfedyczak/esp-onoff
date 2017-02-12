"use strict"

const net = require('net')

let devices = {}

const server = net.createServer((c) => {
	console.log(' -- new connection');
	c.on('close', () => {
		console.log(' -- closing connection...')
	})
	c.on('data', (data) => {
		data = data.toString().trim()
		console.log(`[${new Date()}] ${data}`)
	})
	c.on('timeout', () => {
		c.destroy()
	})
})

server.on('error', (err) => {
	console.log(` -- error ${err}`)
})

server.listen(38000, () => {
	console.log(' -- server ready')
})
