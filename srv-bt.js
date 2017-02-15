"use strict"

// based on following repositories:
//  - https://github.com/maxnowack/homebridge-eq3ble by Max Nowack
//  - https://github.com/macnow/homebridge-platform-eq3btsmart by Maciej Nowakowski

const noble = require('noble')
const net = require('net')

const DEFAULT_REFRESH_TIME = 5 * 60 * 1000
const CHANGE_REFRESH_TIME = 90 * 1000 // minimum 90 seconds

const commands = {
	INFO: () => new Buffer('03', 'hex'),
	BOOST_ON: () => new Buffer('4501', 'hex'),
	BOOST_OFF: () => new Buffer('4500', 'hex'),
	MODE_AUTO: () => new Buffer('4000', 'hex'),
	MODE_MANUAL: () => new Buffer('4040', 'hex'),
	MODE_ECO: () => new Buffer('4080', 'hex'),
	LOCK_ON: () => new Buffer('8001', 'hex'),
	LOCK_OFF: () => new Buffer('8000', 'hex'),
	TEMPERATURE: temperature => new Buffer(`41${temperature <= 7.5 ? '0' : ''}${(2 * temperature).toString(16)}`, 'hex'),
	OFFSET: offset => {
		let code = 2 * offset + 7
		code = code.toString(16)
		while (code.length < 2) code = '0' + code
		code = `13${code}`
		return new Buffer(code, 'hex')
	},
	MODE_DAY: () => new Buffer('43', 'hex'),
	MODE_NIGHT: () => new Buffer('44', 'hex'),
	TEMPERATURE_PRESET: (night, day) => {
		const tempNight = (2 * night).toString(16)
		const tempDay = (2 * day).toString(16)
		return new Buffer(`11${tempDay}${tempNight}`, 'hex')
	},
	MODE_OPEN_WINDOW: (temperature, minDuration) => {
		const temp = (2 * temperature).toString(16)
		const dur = (minDuration / 5).toString(16)
		return new Buffer(`11${temp}${dur}`, 'hex')
	},
	SET_TIME: (date) => {
		const prefix = '03'
		let year = (date.getFullYear() - 2000).toString(16)
		while (year.length < 2) year = '0' + year
		let month = (date.getMonth() + 1).toString(16)
		while (month.length < 2) month = '0' + month
		let day = date.getDate().toString(16)
		while (day.length < 2) day = '0' + day
		let hour = date.getHours().toString(16)
		while (hour.length < 2) hour = '0' + hour
		let minute = date.getMinutes().toString(16)
		while (minute.length < 2) minute = '0' + minute
		let second = date.getSeconds().toString(16)
		while (second.length < 2) second = '0' + second
		// console.log(prefix + year + month + day + hour + minute + second);
		return new Buffer(prefix + year + month + day + hour + minute + second, 'hex')
	},
}
const statuses = {
	MANUAL: 1,
	HOLIDAY: 2,
	BOOST: 4,
	DST: 8,
	OPENWINDOW: 16,
	UNKNOWN: 32,
	UNKNOWN2: 64,
	LOWBATTERY: 128,
}

