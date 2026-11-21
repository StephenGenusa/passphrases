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

document.addEventListener('DOMContentLoaded', function(){
  var tabs = ['generate', 'lists', 'memorize', 'about'];

  function showTab(name) {
    tabs.forEach(function(tab){
      el('.tab-' + tab).classList.toggle('active', tab == name);
      el('.content-' + tab).classList.toggle('active', tab == name);
    });

    if(name == 'memorize') {
      if(!el('.memorize-input').hidden) {
        el('.passphrase-to-memorize').focus();
      } else {
        el('.passphrase-test').focus();
      }
    }
  }

  tabs.forEach(function(tab){
    el('.tab-' + tab).addEventListener('click', function(){
      if(!this.classList.contains('active')) showTab(tab);
    });
  });

  // let the outside world switch tabs
  Passphrases.showTab = showTab;
  Passphrases.tabMemorize = function(){
    showTab('memorize');
  };

  // start with generate
  showTab('generate');
});
