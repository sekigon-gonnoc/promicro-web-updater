import { CaterinaBootloader } from "./caterina";

const caterina = new CaterinaBootloader();
const ihex = require("intel-hex");
let firmHex = null;

let bootloader = caterina;

let progress = document.getElementById("progress");
function initProgress(str) {
  progress.innerHTML = str + "\n";
  console.log(str);
}

function updateProgress(str) {
  if (str.length == 1) {
    progress.innerHTML += str;
  } else {
    progress.innerHTML += str + "\n";
  }
  console.log(str);
}

if (!navigator.serial) {
  initProgress(
    "Web serial is unavailable.\nPlease use Google Chrome or Chromium Edge\n"
  );
  console.error("Web serial is unavailable");
}

async function loadEepromHex() {
  let eepromOption = document.getElementById("eeprom");
  if (eepromOption.eeprom.value === "none") {
    return null;
  } else if (eepromOption.eeprom.value === "split-left") {
    let hex = await fetch("./eeprom-lefthand.eep").then((r) => {
      return r.text();
    });
    console.log(ihex.parse(hex));
    return new Uint8Array(ihex.parse(hex).data);
  } else if (eepromOption.eeprom.value === "split-right") {
    let hex = await fetch("./eeprom-righthand.eep").then((r) => {
      return r.text();
    });
    console.log(ihex.parse(hex));
    return new Uint8Array(ihex.parse(hex).data);
  }
}

async function readFirmware() {
  initProgress("Reset Pro Micro and choose serial port appeared.");
  try {
    let firm = await bootloader.read(0, updateProgress);
    let blob = new Blob([firm]);
    let a = document.getElementById("download-file");
    a.href = URL.createObjectURL(blob, { type: "application/octet-binary" });
    a.click();
  } catch (e) {
    console.error(e);
  }
}

document
  .getElementById("upload-file")
  .addEventListener("change", fileUpload, false);
function fileUpload() {
  console.log(this.files);
  firmHex = null;
  if (this.files.length > 0) {
    console.log(this.files[0]);
    let fname = this.files[0].name;
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      function () {
        try {
          firmHex = ihex.parse(reader.result);
          console.log(firmHex);
          initProgress(
            `Firmware opened: ${fname}(${firmHex.data.length} bytes)`
          );
        } catch (e) {
          console.error(e);
          initProgress(`Firmware open failed: ${e.toString()}`);
          firmHex = null;
        }
      },
      false
    );
    reader.readAsText(this.files[0]);
  }
}

async function verifyFirmware() {
  if (firmHex == null) {
    initProgress("Please upload firmware at first.");
    return;
  } else {
    initProgress("Reset Pro Micro and choose serial port appeared.");
  }

  try {
    await bootloader.verify(firmHex.data, updateProgress);
  } catch (e) {
    console.error(e);
    updateProgress(e.toString());
  }
}

async function flashFirmware() {
  if (firmHex == null) {
    initProgress("Please upload firmware at first.");
    return;
  } else {
    initProgress("Reset Pro Micro and choose serial port appeared.");
  }

  let eep = await loadEepromHex();

  try {
    await bootloader.write(firmHex.data, eep, updateProgress);
  } catch (e) {
    console.error(e);
    updateProgress(e.toString());
  }
}

document.getElementById("read").onclick = readFirmware;
document.getElementById("verify").onclick = verifyFirmware;
document.getElementById("flash").onclick = flashFirmware;
document.getElementById(
  "revision"
).innerText = `Revision:${process.env.REVISION}`;
