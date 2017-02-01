"use strict"

const net = require('net')

let Service, Characteristic

module.exports = (homebridge) => {
	Service = homebridge.hap.Service
	Characteristic = homebridge.hap.Characteristic
	homebridge.registerAccessory("hb-temp-sensor", "temp-sensor", Bulb)
}

class TempSensor {
	constructor(log, config) {
		this.log = log
		this.guid = config.guid
		this.temperature = 0
		this.name = config.name
		this.log(`Starting temp-sensor ${this.guid}`)
	}

	getTemp(callback) {
		let ok = false
		let client = net.connect({
			host: '127.0.0.1',
			port: 37202
		}, () => {
			client.write(`${this.guid};READ`)
		})
		client.on('data', (data) => {
			if (data != 'ERROR') {
				this.temperature = parseFloat(data)
				ok = true
			}
		})
		client.on('end', () => {
			if (ok) {
				callback(null, this.temperature)
			} else {
				callback('ERROR')
			}
		})
	}

	getServices() {
		let tempSensorService = new Service.TemperatureSensor(this.name);

		tempSensorService
			.getCharacteristic(Characteristic.CurrentTemperature)
			.on('get', this.getTemp.bind(this))

		return [tempSensorService]
	}
}
