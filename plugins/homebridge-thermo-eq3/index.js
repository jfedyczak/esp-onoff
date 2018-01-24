"use strict"

const net = require('net')

let Service, Characteristic

module.exports = (homebridge) => {
	Service = homebridge.hap.Service
	Characteristic = homebridge.hap.Characteristic
	homebridge.registerAccessory("hb-thermo-eq3", "thermo-eq3", EQ3Thermo)
}

class EQ3Thermo {
	constructor(log, config) {
		this.state = {
			lowBattery: false,
			valvePosition: 0,
			targetTemperature: 4.5
		}
		this.thermoService = null
		this.temperatureDisplayUnits = Characteristic.TemperatureDisplayUnits.CELSIUS
		this.log = log
		this.address = config.address
		this.name = config.name
		this.lock = 'lock' in config ? config.lock : false
		this.offset = 'offset' in config ? config.offset : 0
		this.tempSensor = 'tempSensor' in config ? config.tempSensor : null
		this.log(`Starting thermo ${this.address}`)
		this.requestData({
			cmd: 'ADD',
			offset: this.offset,
			lock: this.lock
		}, () => {
			this.refreshState()
			this.refreshCurrentTemp()
		})
	}
	refreshState() {
		setTimeout(() => {
			this.getStatus((err) => {
				this.refreshState()
			})
		}, 15000)
	}
	refreshCurrentTemp() {
		setTimeout(() => {
			this.getCurrentTemperature((err, temp) => {
				this.refreshState()
			})
		}, 15000)
	}
	requestData(params, callback) {
		let ok = false
		let response = {}
		params.address = this.address
		this.log(`Executing thermo ${JSON.stringify(params)}`)
		let client = net.connect({
			host: '127.0.0.1',
			port: 37203
		}, () => {
			client.write(`${JSON.stringify(params)}\n`)
		})
		client.on('data', (data) => {
			try {
				data = JSON.parse(data.toString().trim())
				response = data
				if (('ok' in data) && data.ok)
					ok = true
			} catch (e) {
				this.log(e)
			}
		})
		client.on('end', () => {
			if (ok) {
				callback(null, response)
			} else {
				callback('ERROR')
				this.log(`Thermo error`)
			}
		})
	}
	getExternalTemp(guid, callback) {
		let ok = false
		let client = net.connect({
			host: '127.0.0.1',
			port: 37202
		}, () => {
			client.write(`${guid};READ`)
		})
		client.on('data', (data) => {
			if (data != 'ERROR') {
				this.temperature = parseFloat(data)
				ok = true
			}
		})
		client.on('end', () => {
			if (ok) {
				if (this.thermoService !== null)
					this.thermoService.setCharacteristic(Characteristic.CurrentTemperature, this.temperature)
				callback(null, this.temperature)
			} else {
				callback('ERROR')
			}
		})
	}
	getStatus(callback) {
		// TODO: cache
		this.requestData({
			cmd: 'STATUS',
			offset: this.offset,
		}, (err, response) => {
			if (err) return callback(err)
			this.state = response
			if (this.thermoService !== null) {
				this.thermoService.setCharacteristic(Characteristic.CurrentHeatingCoolingState, this.parseCurrentHCState())
				this.thermoService.getCharacteristic(Characteristic.TargetHeatingCoolingState).setValue(this.parseTargetHCState(), undefined, 'setOnly')
				this.thermoService.getCharacteristic(Characteristic.TargetTemperature).setValue(this.state.targetTemperature, undefined, 'setOnly')
			}
			callback(null, this.state)
		})
	}
	parseCurrentHCState() {
		if (this.state.valvePosition > 0)
			return Characteristic.CurrentHeatingCoolingState.HEAT
		return Characteristic.CurrentHeatingCoolingState.OFF	
	}
	getCurrentHCState(callback) {
		this.getStatus((err, status) => {
			if (err) return callback(err)
			callback(null, this.parseCurrentHCState())
		})
	}
	parseTargetHCState() {
		if (this.state.targetTemperature > 4.5)
			return Characteristic.TargetHeatingCoolingState.HEAT
		return Characteristic.TargetHeatingCoolingState.OFF
	}
	getTargetHCState(callback) {
		this.getStatus((err, status) => {
			if (err) return callback(err)
			callback(null, this.parseTargetHCState())
		})
	}
	setTargetHCState(value, callback, context) {
		if (context === 'setOnly') return callback(null)
		if (value == Characteristic.TargetHeatingCoolingState.OFF)
			return this.setTargetTemperature(4.5, callback)
		callback(null)
	}
	getCurrentTemperature(callback) {
		// stupid but required
		if (this.tempSensor === null)
			return callback(null, this.state.targetTemperature)
		this.getExternalTemp(this.tempSensor, callback)
	}
	getTargetTemperature(callback) {
		this.getStatus((err, status) => {
			if (err) return callback(err)
			return callback(null, status.targetTemperature)
		})
	}
	setTargetTemperature(temp, callback, context) {
		if (context === 'setOnly') return callback(null)
		this.requestData({
			cmd: 'TEMP',
			temp: temp
		}, (err) => {
			if (err) return callback(err)
			callback(null)
		})
	}
	getLowBattery(callback) {
		this.getStatus((err, status) => {
			if (err) return callback(err)
			return callback(null, status.lowBattery ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)			
		})
	}
	getServices() {
		this.thermoService = new Service.Thermostat(this.name)
		let infoService = new Service.AccessoryInformation()
		
		infoService
			.setCharacteristic(Characteristic.Name, this.name)
			.setCharacteristic(Characteristic.Manufacturer, 'eq-3')
			.setCharacteristic(Characteristic.Model, 'CC-RT-BLE')
			.setCharacteristic(Characteristic.SerialNumber, this.address)

		this.thermoService
			.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
			.on('get', this.getCurrentHCState.bind(this))
			.setProps({
				perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
			})
		
		this.thermoService
			.getCharacteristic(Characteristic.TargetHeatingCoolingState)
			.on('set', this.setTargetHCState.bind(this))
			.on('get', this.getTargetHCState.bind(this))
			.setProps({
				perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE,  Characteristic.Perms.NOTIFY]
			})

		this.thermoService
			.getCharacteristic(Characteristic.CurrentTemperature)
			.on('get', this.getCurrentTemperature.bind(this))
			.setProps({
				format: Characteristic.Formats.FLOAT,
				minStep: 0.1,
				perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
			})

		this.thermoService
			.getCharacteristic(Characteristic.TargetTemperature)
			.on('set', this.setTargetTemperature.bind(this))
			.on('get', this.getTargetTemperature.bind(this))
			.setProps({
				format: Characteristic.Formats.FLOAT,
				minValue: 4.5,
				maxValue: 30,
				minStep: 0.5,
				perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE,  Characteristic.Perms.NOTIFY]
			})
		
		this.thermoService
			.addCharacteristic(new Characteristic.StatusLowBattery())
			.on('get', this.getLowBattery.bind(this))
		
		this.thermoService
			.getCharacteristic(Characteristic.TemperatureDisplayUnits)
			.on('get', cb => cb(null, this.temperatureDisplayUnits))
			.on('set', (v, cb) => {
				this.temperatureDisplayUnits = v
				cb(null)
			})
		return [infoService, this.thermoService]
	}
}
