"use strict"

const noble = require('noble')
const net = require('net')

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
		this.taskQueue = []
		this.commandInProgress = false
		this.refreshing = false
		this.config = config
		this.config.offset = ('offset' in this.config ? this.config.offset : 0)
		this.config.lock = ('lock' in this.config ? this.config.lock : false)
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
			this.device.disconnect((err) => {
				task.callback(null, value)
				this.commandInProgress = false
				this.executeNextTask()
			})
		})
		this.setDate()
		this.setOffset(this.config.offset)
		this.setLock(this.config.lock)
		this.setManualMode()
		this.refreshData()
	}
	addTask(command, callback) {;
		this.taskQueue.push({
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
			return;
		this.refreshing = true
		this.addTask(commands.INFO(), (err, value) => {
			this.refreshing = false
			if (err) {
				setTimeout(() => { this.refresshData() }, 5000)
			} else {
				this.parseData(value)
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
	setManualMode() {
		this.addTask(commands.MODE_MANUAL(), (err, value) => {
			console.log(` -- [${this.device.address}] manual mode set`)
			this.refreshData()
		})
	}
	setAutoMode() {
		this.addTask(commands.MODE_AUTO(), (err, value) => {
			console.log(` -- [${this.device.address}] auto mode set`)
			this.refreshData()
		})
	}
	setModeDay() {
		this.addTask(commands.MODE_DAY(), (err, value) => {
			console.log(` -- [${this.device.address}] day mode set`)
		})
	}
	setDate() {
		this.addTask(commands.SET_TIME(new Date()), (err) => {
			console.log(` -- [${this.device.address}] date set`)
		})
	}
	setOffset(offset) {
		this.addTask(commands.OFFSET(offset), (err) => {
			console.log(` -- [${this.device.address}] offset set to ${offset}`)
		})
	}
	setLock(lock) {``
		this.addTask(lock ? commands.LOCK_ON() : commands.LOCK_OFF(), (err) => {
			console.log(` -- [${this.device.address}] lock set to ${lock}`)
		})
	}
	setTemperature(temp) {
		this.addTask(commands.TEMPERATURE(temp), (err, value) => {
			console.log(` -- [${this.device.address}] temperature set to ${temp}`)
			this.refreshData()
			setTimeout(() => {
				this.refreshData()
			}, 90 * 1000)
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
	if (address in wantedDevices)
		delete wantedDevices[address]
	if (address in devices)
		delete devices[address]
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
				if (!(data.address in devices))
					return c.end(JSON.stringify({error: 'no device'}))
				let status = devices[data.address].getState()
				status.ok = true
				return c.end(JSON.stringify(status))
			case 'TEMP': // set temperature
				if (!('address' in data))
					return c.end(JSON.stringify({error: 'no address'}))
				if (!('temp' in data))
					return c.end(JSON.stringify({error: 'no address'}))
				if (!(data.address in devices))
					return c.end(JSON.stringify({error: 'no device'}))
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
