#!/usr/bin/env node

/* Passphrases | https://github.com/micahflee/passphrases
   Copyright (C) 2015 Micah Lee <micah@micahflee.com>

   Permission is hereby granted, free of charge, to any person obtaining a
   copy of this software and associated documentation files (the
   "Software"), to deal in the Software without restriction, including
   without limitation the rights to use, copy, modify, merge, publish,
   distribute, sublicense, and/or sell copies of the Software, and to
   permit persons to whom the Software is furnished to do so, subject to
   the following conditions:

   The above copyright notice and this permission notice shall be included
   in all copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
   OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
   IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
   CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
   TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
   SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

'use strict';

// Builds Passphrases for the platform this is run on, with no build
// dependencies beyond Node and the Electron already in node_modules:
//
//   node build.js             the app, in build/
//   node build.js --package   also installers and archives, in dist/
//
// The app is Electron's own distribution with src/ placed in resources/app.
// Packaging uses the platform's tools, and a missing tool skips that package:
//
//   Linux    tar, dpkg-deb, rpmbuild, appimagetool
//   macOS    ditto, codesign, hdiutil
//   Windows  tar, makensis, rcedit (sets the icon of Passphrases.exe)
//
// The architecture is that of the installed Electron. To build for another
// one, install Electron for it first: npm_config_arch=arm64 npm ci

const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

const ROOT = __dirname;
const BUILD = path.join(ROOT, 'build');
const DIST = path.join(ROOT, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const makePackages = process.argv.includes('--package');
// npm_config_arch is what made npm fetch Electron for another architecture
const arch = process.env.npm_config_arch || process.arch;

function run(command, args, options) {
  console.log('  ' + command + ' ' + args.join(' '));
  child_process.execFileSync(command, args, Object.assign({ stdio: 'inherit' }, options));
}

function have(command) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  return child_process.spawnSync(finder, [command], { stdio: 'ignore' }).status === 0;
}

function fillTemplate(source, destination, values) {
  let text = fs.readFileSync(source, 'utf8');
  for (const key of Object.keys(values)) {
    text = text.split('{{' + key + '}}').join(values[key]);
  }
  fs.writeFileSync(destination, text);
}

// Where the installed Electron keeps its distribution, and the resources
// directory inside a copy of it.
function electronDist() {
  const binary = require('electron');  // in Node this is the path to the binary
  if (process.platform === 'darwin') {
    // .../dist/Electron.app/Contents/MacOS/Electron
    return path.resolve(binary, '..', '..', '..', '..');
  }
  return path.dirname(binary);
}

// Put the app into an Electron resources directory.
function installApp(resources) {
  fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });
  const appDir = path.join(resources, 'app');
  fs.cpSync(path.join(ROOT, 'src'), appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
    name: pkg.name,
    productName: pkg.productName,
    version: version,
    description: pkg.description,
    license: pkg.license,
    main: 'main.js'
  }, null, 2) + '\n');
  fs.copyFileSync(path.join(ROOT, 'LICENSE.md'), path.join(appDir, 'LICENSE.md'));
}

function dirSizeKb(dir) {
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) bytes += dirSizeKb(full) * 1024;
    else if (entry.isFile()) bytes += fs.statSync(full).size;
  }
  return Math.ceil(bytes / 1024);
}

// Give a tree the permissions an installed system expects, whatever the
// umask was when it was copied: 755 for directories and programs, 644 for the
// rest.
function normalizeModes(dir) {
  fs.chmodSync(dir, 0o755);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) normalizeModes(full);
    else if (entry.isFile()) fs.chmodSync(full, fs.statSync(full).mode & 0o100 ? 0o755 : 0o644);
  }
}

// -------------------------------------------------------------------- Linux

function buildLinux() {
  const appDir = path.join(BUILD, 'Passphrases-linux-' + arch);
  console.log('Building ' + appDir);
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.cpSync(electronDist(), appDir, { recursive: true });
  fs.renameSync(path.join(appDir, 'electron'), path.join(appDir, 'passphrases'));
  installApp(path.join(appDir, 'resources'));
  if (!makePackages) return;

  // The files of an installed system, shared by the .deb and the .rpm.
  function stage(root) {
    fs.mkdirSync(path.join(root, 'opt'), { recursive: true });
    fs.cpSync(appDir, path.join(root, 'opt', 'Passphrases'), { recursive: true });
    fs.mkdirSync(path.join(root, 'usr', 'bin'), { recursive: true });
    fs.symlinkSync('../../opt/Passphrases/passphrases', path.join(root, 'usr', 'bin', 'passphrases'));
    const applications = path.join(root, 'usr', 'share', 'applications');
    fs.mkdirSync(applications, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'packaging', 'passphrases.desktop'),
      path.join(applications, 'passphrases.desktop'));
    for (const size of ['64', '256', '512']) {
      const icons = path.join(root, 'usr', 'share', 'icons', 'hicolor', size + 'x' + size, 'apps');
      fs.mkdirSync(icons, { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'packaging', 'passphrases-' + size + '.png'),
        path.join(icons, 'passphrases.png'));
    }
    normalizeModes(root);
    // Chromium's sandbox helper must be setuid root where user namespaces
    // are not available; the package tools record root as the owner.
    fs.chmodSync(path.join(root, 'opt', 'Passphrases', 'chrome-sandbox'), 0o4755);
  }

  // archive
  const archive = 'Passphrases-' + version + '-linux-' + arch + '.tar.gz';
  console.log('Packaging ' + archive);
  run('tar', ['-czf', path.join(DIST, archive), '-C', BUILD, path.basename(appDir)]);

  // .deb
  if (have('dpkg-deb')) {
    const debArch = { x64: 'amd64', arm64: 'arm64' }[arch] || arch;
    const name = 'passphrases_' + version + '-1_' + debArch;
    console.log('Packaging ' + name + '.deb');
    const root = path.join(DIST, name);
    stage(root);
    fs.mkdirSync(path.join(root, 'DEBIAN'));
    fillTemplate(path.join(ROOT, 'packaging', 'DEBIAN', 'control'),
      path.join(root, 'DEBIAN', 'control'),
      { version: version, arch: debArch, size: String(dirSizeKb(root)) });
    run('dpkg-deb', ['--root-owner-group', '--build', root, path.join(DIST, name + '.deb')]);
    fs.rmSync(root, { recursive: true, force: true });
  } else {
    console.log('Cannot find dpkg-deb, skipping the Debian package');
  }

  // AppImage
  const appimagetool = process.env.APPIMAGETOOL || (have('appimagetool') ? 'appimagetool' : null);
  if (appimagetool) {
    const imageArch = { x64: 'x86_64', arm64: 'aarch64' }[arch] || arch;
    const name = 'Passphrases-' + version + '-' + imageArch + '.AppImage';
    console.log('Packaging ' + name);
    const appImageDir = path.join(DIST, 'Passphrases.AppDir');
    fs.cpSync(appDir, appImageDir, { recursive: true });
    normalizeModes(appImageDir);
    fs.writeFileSync(path.join(appImageDir, 'AppRun'),
      '#!/bin/sh\nexec "$(dirname "$(readlink -f "$0")")/passphrases" "$@"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(appImageDir, 'passphrases.desktop'),
      fs.readFileSync(path.join(ROOT, 'packaging', 'passphrases.desktop'), 'utf8')
        .replace('Exec=/usr/bin/passphrases', 'Exec=passphrases'));
    fs.copyFileSync(path.join(ROOT, 'packaging', 'passphrases-256.png'),
      path.join(appImageDir, 'passphrases.png'));
    fs.copyFileSync(path.join(ROOT, 'packaging', 'passphrases-256.png'),
      path.join(appImageDir, '.DirIcon'));
    // APPIMAGE_EXTRACT_AND_RUN lets appimagetool, itself an AppImage, run
    // where FUSE is not available
    run(appimagetool, [appImageDir, path.join(DIST, name)],
      { env: Object.assign({}, process.env, { ARCH: imageArch, APPIMAGE_EXTRACT_AND_RUN: '1' }) });
    fs.rmSync(appImageDir, { recursive: true, force: true });
  } else {
    console.log('Cannot find appimagetool, skipping the AppImage');
  }

  // .rpm
  if (have('rpmbuild')) {
    const rpmArch = { x64: 'x86_64', arm64: 'aarch64' }[arch] || arch;
    console.log('Packaging passphrases-' + version + ' rpm');
    const top = path.join(DIST, 'rpmbuild');
    const sourceName = 'passphrases-' + version;
    for (const dir of ['BUILD', 'RPMS', 'SOURCES', 'SPECS', 'SRPMS']) {
      fs.mkdirSync(path.join(top, dir), { recursive: true });
    }
    stage(path.join(top, sourceName));
    run('tar', ['-czf', path.join(top, 'SOURCES', sourceName + '.tar.gz'), '-C', top, sourceName]);
    fillTemplate(path.join(ROOT, 'packaging', 'SPECS', 'passphrases.spec'),
      path.join(top, 'SPECS', 'passphrases.spec'), { version: version, arch: rpmArch });
    run('rpmbuild', ['--define', '_topdir ' + top, '-bb', path.join(top, 'SPECS', 'passphrases.spec')]);
    for (const file of fs.readdirSync(path.join(top, 'RPMS', rpmArch))) {
      fs.copyFileSync(path.join(top, 'RPMS', rpmArch, file), path.join(DIST, file));
    }
    fs.rmSync(top, { recursive: true, force: true });
  } else {
    console.log('Cannot find rpmbuild, skipping the Red Hat package');
  }
}

// -------------------------------------------------------------------- macOS

function buildMac() {
  const outDir = path.join(BUILD, 'Passphrases-darwin-' + arch);
  const appBundle = path.join(outDir, 'Passphrases.app');
  console.log('Building ' + appBundle);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  // ditto keeps the symlinks inside the frameworks intact
  run('ditto', [path.join(electronDist(), 'Electron.app'), appBundle]);

  const contents = path.join(appBundle, 'Contents');
  installApp(path.join(contents, 'Resources'));
  fs.copyFileSync(path.join(ROOT, 'packaging', 'icon.icns'),
    path.join(contents, 'Resources', 'electron.icns'));

  // plutil adds a key or replaces it
  const plist = path.join(contents, 'Info.plist');
  const set = (key, value) => run('plutil', ['-replace', key, '-string', value, plist]);
  set('CFBundleName', 'Passphrases');
  set('CFBundleDisplayName', 'Passphrases');
  set('CFBundleIdentifier', 'com.passphrases.app');
  set('CFBundleShortVersionString', version);
  set('CFBundleVersion', version);

  // Changing the bundle breaks Electron's own signature, and Apple silicon
  // refuses to run code whose signature is broken. An ad-hoc signature ("-")
  // needs no certificate and makes the app runnable. It is not a Developer ID
  // signature: Gatekeeper still warns about apps downloaded from the
  // Internet until the app is signed and notarized; see BUILD.md.
  run('codesign', ['--force', '--deep', '--sign', '-', appBundle]);

  if (!makePackages) return;

  const base = 'Passphrases-' + version + '-mac-' + arch;
  console.log('Packaging ' + base + '.zip');
  run('ditto', ['-c', '-k', '--keepParent', appBundle, path.join(DIST, base + '.zip')]);
  console.log('Packaging ' + base + '.dmg');
  run('hdiutil', ['create', '-volname', 'Passphrases', '-srcfolder', outDir,
    '-ov', '-format', 'UDZO', path.join(DIST, base + '.dmg')]);
}

// ------------------------------------------------------------------ Windows

function buildWindows() {
  const appDir = path.join(BUILD, 'Passphrases-win32-' + arch);
  console.log('Building ' + appDir);
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.cpSync(electronDist(), appDir, { recursive: true });
  fs.renameSync(path.join(appDir, 'electron.exe'), path.join(appDir, 'Passphrases.exe'));
  installApp(path.join(appDir, 'resources'));
  fs.copyFileSync(path.join(ROOT, 'packaging', 'icon.ico'), path.join(appDir, 'icon.ico'));

  // rcedit rewrites the icon and version details stored inside the .exe
  const exe = path.join(appDir, 'Passphrases.exe');
  if (have('rcedit')) {
    run('rcedit', [exe,
      '--set-icon', path.join(ROOT, 'packaging', 'icon.ico'),
      '--set-file-version', version,
      '--set-product-version', version,
      '--set-version-string', 'ProductName', 'Passphrases',
      '--set-version-string', 'FileDescription', 'Passphrases',
      '--set-version-string', 'CompanyName', 'Passphrases',
      '--set-version-string', 'LegalCopyright', 'MIT license',
      '--set-version-string', 'OriginalFilename', 'Passphrases.exe']);
  } else {
    console.log('Cannot find rcedit, Passphrases.exe keeps the Electron icon');
  }

  if (!makePackages) return;

  // Electron no longer ships a 32-bit Windows build, so there is no win32
  const label = { x64: 'win64' }[arch] || 'win-' + arch;
  const base = 'Passphrases-' + version + '-' + label;

  // portable copy: unzip and run
  console.log('Packaging ' + base + '.zip');
  // Windows' own tar writes zip files; the tar that comes with Git does not
  run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'),
    ['-a', '-c', '-f', path.join(DIST, base + '.zip'), '-C', BUILD, path.basename(appDir)]);

  // Neither Passphrases.exe nor the installer is signed here; see BUILD.md.
  if (have('makensis')) {
    console.log('Packaging ' + base + '-Setup.exe');
    run('makensis', [
      '/DVERSION=' + version,
      '/DBINPATH=' + appDir,
      '/DOUTFILE=' + path.join(DIST, base + '-Setup.exe'),
      '/DINSTALLSIZE=' + dirSizeKb(appDir),
      path.join(ROOT, 'packaging', 'windows_installer.nsi')
    ]);
  } else {
    console.log('Cannot find makensis, skipping the installer');
  }
}

// --------------------------------------------------------------------- main

fs.mkdirSync(BUILD, { recursive: true });
if (makePackages) {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
}

if (process.platform === 'linux') {
  buildLinux();
} else if (process.platform === 'darwin') {
  buildMac();
} else if (process.platform === 'win32') {
  buildWindows();
} else {
  console.error('Error: unrecognized platform ' + process.platform);
  process.exit(1);
}
console.log('Done.');
