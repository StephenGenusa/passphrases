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

// Shared by the other scripts. The page has no access to Node; what it needs
// from the system comes through window.passphrasesApp, set up in preload.js.
var Passphrases = {};

// the passphrase on the Generate tab; empty when there is none
Passphrases.currentPassphrase = '';

// the one element matching a CSS selector
function el(selector) {
  return document.querySelector(selector);
}
// show or hide it
function setVisible(selector, visible) {
  el(selector).hidden = !visible;
}

// load sound effects
var soundEffects = {
  'generate': new Audio("sounds/dice.ogg"),
  'success': new Audio("sounds/success.ogg"),
  'notification': new Audio("sounds/notification.ogg"),
};
Passphrases.playSound = function(sound) {
  if(Passphrases.prefs['sound']) {
    // play() fails when there is no audio device; that is not an error here
    soundEffects[sound].play().catch(function(){});
  }
}

// notifications
Passphrases.notify = function(message) {
  var options = {
    icon: 'images/icon.png',
    body: message
  };

  var notification = new Notification("Passphrases", options);
  notification.onclick = function () {
    window.passphrasesApp.focusWindow();
  }
  notification.onshow = function () {
    // auto close after 3 seconds
    setTimeout(function() {notification.close();}, 3000);
  }
}

// default preferences, replaced by the saved ones once they are read
Passphrases.prefs = {
  sound: true,
  theme: 'classic'
};
Passphrases.savePrefs = function() {
  return window.passphrasesApp.savePrefs(Passphrases.prefs);
}

// resolves when the saved preferences have been read
Passphrases.ready = window.passphrasesApp.loadPrefs().then(function(prefs){
  Passphrases.prefs = prefs;
});
