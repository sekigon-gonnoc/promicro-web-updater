import { WebSerial } from "./webSerial";

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

class CaterinaBootloader {
  private comReceiveBuffer: number[] = [];
  private bufferSize: number;
  private com: WebSerial;
  private mcu: Mcu;

  private dumpHex(arr: number[]): string {
    return arr
      .map((v) => {
        return v.toString(16);
      })
      .join(" ");
  }

  private sleep(ms: number) {
    return new Promise((resolve: any) => setTimeout(resolve, ms));
  }

  private receiveResponse(arr: Uint8Array) {
    this.comReceiveBuffer = this.comReceiveBuffer.concat(Array.from(arr));
  }

  private async readResponse(size: number, timeout: number): Promise<number[]> {
    let cnt = 0;
    while (this.comReceiveBuffer.length < size && cnt < timeout) {
      await this.sleep(1);
      cnt += 1;
    }

    if (cnt >= timeout) {
      return Promise.reject(new Error("Serial receive timeout"));
    }

    let ret = this.comReceiveBuffer.slice(0, size);
    this.comReceiveBuffer = this.comReceiveBuffer.slice(size);

    return ret;
  }

  private async verifyCommandSent() {
    let ret = await this.readResponse(1, 1000);
    if (ret[0] != "\r".charCodeAt(0)) {
      return Promise.reject(new Error(`Command failed. res:${ret[0]}`));
    }
  }

  private async detect(): Promise<boolean> {
    let ret: number[];

    await this.com.writeString("S");
    ret = await this.readResponse(7, 1000);

    let bl_string = new TextDecoder().decode(Uint8Array.from(ret));
    console.log(`Bootloader:${bl_string}`);

    if (bl_string !== "CATERIN") {
      return false;
    }

    await this.com.writeString("V");
    let sw_ver = await this.readResponse(2, 1000);
    console.log(`Software version:${sw_ver[0] - 0x30}.${sw_ver[1] - 0x30}`);

    await this.com.writeString("v");
    let hw_ver = await this.readResponse(1, 1000);
    if (hw_ver[0] != "?".charCodeAt(0)) {
      hw_ver = hw_ver.concat(await this.readResponse(1, 1000));
      console.log(`Hardware version:${hw_ver[0]}.${hw_ver[1]}`);
    } else {
      console.log("Unknown hardware version");
    }

    await this.com.writeString("p");
    let pgm_type = await this.readResponse(1, 1000);
    console.log(`Program type:${pgm_type}`);

    await this.com.writeString("a");
    let auto_incr = (await this.readResponse(1, 1000)[0]) == "Y".charCodeAt[0];
    console.log(`Auto address increment support:${auto_incr}`);

    await this.com.writeString("b");
    let buffer_access =
      (await this.readResponse(1, 1000)[0]) == "Y".charCodeAt[0];
    if (!buffer_access) {
      return false;
    }
    ret = await this.readResponse(2, 1000);
    this.bufferSize = (ret[0] << 8) | ret[1];
    console.log(`Buffer size:${this.bufferSize}`);

    await this.com.writeString("t");
    ret = await this.readResponse(1, 1000);
    let dev_type = ret;
    console.log(`Device type:${dev_type}`);

    do {
      ret = await this.readResponse(1, 1000);
    } while (ret[0] != 0);

    await this.com.writeString("T");
    await this.com.write(Uint8Array.from(dev_type));
    await this.verifyCommandSent();

    let eb = await this.readEFuse();
    let lb = await this.readLFuse();
    let hb = await this.readHFuse();
    let lock = await this.readLockBits();

    console.log(
      `Fuse: Lock:${lock.toString(16)} E:${eb.toString(16)} H:${hb.toString(
        16
      )} L:${lb.toString(16)}`
    );

    console.log("Valid caterina bootloader is found");
    return true;
  }

  private async readSignature(): Promise<number> {
    await this.com.writeString("s");
    let signature_bytes = await this.readResponse(3, 1000);
    let signature =
      (signature_bytes[2] << 16) |
      (signature_bytes[1] << 8) |
      signature_bytes[0];
    console.log(`Signature:0x${signature.toString(16)}`);
    return signature;
  }

  private async setAddress(addr: number) {
    let cmd = Array(3);
    cmd[0] = "A".charCodeAt(0);
    cmd[1] = addr >> 8;
    cmd[2] = addr & 0xff;

    await this.com.write(Uint8Array.from(cmd));
    await this.verifyCommandSent();
  }

  private async readFlash(
    len: number,
    progress: (str: string) => void = () => {}
  ): Promise<number[]> {
    let cmd = Array(4);
    let block: number[];
    let res = Array(0);
    cmd[0] = "g".charCodeAt(0);
    cmd[3] = "F".charCodeAt(0);

    let addr = 0;
    await this.setAddress(addr);

    while (addr < len) {
      cmd[1] = this.bufferSize >> 8;
      cmd[2] = this.bufferSize & 0xff;

      await this.com.write(Uint8Array.from(cmd));
      block = await this.readResponse(this.bufferSize, 1000);

      res = res.concat(Array.from(block));

      addr += this.bufferSize;

      progress(".");
    }

    return res;
  }

