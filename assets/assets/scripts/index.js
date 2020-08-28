(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
function _interopRequireDefault(obj) {
  return obj && obj.__esModule ? obj : {
    "default": obj
  };
}

module.exports = _interopRequireDefault;
},{}],2:[function(require,module,exports){
"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

var _menuToggle = _interopRequireDefault(require("./menuToggle"));

(0, _menuToggle.default)();

},{"./menuToggle":3,"@babel/runtime/helpers/interopRequireDefault":1}],3:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = watchMainMenu;

function watchMainMenu() {
  var button = document.querySelector('.js-menu-toggle');
  var menu = document.querySelector('.js-menu-area');

  if (button && menu) {
    button.addEventListener('click', function () {
      button.classList.toggle('is-active');
      menu.classList.toggle('is-active');
    });
  }
}

},{}]},{},[2]);
