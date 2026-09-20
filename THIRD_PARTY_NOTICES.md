# Third-party notices

Our original code is distributed under [MIT](LICENSE). Dependencies retain their own licenses.

- **caracAL**, copyright 2021 numbereself, MIT. Base revision: `234af745d59807be4da49f13430b91980d3e98c9`.
  [Source](https://github.com/numbereself/caracAL). Modified through our compatibility patch and runtime adapters.
  Full notice: [licenses/caracal.txt](licenses/caracal.txt).
- **thmsn / thmsndk's caracAL script discovery**, MIT under the fork's license.
  Our `scripts/client-files.cjs` adapts the approach from [commit 30ead440bdafc6279acaed23c78b275203fc4e02](https://github.com/thmsndk/caracAL/commit/30ead440bdafc6279acaed23c78b275203fc4e02),
  “Derive client scripts from official HTML to survive new game.js helpers.”
  We added staged downloads, validation, and complete-cache fallback. Full fork notice: [licenses/caracal-thmsndk.txt](licenses/caracal-thmsndk.txt).
- **ALData**, copyright 2022 Kent Rasmussen, MIT. [Source and service documentation](https://github.com/earthiverse/ALData).
  Used as an external API; its server is not bundled. Full notice: [licenses/aldata.txt](licenses/aldata.txt).

Installed npm packages and the Debian/Node container base retain their included license and copyright files.
The image includes those notices; this project's MIT license does not replace dependency licenses.
Adventure Land game client files are downloaded from the official service into the user's persistent volume at runtime;
they are not included in the distributed image and are not relicensed by this repository.
