#!/usr/bin/env node
// Empaquette extension/ en .vsix — un zip au format attendu par VS Code et Cursor — sans dépendance :
// ni vsce, ni zip système.
//
//   node extension/empaqueter.mjs                   → extension/contextree.vsix
//   node extension/empaqueter.mjs --sortie X.vsix
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const FICHIERS = ['package.json', 'extension.js', 'arbre.js', 'README.md'];
const args = process.argv.slice(2);
const i = args.indexOf('--sortie');
const sortie = resolve(i >= 0 ? args[i + 1] : join(ici, 'contextree.vsix'));

const pkg = JSON.parse(readFileSync(join(ici, 'package.json'), 'utf8'));
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const manifeste = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(pkg.name)}" Version="${xml(pkg.version)}" Publisher="${xml(pkg.publisher)}" />
    <DisplayName>${xml(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(pkg.description)}</Description>
    <Categories>${xml(pkg.categories.join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(pkg.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
`;

const types = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>
`;

// --- zip : en-têtes locaux, répertoire central, fin — date fixe, pour un paquet reproductible ---

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const DATE_DOS = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const UTF8 = 0x0800;

function zip(entrees) {
  const locaux = [];
  const central = [];
  let decalage = 0;
  for (const { nom, donnees } of entrees) {
    const n = Buffer.from(nom, 'utf8');
    const comprime = deflateRawSync(donnees);
    const crc = crc32(donnees);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DATE_DOS, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprime.length, 18);
    local.writeUInt32LE(donnees.length, 22);
    local.writeUInt16LE(n.length, 26);
    local.writeUInt16LE(0, 28);
    locaux.push(local, n, comprime);

    const entete = Buffer.alloc(46);
    entete.writeUInt32LE(0x02014b50, 0);
    entete.writeUInt16LE(20, 4);
    entete.writeUInt16LE(20, 6);
    entete.writeUInt16LE(UTF8, 8);
    entete.writeUInt16LE(8, 10);
    entete.writeUInt16LE(0, 12);
    entete.writeUInt16LE(DATE_DOS, 14);
    entete.writeUInt32LE(crc, 16);
    entete.writeUInt32LE(comprime.length, 20);
    entete.writeUInt32LE(donnees.length, 24);
    entete.writeUInt16LE(n.length, 28);
    entete.writeUInt32LE(decalage, 42);
    central.push(entete, n);
    decalage += local.length + n.length + comprime.length;
  }
  const repertoire = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entrees.length, 8);
  fin.writeUInt16LE(entrees.length, 10);
  fin.writeUInt32LE(repertoire.length, 12);
  fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, repertoire, fin]);
}

writeFileSync(
  sortie,
  zip([
    { nom: '[Content_Types].xml', donnees: Buffer.from(types) },
    { nom: 'extension.vsixmanifest', donnees: Buffer.from(manifeste) },
    ...FICHIERS.map((f) => ({ nom: `extension/${f}`, donnees: readFileSync(join(ici, f)) })),
  ]),
);
console.log(sortie);
