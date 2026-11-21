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

// color styles, defined in css/themes.css; "classic" is the stylesheet default
var colorStyles = [
  { id: 'classic', name: 'Classic' },
  { id: 'solarized-light', name: 'Solarized Light' },
  { id: 'solarized-dark', name: 'Solarized Dark' },
  { id: 'nord', name: 'Nord' },
  { id: 'gruvbox-light', name: 'Gruvbox Light' },
  { id: 'gruvbox-dark', name: 'Gruvbox Dark' },
  { id: 'dracula', name: 'Dracula' },
  { id: 'zenburn', name: 'Zenburn' },
  { id: 'solarized-light-low', name: 'Solarized Light (low contrast)' },
  { id: 'solarized-dark-low', name: 'Solarized Dark (low contrast)' },
  { id: 'nord-low', name: 'Nord (low contrast)' },
  { id: 'gruvbox-light-low', name: 'Gruvbox Light (low contrast)' },
  { id: 'gruvbox-dark-low', name: 'Gruvbox Dark (low contrast)' },
  { id: 'zenburn-low', name: 'Zenburn (low contrast)' }
];

function applyColorStyle(id) {
  document.documentElement.setAttribute('data-theme', id);
}

document.addEventListener('DOMContentLoaded', function(){
  var sound = el('.enable-sound'),
    colorStyle = el('.color-style');

  colorStyles.forEach(function(style){
    colorStyle.add(new Option(style.name, style.id));
  });

  Passphrases.ready.then(function(){
    // check the box if sound is enabled
    sound.checked = Passphrases.prefs['sound'];

    // show the saved color style, or classic if it is not one we know
    var known = colorStyles.some(function(style){ return style.id == Passphrases.prefs['theme']; });
    var theme = known ? Passphrases.prefs['theme'] : 'classic';
    colorStyle.value = theme;
    applyColorStyle(theme);
  });

  // toggling sound updates settings
  sound.addEventListener('change', function(){
    Passphrases.prefs['sound'] = sound.checked;
    Passphrases.savePrefs();
  });

  // choosing a color style applies and saves it
  colorStyle.addEventListener('change', function(){
    Passphrases.prefs['theme'] = colorStyle.value;
    applyColorStyle(Passphrases.prefs['theme']);
    Passphrases.savePrefs();
  });
});
