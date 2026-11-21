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

// The main process. The page in index.html runs sandboxed with no access to
// Node; everything it needs from the system goes through the handlers below.

const { app, BrowserWindow, Menu, ipcMain, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const WORDLISTS_DIR = path.join(__dirname, 'wordlists');

let mainWindow = null;

// ---------------------------------------------------------------- wordlists

let wordlists = null;

function getWordlists() {
  if (!wordlists) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(WORDLISTS_DIR, 'manifest.json'), 'utf8'));
    wordlists = manifest.lists;
  }
  return wordlists;
}

// The page names a wordlist by id. The file name always comes from the
// manifest, never from the page.
function readWordlist(id) {
  const entry = getWordlists().find((list) => list.id === id);
  if (!entry) {
    throw new Error('Unknown wordlist: ' + id);
  }
  return fs.promises.readFile(path.join(WORDLISTS_DIR, entry.file), 'utf8');
}

// -------------------------------------------------------------- preferences

function prefsFile() {
  return path.join(app.getPath('userData'), 'passphrases.conf');
}

// Keep only what the app understands, whatever the file or the page holds.
function cleanPrefs(prefs) {
  const theme = prefs && typeof prefs.theme === 'string' &&
    /^[a-z-]{1,40}$/.test(prefs.theme) ? prefs.theme : 'classic';
  return { sound: !(prefs && prefs.sound === false), theme: theme };
}

function loadPrefs() {
  try {
    return cleanPrefs(JSON.parse(fs.readFileSync(prefsFile(), 'utf8')));
  } catch (e) {
    return cleanPrefs(null);
  }
}

function savePrefs(prefs) {
  fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
  fs.writeFileSync(prefsFile(), JSON.stringify(cleanPrefs(prefs)));
}

// ------------------------------------------------------------------- window

function openInBrowser(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return;
  }
  if (parsed.protocol === 'https:') {
    shell.openExternal(parsed.href);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 680,
    height: 480,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Passphrases',
    icon: path.join(__dirname, 'images', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // passphrases are typed into text fields; keep them away from the
      // spellchecker
      spellcheck: false
    }
  });

  // the page never navigates and never opens windows; links go to the browser
  mainWindow.webContents.setWindowOpenHandler(function (details) {
    openInBrowser(details.url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', function (event, url) {
    event.preventDefault();
    openInBrowser(url);
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function setMenu() {
  if (process.platform === 'darwin') {
    // make shortcut keys like Cmd-Q, Cmd-C and Cmd-V work in macOS (#4)
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' }
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

// ---------------------------------------------------------------------- app

ipcMain.handle('wordlists:list', function () {
  return getWordlists();
});
ipcMain.handle('wordlists:read', function (event, id) {
  return readWordlist(String(id));
});
ipcMain.handle('prefs:load', function () {
  return loadPrefs();
});
ipcMain.handle('prefs:save', function (event, prefs) {
  savePrefs(prefs);
});
ipcMain.on('window:focus', function () {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// every page this app could ever load runs sandboxed
app.enableSandbox();

// Windows shows notifications only for apps with an application id
app.setAppUserModelId('com.passphrases.app');

app.whenReady().then(function () {
  // the page shows notifications and needs no other permission
  session.defaultSession.setPermissionRequestHandler(function (webContents, permission, callback) {
    callback(permission === 'notifications');
  });

  setMenu();
  createWindow();
});

// A passphrase being memorized lives only in the window, so closing the
// window ends the app on every platform.
app.on('window-all-closed', function () {
  app.quit();
});
