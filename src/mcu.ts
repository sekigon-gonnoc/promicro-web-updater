type Mcu = {
  signature: number;
  flashSize: number;
  eepromSize: number;
  bootAddr: number;
};

const ATMEGA32U4: Mcu = {
  signature: 0x1e9587,
  flashSize: 32768,
  eepromSize: 1024,
  bootAddr: 0x7000,
};

const MCU = { atmega32u4: ATMEGA32U4 };

export { Mcu, MCU };
