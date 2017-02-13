CC = xtensa-lx106-elf-gcc
CFLAGS = -I. -mlongcalls -DICACHE_FLASH
LDLIBS = -nostdlib -Wl,--start-group -lmain -lnet80211 -lwpa -llwip -lpp -lcirom -lphy -Wl,--end-group -lgcc
LDFLAGS = -Teagle.app.v6.ld

all: espsonoff-0x00000.bin espsend433-0x00000.bin espds18b20-0x00000.bin espws2812-0x00000.bin espbme280-0x00000.bin

# espsonoff

espsonoff-0x00000.bin: espsonoff
	esptool.py elf2image $^

espsonoff: espsonoff.o

espsonoff.o: espsonoff.c

flash-espsonoff: espsonoff-0x00000.bin
	sudo esptool.py -p /dev/ttyUSB3 -b 230400 write_flash 0 espsonoff-0x00000.bin 0x10000 espsonoff-0x10000.bin

# espsend433

espsend433-0x00000.bin: espsend433
	esptool.py elf2image $^

espsend433: espsend433.o

espsend433.o: espsend433.c

flash-espsend433: espsend433-0x00000.bin
	sudo esptool.py -p /dev/ttyUSB3 -b 230400 write_flash 0 espsend433-0x00000.bin 0x10000 espsend433-0x10000.bin

# espds18b20

espds18b20-0x00000.bin: espds18b20
	esptool.py elf2image $^

espds18b20: espds18b20.o ds18b20.o

ds18b20: ds18b20.o

ds18b20.o: ds18b20.c

espds18b20.o: espds18b20.c

flash-espds18b20: espds18b20-0x00000.bin
	sudo esptool.py -p /dev/ttyUSB3 -b 230400 write_flash 0 espds18b20-0x00000.bin 0x10000 espds18b20-0x10000.bin

# espws2812

espws2812-0x00000.bin: espws2812
	esptool.py elf2image $^

espws2812: espws2812.o ds18b20.o

ds18b20: ds18b20.o

ds18b20.o: ds18b20.c

espws2812.o: espws2812.c

flash-espws2812: espws2812-0x00000.bin
	sudo esptool.py -p /dev/ttyUSB3 -b 230400 write_flash 0 espws2812-0x00000.bin 0x10000 espws2812-0x10000.bin

# espbme280

espbme280-0x00000.bin: espbme280
	esptool.py elf2image $^

espbme280: espbme280.o i2c_master.o bme280.o

i2c_master.o: i2c_master.c

bme280.o: bme280.c

espbme280.o: espbme280.c

flash-espbme280: espbme280-0x00000.bin
	sudo esptool.py -p /dev/ttyUSB3 -b 230400 write_flash 0 espbme280-0x00000.bin 0x10000 espbme280-0x10000.bin

clean:
	rm -f \
		espsonoff espsonoff.o espsonoff-0x00000.bin espsonoff-0x10000.bin \
		espsend433 espsend433.o espsend433-0x00000.bin espsend433-0x10000.bin \
		espds18b20 espds18b20.o espds18b20-0x00000.bin espds18b20-0x10000.bin \
		espws2812 espws2812.o espws2812-0x00000.bin espws2812-0x10000.bin \
		espbme280 espbme280.o espbme280-0x00000.bin espbme280-0x10000.bin \
