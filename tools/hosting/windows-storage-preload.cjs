// Old immutable coordinators also read these two paths from installed caracAL.
// Supply absolute paths before the coordinator loads, including during rollback.
const path = require('node:path');
const fs = require('node:fs');
const native = process.env.AL_CONSOLE_NATIVE_DIR;
const storage = process.env.AL_PARTY_STORAGE_DIR;
if (native && storage && process.argv[1] &&
    path.resolve(process.argv[1]).toLowerCase() === path.join(native, 'standalones', 'CharacterCoordinator.js').toLowerCase()) {
  const constants = require(path.join(native, 'src', 'CONSTANTS.js'));
  constants.LOCALSTORAGE_PATH = path.join(storage, 'caraGarage.jsonl');
  constants.LOCALSTORAGE_ROTA_PATH = path.join(storage, 'caraGarage.other.jsonl');
  const journal = fs.lstatSync(constants.LOCALSTORAGE_PATH, {throwIfNoEntry: false});
  const marker = path.join(path.dirname(storage), 'established-journal');
  if (journal && !journal.isFile() || ((!journal || !journal.size) && fs.existsSync(marker)))
    throw new Error('Expected the established party journal before coordinator launch: ' + constants.LOCALSTORAGE_PATH);
  if (journal?.size && !fs.existsSync(marker)) fs.writeFileSync(marker, 'caraGarage.jsonl\n');
}