class Thermostat {
	constructor(config = {}) {
		this.device = null
		this.config = config
		this.deviceInitialized = false
		this.failSafeTimer = null
		this.lastReadout = +new Date()
		this.killSwitch = false
		this.failSafeCounter = 0
		this.state = {
			lowBattery: false,
			valvePosition: 0,
			targetTemperature: 10
		}
	}
	active() { return +new Date() - this.lastReadout < 10 * 60 * 1000}
	attachDevice(device) {
		this.refreshing = false
		this.nextAutoRefresh = DEFAULT_REFRESH_TIME
		this.refreshTimer = null
		this.taskQueue = []
		this.currentTask = null
		this.device = device
		console.log(` -- [${this.device.address}] attached`)
		this.device.on('connect', () => {
			if (this.killSwitch) return
			if (this.currentTask === null) return
			this.device.writeHandle(0x0411, this.currentTask.command, false, (error) => {
				if (this.killSwitch) return
				if (error) {
					this.device.disconnect((err) => {
						this.finishTask(error)
					})
				}
			})
		})
		this.device.on('handleNotify', (handle, value) => {
			if (this.killSwitch) return
			this.parseData(value)
			this.device.disconnect((err) => {
				if (this.killSwitch) return
				this.finishTask(null, value)
			})
		})
		this.resetConfig(this.config)
	}
	finishTask(e, v) {
		this.failSafeCounter = 0
		if (this.failSafeTimer !== null) clearTimeout(this.failSafeTimer)
		this.failSafeTimer = null
		this.currentTask.callback(e, v)
		this.currentTask = null
		this.executeNextTask()
	}
	deviceReady() { return this.device !== null }
	resetConfig(config) {
		if (!this.deviceInitialized) {
			this.deviceInitialized = true
			console.log(' -- setting config')
			this.config = config
			this.config.offset = ('offset' in this.config ? this.config.offset : 0)
			this.config.lock = ('lock' in this.config ? this.config.lock : false)
			this.setDate()
			this.setOffset(this.config.offset)
			this.setLock(this.config.lock)
			this.setManualMode()
			this.refreshData()
		} else {
			if (('offset' in config) && config.offset != this.config.offset) {
				this.config.offset = config.offset
				this.setOffset(this.config.offset)
			}
			if (('lock' in config) && config.lock != this.config.lock) {
				this.config.lock = config.lock
				this.setLock(this.config.lock)
			}
		}
	}
	addTask(type, command, callback) {
		// cancel all redundant tasks
		if (this.device === null) return
		this.taskQueue = this.taskQueue.filter((t) => t.type != type)
		this.taskQueue.push({
			type: type,
			command: command,
			callback: callback
		})
		if (this.currentTask === null && this.device !== null)
			this.executeNextTask()
	}
	executeNextTask() {
		if (this.killSwitch) return
		console.log(` -- [${this.device.address}] tklen: ${this.taskQueue.length}, ct: ${this.currentTask}`)
		if (this.taskQueue.length && this.currentTask === null) {
			this.currentTask = this.taskQueue.shift()
			this.failSafeTimer = setTimeout(() => {
				this.failSafeCounter += 1
				if (this.failSafeCounter > 10) {
					// too many retries - shutting down and back to scanning
					console.log(` -- [${this.device.address}] SNAFU`)
					this.killSwitch = true
					delete devices[this.address]
					return searchForDevice(this.address)
				}
				console.log(` -- [${this.device.address}] failsafe timer r tklen: ${this.taskQueue.length}, ct: ${this.currentTask}`)
				this.failSafeTimer = null
				if (this.currentTask !== null)
					this.taskQueue.unshift(this.currentTask)
				this.currentTask = null
				this.executeNextTask()
			}, 8000)
			this.device.connect()
		}
	}
	refreshData() {
		if (this.killSwitch) return
		if (this.refreshing)
			return
		this.refreshing = true
		this.addTask('INFO', commands.INFO(), (err, value) => {
			this.refreshing = false
			if (err) {
				setTimeout(() => { this.refreshData() }, 5000)
			} else {
				// clear any pending refresh timers
				if (this.refreshTimer !== null) {
					clearTimeout(this.refreshTimer)
				}
				// set timer for next readout
				this.refreshTimer = setTimeout(() => {
					this.refreshData()
				}, this.nextAutoRefresh)
				this.nextAutoRefresh = DEFAULT_REFRESH_TIME
			}
		})
	}
	parseData(info) {
		let state = {
			manual: !!(info[2] & statuses.MANUAL),
			holiday: !!(info[2] & statuses.HOLIDAY),
			boost: !!(info[2] & statuses.BOOST),
			dst: !!(info[2] & statuses.DST),
			openWindow: !!(info[2] & statuses.OPENWINDOW),
			lowBattery: !!(info[2] & statuses.LOWBATTERY),
			valvePosition: info[3],
			targetTemperature: info[5] / 2
		}
		this.state = state
		this.lastReadout = +new Date()
		console.log(` -- [${this.device.address}] ${JSON.stringify(state)}`)
	}
	getState() {
		return JSON.parse(JSON.stringify(this.state))
	}
	setManualMode(callback = null) {
		this.addTask('MODE', commands.MODE_MANUAL(), (err, value) => {
			console.log(` -- [${this.device.address}] manual mode set`)
			if (callback !== null) callback(err)
		})
	}
	setAutoMode(callback = null) {
		this.addTask('MODE', commands.MODE_AUTO(), (err, value) => {
			console.log(` -- [${this.device.address}] auto mode set`)
			if (callback !== null) callback(err)
		})
	}
	setModeDay(callback = null) {
		this.addTask('DAYNIGHT', commands.MODE_DAY(), (err, value) => {
			console.log(` -- [${this.device.address}] day mode set`)
			if (callback !== null) callback(err)
		})
	}
	setDate(callback = null) {
		this.addTask('DATE', commands.SET_TIME(new Date()), (err) => {
			console.log(` -- [${this.device.address}] date set`)
			if (callback !== null) callback(err)
		})
	}
	setOffset(offset, callback = null) {
		this.addTask('OFFSET', commands.OFFSET(offset), (err) => {
			console.log(` -- [${this.device.address}] offset set to ${offset}`)
			if (callback !== null) callback(err)
		})
	}
	setLock(lock, callback = null) {
		this.addTask('LOCK', lock ? commands.LOCK_ON() : commands.LOCK_OFF(), (err) => {
			console.log(` -- [${this.device.address}] lock set to ${lock}`)
			if (callback !== null) callback(err)
		})
	}
	setTemperature(temp, callback = null) {
		// dirty hack
		this.state.targetTemperature = temp
		this.addTask('TEMP', commands.TEMPERATURE(temp), (err, value) => {
			console.log(` -- [${this.device.address}] temperature set to ${temp}`)
			this.nextAutoRefresh = CHANGE_REFRESH_TIME
			this.refreshData()
			if (callback !== null) callback(err)
		})
	}
}

