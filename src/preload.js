'use strict';

// Runs in the page's sandbox before index.html loads. It gives the page a
// small, fixed set of calls into the main process and nothing else.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('passphrasesApp', {
  // resolves to the list of wordlists from wordlists/manifest.json
  getWordlists: function () {
    return ipcRenderer.invoke('wordlists:list');
  },
  // resolves to the text of one wordlist, one word per line
  readWordlist: function (id) {
    return ipcRenderer.invoke('wordlists:read', id);
  },
  loadPrefs: function () {
    return ipcRenderer.invoke('prefs:load');
  },
  savePrefs: function (prefs) {
    return ipcRenderer.invoke('prefs:save', {
      sound: !!(prefs && prefs.sound),
      theme: String(prefs && prefs.theme)
    });
  },
  focusWindow: function () {
    ipcRenderer.send('window:focus');
  }
});
