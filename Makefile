CC = xtensa-lx106-elf-gcc
CFLAGS = -I. -mlongcalls
LDLIBS = -nostdlib -Wl,--start-group -lmain -lnet80211 -lwpa -llwip -lpp -lc -lphy -Wl,--end-group -lgcc
LDFLAGS = -Teagle.app.v6.ld

all: esponoff-0x00000.bin espsend433-0x00000.bin

# esponoff

esponoff-0x00000.bin: esponoff
	esptool.py elf2image $^

esponoff: esponoff.o

esponoff.o: esponoff.c

flash-esponoff: esponoff-0x00000.bin
	sudo esptool.py -p /dev/ttyUSB3 -b 230400 write_flash 0 esponoff-0x00000.bin 0x10000 esponoff-0x10000.bin

# espsend433

espsend433-0x00000.bin: espsend433
	esptool.py elf2image $^

espsend433: espsend433.o

espsend433.o: espsend433.c

flash-espsend433: espsend433-0x00000.bin
	sudo esptool.py -p /dev/ttyUSB3 -b 230400 write_flash 0 espsend433-0x00000.bin 0x10000 espsend433-0x10000.bin

clean:
	rm -f \
		esponoff esponoff.o esponoff-0x00000.bin esponoff-0x10000.bin \
		espsend433 espsend433.o espsend433-0x00000.bin espsend433-0x10000.bin \
