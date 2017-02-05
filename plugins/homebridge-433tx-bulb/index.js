"use strict"

const net = require('net')

let Service, Characteristic

module.exports = (homebridge) => {
	Service = homebridge.hap.Service
	Characteristic = homebridge.hap.Characteristic
	homebridge.registerAccessory("hb-433tx-bulb", "433tx-bulb", Bulb)
}

class Bulb {
	constructor(log, config) {
		this.log = log
		this.guid = config.guid
		this.name = config.name
		this.state = 0
		this.codeOn = config.codeOn
		this.codeOff = config.codeOff
		this.log(`Starting 433bulb ${this.guid}`)
	}
	
	getPowerOn(callback) {
		callback(null, this.state == 1)
	}
	
	setPowerOn(powerOn, callback) {
		let ok = false
		let client = net.connect({
			host: '127.0.0.1',
			port: 37202
		}, () => {
			let code = powerOn == 1 ? this.codeOn : this.codeOff
			client.write(`${this.guid};${code}`)
		})
		client.on('data', (data) => {
			if (data == 'OK') {
				this.state = powerOn
				ok = true
			}
		})
		client.on('end', () => {
			if (ok) {
				callback(null)
			} else {
				callback('ERROR')
			}
		})
	}
	
	getServices() {
		let lightbulbService = new Service.Lightbulb(this.name);

		lightbulbService
			.getCharacteristic(Characteristic.On)
			.on('get', this.getPowerOn.bind(this))
			.on('set', this.setPowerOn.bind(this))

		return [lightbulbService]
	}
}