// connected devices
let devices = {}
let configCache = {}

let searching = false
let nobleReady = false

const allDevicesFound = () => Object.keys(devices).every((a) => devices[a].deviceReady())

const searchForDevice = (address, config = null) => {
	if (config === null) {
		if (address in configCache) {
			config = configCache[address]
		} else {
			config = {}
		}
	} else {
		configCache[address] = config
	}
	if (address in devices) {
		if (JSON.stringify(config) != '{}')
			devices[address].resetConfig(config)
	} else {
		devices[address] = new Thermostat(config)
	}
	if (!searching && nobleReady && !allDevicesFound()) {
		searching = true
		noble.startScanning([], true)
	}
}

noble.on('stateChange', (state) => {
	if (state === 'poweredOn') {
		nobleReady = true
		console.log(' -- noble powered on')
		if (Object.keys(devices).length) {
			searching = true
			noble.startScanning([], true)
		}
	} else {
		console.log(` -- unsupported state: ${state}`)
	}
})

noble.on('warning', (warning) => {
	console.log(' -- noble warning: ' + warning)
})

noble.on('discover', function(device) {
	if ((device.advertisement.localName === 'CC-RT-BLE') && (device.address in devices) && (!devices[device.address].deviceReady())) {
		console.log(` -- found thermostat at ${device.address}`)
		devices[device.address].attachDevice(device)
		if (allDevicesFound()) {
			console.log(' -- found all')
			noble.stopScanning()
			searching = false
		}
	}
})

const cmdServer = net.createServer((c) => {
	c.on('close', () => {
	})
	c.on('data', (data) => {
		try {
			data = JSON.parse(data.toString().trim())
		} catch (e) {
			return c.end(JSON.stringify({error: 'parse error'}))
		}
		if (!('cmd' in data))
			return c.end(JSON.stringify({error: 'no cmd'}))
		switch (data.cmd) {
			case 'ADD': // add device to search list
				if (!('address' in data))
					return c.end(JSON.stringify({error: 'no address'}))
				searchForDevice(data.address, data)
				return c.end(JSON.stringify({ok: true}))
			case 'STATUS': // get device status
				if (!('address' in data))
					return c.end(JSON.stringify({error: 'no address'}))
				searchForDevice(data.address) // just in case
				if (!(data.address in devices))
					return c.end(JSON.stringify({error: 'no device'}))
				if (!devices[data.address].active())
					return c.end(JSON.stringify({error: 'stale'}))
				let status = devices[data.address].getState()
				status.ok = true
				return c.end(JSON.stringify(status))
			case 'TEMP': // set temperature
				if (!('address' in data))
					return c.end(JSON.stringify({error: 'no address'}))
				searchForDevice(data.address) // just in case
				if (!('temp' in data))
					return c.end(JSON.stringify({error: 'no address'}))
				if (!(data.address in devices))
					return c.end(JSON.stringify({error: 'no device'}))
				if (data.temp < 4.5) data.temp = 4.5
				else if (data.temp > 30) data.temp = 30
				devices[data.address].setTemperature(data.temp)
				return c.end(JSON.stringify({ok: true}))
			default:
				return c.end(JSON.stringify({error: 'unknown cmd'}))
		}
	})
	c.on('error', (err) => {
		console.log(` -- eroor ${err}`)
	})
})

cmdServer.on('error', (err) => {
	console.log(` -- error ${err}`)
})

cmdServer.listen(37203, () => {
	console.log(' -- server ready')
})
