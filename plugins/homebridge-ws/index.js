"use strict"

const net = require('net')

let Service, Characteristic

module.exports = (homebridge) => {
	Service = homebridge.hap.Service
	Characteristic = homebridge.hap.Characteristic
	homebridge.registerAccessory("hb-ws", "weather-station", TempSensor)
}

let sensorTemperature = null
let sensorHumidity = null

class TempSensor {
	constructor(log, config) {
		this.log = log
		this.readout = {
			t: 0,
			h: 0
		}
		this.name = config.name
		this.createConn()
		this.log(`Starting temp-sensor ${this.guid}`)
	}

	createConn() {
		net.connect({
			host: '127.0.0.1',
			port: 38001
		}).on('data', (data) => {
			this.readout = JSON.parse(data.toString().trim())
			if (sensorTemperature !== null) sensorTemperature.setCharacteristic(Characteristic.CurrentTemperature, this.readout.t)
			if (sensorHumidity !== null) sensorHumidity.setCharacteristic(Characteristic.CurrentRelativeHumidity, this.readout.h)
		}).on('end', () => {
			setTimeout(() => {
				this.createConn()
			}, 1000)
		})
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
		sensorTemperature = new Service.TemperatureSensor(`Temperature ${this.name}`);
		sensorTemperature
			.getCharacteristic(Characteristic.CurrentTemperature)
			.setProps({
				minValue: -100,
				maxValue: 100,
				minStep: 0.1,
				perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
			})
			.on('get', (callback) => {
				callback(null, this.readout.t)
			})

		sensorHumidity = new Service.HumiditySensor(`Humidity ${this.name}`);
		sensorHumidity
			.getCharacteristic(Characteristic.CurrentRelativeHumidity)
			.setProps({
				minValue: -100,
				maxValue: 100,
				minStep: 0.1,
				perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
			})
			.on('get', (callback) => {
				callback(null, this.readout.h)
			})
		return [sensorTemperature, sensorHumidity]
	}
}
