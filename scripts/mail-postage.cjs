/** Read the postage advertised by the downloaded official client; never guess. */
function mailPostage(html) {
 const amount = /(?:Send Mail[\s\S]{0,200}?Cost:|interface\.load_mail\.cost)[\s\S]{0,160}?color:\s*gold[^>]*>([\d,]+)</.exec(html)?.[1];
 return amount ? Number(amount.replaceAll(',', '')) : null;
}
module.exports = { mailPostage };
