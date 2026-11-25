// The one text slice a fixture takes of a source file: from the start marker up to the end marker.
// A marker that is gone throws naming it and the file, so a fixture never runs an empty slice.
function sliceBetween(source, start, end, file) {
  const from = source.indexOf(start);
  if (from < 0) throw Error(file + ' has no ' + JSON.stringify(start));
  const to = source.indexOf(end, from);
  if (to < 0) throw Error(file + ' has no ' + JSON.stringify(end) + ' after ' + JSON.stringify(start));
  return source.slice(from, to);
}
module.exports = { sliceBetween };
