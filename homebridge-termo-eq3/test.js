const EQ3BLE = require('eq3ble').default

console.log('searching')

EQ3BLE.discover((device) => {
	console.log(device)
})