  private async enterProgMode() {
    await this.com.writeString("P");
    await this.verifyCommandSent();
  }

  private async leaveProgMode() {
    await this.com.writeString("L");
    await this.verifyCommandSent();
  }

  private async eraseAll() {
    await this.com.writeString("e");
    await this.verifyCommandSent();
  }

  private async writeFlash(
    bin: Uint8Array,
    progress: (str: string) => void = () => {}
  ) {
    let cmd = Array(4);
    cmd[0] = "B".charCodeAt(0);
    cmd[3] = "F".charCodeAt(0);

    let blockSize = this.bufferSize;
    let addr = 0;
    await this.setAddress(addr);

    this.comReceiveBuffer = [];

    while (addr < bin.length) {
      if (bin.length - addr < this.bufferSize) {
        blockSize = bin.length - addr;
      }
      cmd[1] = blockSize >> 8;
      cmd[2] = blockSize & 0xff;

      await this.com.write(Uint8Array.from(cmd));
      await this.com.write(bin.slice(addr, addr + blockSize));
      await this.verifyCommandSent();

      addr += blockSize;

      progress(".");
    }
  }

  private async exit() {
    await this.com.writeString("E");
    await this.verifyCommandSent();
  }

  private async readLockBits(): Promise<number> {
    await this.com.writeString("r");
    let ret = await this.readResponse(1, 1000);
    return ret[0];
  }

  private async readEFuse(): Promise<number> {
    await this.com.writeString("Q");
    let ret = await this.readResponse(1, 1000);
    return ret[0];
  }

  private async readHFuse(): Promise<number> {
    await this.com.writeString("N");
    let ret = await this.readResponse(1, 1000);
    return ret[0];
  }

  private async readLFuse(): Promise<number> {
    await this.com.writeString("F");
    let ret = await this.readResponse(1, 1000);
    return ret[0];
  }

  private async verifyFlash(
    bin: Uint8Array,
    progress: (str: string) => void = (str) => {
      console.log(str);
    }
  ) {
    progress(`Verify ${bin.length} bytes...`);
    let firm = await this.readFlash(bin.length, progress);
    console.log(firm);
    for (let idx = 0; idx < bin.length; idx++) {
      if (bin[idx] != firm[idx]) {
        progress(`Verify NG at address 0x${idx.toString(16)}`);
        return Promise.reject(new Error("Verify failed"));
      }
    }
    progress("Verify OK");
  }

  private async initBootloader(
    com: WebSerial,
    progress: (str: string) => void = (str) => {
      console.log(str);
    }
  ) {
    this.com = com;
    this.comReceiveBuffer = [];
    this.com.setReceiveCallback(this.receiveResponse.bind(this));
    let isCaterin = await this.detect();
    if (!isCaterin) {
      progress("Caterina bootloader is not found");
    }
    let signature = await this.readSignature();

    if (signature == ATMEGA32U4.signature) {
      progress("atmega32u4 found.");
      this.mcu = ATMEGA32U4;
    } else {
      progress("No flash config for this mcu");

      return Promise.reject(new Error("No flash config for this mcu"));
    }
  }

  async read(
    com: WebSerial,
    size: number = 0,
    progress: (str: string) => void = (str) => {
      console.log(str);
    }
  ): Promise<Uint8Array> {
    await this.initBootloader(com, progress);

    if (size == 0) {
      size = this.mcu.flashSize;
    }
    size = Math.min(this.mcu.flashSize, size);

    progress(`Reading ${size} bytes...`);
    let firm = await this.readFlash(size, progress);
    progress(`Read complete`);

    await this.exit();

    console.log(firm);

    return Uint8Array.from(firm);
  }

  async write(
    com: WebSerial,
    bin: Uint8Array,
    progress: (str: string) => void = (str) => {
      console.log(str);
    }
  ) {
    await this.initBootloader(com, progress);

    if (bin.length > this.mcu.bootAddr) {
      return Promise.reject(
        new Error(
          `Binary image size exceeds limit ${bin.length}>{mcu.bootAddr}`
        )
      );
    }

    await this.enterProgMode();

    progress("Erase all...");
    await this.eraseAll();
    progress("Erase complete...");

    progress(`Flash ${bin.length} bytes...`);
    await this.writeFlash(bin, progress);
    progress("Flash complete...");

    await this.verifyFlash(bin, progress);

    await this.leaveProgMode();

    await this.exit();
  }

  async verify(
    com: WebSerial,
    bin: Uint8Array,
    progress: (str: string) => void = (str) => {
      console.log(str);
    }
  ) {
    await this.initBootloader(com, progress);

    if (bin.length > this.mcu.bootAddr) {
      return Promise.reject(
        new Error(
          `Binary image size exceeds limit ${bin.length}>{mcu.bootAddr}`
        )
      );
    }

    await this.verifyFlash(bin, progress);
    await this.exit();
  }
}

export { CaterinaBootloader };
