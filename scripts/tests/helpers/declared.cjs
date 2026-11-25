// A hidden setting's value as every owner reads it (runtime/settings/coordinator/table.ts
// hiddenValue): with no saved settings loaded it is the declared default, so a row that derives its
// edges from it follows a changed default.
const {hiddenValue}=require('../../../runtime/settings/coordinator/table.ts');

module.exports={hidden:hiddenValue};
