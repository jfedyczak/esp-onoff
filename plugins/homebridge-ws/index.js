"use strict"

const net = require('net')

let Service, Characteristic

module.exports = (homebridge) => {
	Service = homebridge.hap.Service
	Characteristic = homebridge.hap.Characteristic
	homebridge.registerAccessory("hb-ws", "weather-station", TempSensor)
}

class TempSensor {
	constructor(log, config) {
		this.sensorTemperature = null
		this.sensorHumidity = null
		this.log = log
		this.readout = {
			t: 0,
			h: 0,
			ts: +new Date()
		}
		this.name = config.name
		this.createConn()
		this.log(`Starting temp-sensor ${this.guid}`)
	}
	active() { return +new Date() - this.readout.ts < 30 * 60 * 1000}
	createConn() {
		net.connect({
			host: '127.0.0.1',
			port: 38001
		}).on('data', (data) => {
			this.readout = JSON.parse(data.toString().trim())
			if (this.sensorTemperature !== null) this.sensorTemperature.setCharacteristic(Characteristic.CurrentTemperature, this.readout.t)
			if (this.sensorHumidity !== null) this.sensorHumidity.setCharacteristic(Characteristic.CurrentRelativeHumidity, this.readout.h)
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
		this.sensorTemperature = new Service.TemperatureSensor(`${this.name} temperature`);
		this.sensorTemperature
			.getCharacteristic(Characteristic.CurrentTemperature)
			.setProps({
				minValue: -100,
				maxValue: 100,
				minStep: 0.1,
				perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
			})
			.on('get', (callback) => {
				if (!this.active())
					return callback('stale')
				callback(null, this.readout.t)
			})

		this.sensorHumidity = new Service.HumiditySensor(`${this.name} humidity`);
		this.sensorHumidity
			.getCharacteristic(Characteristic.CurrentRelativeHumidity)
			.setProps({
				minValue: -100,
				maxValue: 100,
				minStep: 0.1,
				perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
			})
			.on('get', (callback) => {
				if (!this.active())
					return callback('stale')
				callback(null, this.readout.h)
			})
		return [this.sensorTemperature, this.sensorHumidity]
	}
}
