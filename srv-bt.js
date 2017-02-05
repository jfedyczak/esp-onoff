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
		code = `13${code < 16 ? '0' : ''}${code.toString(16)}`
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
		let year = date.getFullYear().toString(16)
		while (year.length < 4) year = '0' + year
		let month = (date.getMonth() + 1).toString(16)
		while (month.length < 2) month = '0' + month
		let day = date.getDay().toString(16)
		while (day.length < 2) day = '0' + day
		let hour = date.getHours().toString(16)
		while (hour.length < 2) hour = '0' + hour
		let minute = date.getMinutes().toString(16)
		while (minute.length < 2) minute = '0' + minute
		let second = date.getSeconds().toString(16)
		while (second.length < 2) second = '0' + second
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
	constructor(device, config = {}) {
		this.device = device
		this.refreshing = false
		this.nextAutoRefresh = DEFAULT_REFRESH_TIME
		this.refreshTimer = null
		this.taskQueue = []
		this.commandInProgress = false
		this.refreshing = false
		this.config = null
		this.state = {
			lowBattery: false,
			valvePosition: 0,
			targetTemperature: 19
		}

		this.device.on('connect', () => {
			this.commandInProgress = true
			this.device.writeHandle(0x0411, this.taskQueue[0].command, false, (error) => {
				if (error) {
					console.log(` -- [${this.device.address}] comm error: ${error}`)
					let task = this.taskQueue.shift()
					this.device.disconnect((err) => {
						task.callback(error)
						this.commandInProgress = false
						this.executeNextTask()
					})
				}
			})
		})
		this.device.on('handleNotify', (handle, value) => {
			let task = this.taskQueue.shift()
			// console.log(` -- response: ${value.toString('hex')}`)
			this.parseData(value)
			this.device.disconnect((err) => {
				task.callback(null, value)
				this.commandInProgress = false
				this.executeNextTask()
			})
		})
		this.resetConfig(config)
	}
	resetConfig(config) {
		if (this.config === null) {
			console.log(' -- setting config')
			console.log(config)
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
		console.log(type)
		console.log(this.taskQueue.length)
		this.taskQueue = this.taskQueue.filter((t, i) => (i == 0) || (t.type != type))
		console.log(this.taskQueue.length)
		this.taskQueue.push({
			type: type,
			command: command,
			callback: callback
		})
		if (this.taskQueue.length === 1)
			this.executeNextTask()
	}
	executeNextTask() {
		if (this.taskQueue.length && !this.commandInProgress) {
			this.device.connect()
		}
	}
	refreshData() {
		if (this.refreshing)
			return
		this.refreshing = true
		this.addTask('INFO', commands.INFO(), (err, value) => {
			this.refreshing = false
			if (err) {
				setTimeout(() => { this.refresshData() }, 5000)
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

// wanted devices
let wantedDevices = {}

let searching = false
let nobleReady = false

const searchForDevice = (address, config = {}) => {
	if (address in devices) {
		if (JSON.stringify(config) != '{}')
			devices[address].resetConfig(config)
		return
	}
	wantedDevices[address] = config
	if (!searching && nobleReady) {
		searching = true
		noble.startScanning()
	}
}

const addDevice = (device, config = {}) => {
	devices[device.address] = new Thermostat(device, config)
}

noble.on('stateChange', (state) => {
	if (state === 'poweredOn') {
		nobleReady = true
		console.log(' -- noble powered on')
		if (Object.keys(devices).length < Object.keys(wantedDevices).length) {
			searching = true
			noble.startScanning()
		}
	} else {
		console.log(` -- unsupported state: ${state}`)
	}
})

noble.on('discover', function(device) {
	if (device.advertisement.localName === 'CC-RT-BLE' && (device.address in wantedDevices)) {
		console.log(` -- found thermostat at ${device.address}`)
		addDevice(device, wantedDevices[device.address])
		if (Object.keys(devices).length === Object.keys(wantedDevices).length) {
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
