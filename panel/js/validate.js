var DCValidate = (function () {
  'use strict';
  var INVALID_CHARS = /[<>:"/\\|?*\x00-\x1F]/;
  var RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  var MAX_NAME_LENGTH = 200;

  function validateName(name, fieldName) {
    if (!name || !String(name).trim()) {
      return { valid: false, error: fieldName + ' cannot be empty.' };
    }
    name = String(name).trim();
    if (name.length > MAX_NAME_LENGTH) {
      return { valid: false, error: fieldName + ' is too long (max ' + MAX_NAME_LENGTH + ' characters).' };
    }
    if (INVALID_CHARS.test(name)) {
      return { valid: false, error: fieldName + ' contains invalid characters (< > : " / \\ | ? *).' };
    }
    if (RESERVED_NAMES.test(name)) {
      return { valid: false, error: fieldName + ' uses a reserved system name.' };
    }
    return { valid: true, name: name };
  }

  return { validateName: validateName, MAX_NAME_LENGTH: MAX_NAME_LENGTH };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = DCValidate; }
