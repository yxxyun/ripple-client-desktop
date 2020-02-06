'use strict';
const assert = require('assert');
const utils = require('./utils');
const Float = require('./ieee754').Float;
const BN = require('bn.js');

//
// Currency support
//

function Currency() {
  // Internal form: 0 = XRP. 3 letter-code.
  // XXX Internal should be 0 or hex with three letter annotation when valid.

  // Json form:
  //  '', 'XRP', '0': 0
  //  3-letter code: ...
  // XXX Should support hex, C++ doesn't currently allow it.

  this._value = NaN;
  this._update();
}

Currency.width = 20;
Currency.HEX_CURRENCY_BAD = '0000000000000000000000005852500000000000';
Currency.HEX_ZERO = '0000000000000000000000000000000000000000';
Currency.HEX_ONE = '0000000000000000000000000000000000000001';

/**
 * Tries to correctly interpret a Currency as entered by a user.
 *
 * Examples:
 *
 *  USD                               => currency
 *  USD - Dollar                      => currency with optional full currency
 *                                       name
 *  XAU (-0.5%pa)                     => XAU with 0.5% effective demurrage rate
 *                                       per year
 *  XAU - Gold (-0.5%pa)              => Optionally allowed full currency name
 *  USD (1%pa)                        => US dollars with 1% effective interest
 *                                       per year
 *  INR - Indian Rupees               => Optional full currency name with spaces
 *  TYX - 30-Year Treasuries          => Optional full currency with numbers
 *                                       and a dash
 *  TYX - 30-Year Treasuries (1.5%pa) => Optional full currency with numbers,
 *                                       dash and interest rate
 *
 *  The regular expression below matches above cases, broken down for better
 *  understanding:
 *
 *  ^\s*                      // start with any amount of whitespace
 *  ([a-zA-Z]{3}|[0-9]{3})    // either 3 letter alphabetic currency-code or 3
 *                               digit numeric currency-code. See ISO 4217
 *  (\s*-\s*[- \w]+)          // optional full currency name following the dash
 *                               after currency code, full currency code can
 *                               contain letters, numbers and dashes
 *  (\s*\(-?\d+\.?\d*%pa\))?  // optional demurrage rate, has optional - and
 *                               . notation (-0.5%pa)
 *  \s*$                      // end with any amount of whitespace
 *
 */

/* eslint-disable max-len*/
Currency.prototype.human_RE = /^\s*([a-zA-Z0-9\<\>\(\)\{\}\[\]\|\?\!\@\#\$\%\^\&]{3})(\s*-\s*[- \w]+)?(\s*\(-?\d+\.?\d*%pa\))?\s*$/;
/* eslint-enable max-len*/

Currency.from_json = function(j, shouldInterpretXrpAsIou) {
  return (new Currency()).parse_json(j, shouldInterpretXrpAsIou);
};

Currency.from_hex = function(j) {
  if (j instanceof this) {
    return j.clone();
  }

  return (new this()).parse_hex(j);
};

Currency.from_bytes = function(j) {
  if (j instanceof this) {
    return j.clone();
  }

  return (new this()).parse_bytes(j);
};

Currency.prototype.to_hex = function() {
  if (!this.is_valid()) {
    return null;
  }

  return utils.arrayToHex(this.to_bytes());
};

Currency.from_human = function(j, opts) {
  return (new Currency().parse_human(j, opts));
};

Currency.json_rewrite = function(j, opts) {
  return this.from_json(j).to_json(opts);
};

Currency.prototype.clone = function() {
  return this.copyTo(new this.constructor());
};

Currency.prototype.equals = function(o) {
  return this.is_valid() &&
         o.is_valid() &&
         // This throws but the expression will short circuit
         this.cmp(o) === 0;
};

Currency.prototype.cmp = function(o) {
  assert(this.is_valid() && o.is_valid());
  return this._value.cmp(o._value);
};

// this._value = NaN on error.
Currency.prototype.parse_json = function(j, shouldInterpretXrpAsIou) {
  this._value = NaN;

  if (j instanceof Currency) {
    this._value = j._value;
    this._update();
    return this;
  }

  switch (typeof j) {
    case 'number':
      if (!isNaN(j)) {
        this.parse_number(j);
      }
      break;
    case 'string':
      if (!j || j === '0') {
        // Empty string or XRP
        this.parse_hex(shouldInterpretXrpAsIou
          ? Currency.HEX_CURRENCY_BAD
          : Currency.HEX_ZERO);
        break;
      }

      if (j === '1') {
        // 'no currency'
        this.parse_hex(Currency.HEX_ONE);
        break;
      }

      if (/^[A-F0-9]{40}$/.test(j)) {
        // Hex format
        this.parse_hex(j);
        break;
      }

      // match the given string to see if it's in an allowed format
      const matches = j.match(this.human_RE);

      if (matches) {
        let currencyCode = matches[1];

        // for the currency 'XRP' case
        // we drop everything else that could have been provided
        // e.g. 'XRP - Ripple'
        if (!currencyCode || /^(0|XRP)$/.test(currencyCode)) {
          this.parse_hex(shouldInterpretXrpAsIou
            ? Currency.HEX_CURRENCY_BAD
            : Currency.HEX_ZERO);

          // early break, we can't have interest on XRP
          break;
        }

        // the full currency is matched as it is part of the valid currency
        // format, but not stored
        // var full_currency = matches[2] || '';
        const interest = matches[3] || '';

        // interest is defined as interest per year, per annum (pa)
        let percentage = interest.match(/(-?\d+\.?\d+)/);

        currencyCode = currencyCode.toUpperCase();

        const currencyData = utils.arraySet(20, 0);

        if (percentage) {
          /*
           * 20 byte layout of a interest bearing currency
           *
           * 01 __ __ __ __ __ __ __ __ __ __ __ __ __ __ __ __ __ __ __
           *    CURCODE- DATE------- RATE------------------- RESERVED---
           */

          // byte 1 for type, use '1' to denote demurrage currency
          currencyData[0] = 1;

          // byte 2-4 for currency code
          currencyData[1] = currencyCode.charCodeAt(0) & 0xff;
          currencyData[2] = currencyCode.charCodeAt(1) & 0xff;
          currencyData[3] = currencyCode.charCodeAt(2) & 0xff;

          // byte 5-8 are for reference date, but should always be 0 so we
          // won't fill it

          // byte 9-16 are for the interest
          percentage = parseFloat(percentage[0]);

          // the interest or demurrage is expressed as a yearly (per annum)
          // value
          const secondsPerYear = 31536000; // 60 * 60 * 24 * 365

          // Calculating the interest e-fold
          // 0.5% demurrage is expressed 0.995, 0.005 less than 1
          // 0.5% interest is expressed as 1.005, 0.005 more than 1
          const interestEfold = secondsPerYear / Math.log(1 + percentage / 100);
          const bytes = Float.toIEEE754Double(interestEfold);

          for (let i = 0; i <= bytes.length; i++) {
            currencyData[8 + i] = bytes[i] & 0xff;
          }

          // the last 4 bytes are reserved for future use, so we won't fill
          // those

        } else {
          currencyData[12] = currencyCode.charCodeAt(0) & 0xff;
          currencyData[13] = currencyCode.charCodeAt(1) & 0xff;
          currencyData[14] = currencyCode.charCodeAt(2) & 0xff;
        }

        this.parse_bytes(currencyData);
      }
      break;
  }

  return this;
};

Currency.prototype.parse_human = function(j) {
  return this.parse_json(j);
};

Currency.prototype.is_valid = function() {
  return this._value instanceof BN;
};

Currency.prototype.parse_number = function(j) {
  this._value = NaN;

  if (typeof j === 'number' && isFinite(j) && j >= 0) {
    this._value = new BN(j);
  }

  this._update();
  return this;
};

Currency.prototype.parse_hex = function(j) {
  if (new RegExp(`^[0-9A-Fa-f]{${this.constructor.width * 2}}$`).test(j)) {
    this._value = new BN(j, 16);
  } else {
    this._value = NaN;
  }

  this._update();
  return this;
};

Currency.prototype.to_bytes = function() {
  if (!this.is_valid()) {
    return null;
  }

  return this._value.toArray('be', this.constructor.width);
};

/**
 * Recalculate internal representation.
 *
 * You should never need to call this.
 */

Currency.prototype._update = function() {
  const bytes = this.to_bytes();

  // is it 0 everywhere except 12, 13, 14?
  let isZeroExceptInStandardPositions = true;

  if (!bytes) {
    return;
  }

  this._native = false;
  this._type = -1;
  this._interest_start = NaN;
  this._interest_period = NaN;
  this._iso_code = '';

  for (let i = 0; i < 20; i++) {
    isZeroExceptInStandardPositions = isZeroExceptInStandardPositions
    && (i === 12 || i === 13 || i === 14 || bytes[i] === 0);
  }

  if (isZeroExceptInStandardPositions) {
    this._iso_code = String.fromCharCode(bytes[12])
                   + String.fromCharCode(bytes[13])
                   + String.fromCharCode(bytes[14]);

    if (this._iso_code === '\u0000\u0000\u0000') {
      this._native = true;
      this._iso_code = 'XRP';
    }

    this._type = 0;
  } else if (bytes[0] === 0x01) { // Demurrage currency
    this._iso_code = String.fromCharCode(bytes[1])
                   + String.fromCharCode(bytes[2])
                   + String.fromCharCode(bytes[3]);

    this._type = 1;
    this._interest_start = (bytes[4] << 24) +
                           (bytes[5] << 16) +
                           (bytes[6] << 8) +
                           (bytes[7]);
    this._interest_period = Float.fromIEEE754Double(bytes.slice(8, 16));
  }
};

/**
 * Returns copy.
 *
 * This copies code from UInt.copyTo so we do not call _update,
 * bvecause to_bytes is very expensive.
 */

Currency.prototype.copyTo = function(d) {
  d._value = this._value;

  if (this._version_byte !== undefined) {
    d._version_byte = this._version_byte;
  }

  if (!d.is_valid()) {
    return d;
  }

  d._native = this._native;
  d._type = this._type;
  d._interest_start = this._interest_start;
  d._interest_period = this._interest_period;
  d._iso_code = this._iso_code;

  return d;
};

Currency.prototype.parse_bytes = function(j) {
  if (Array.isArray(j) && j.length === this.constructor.width) {
    this._value = new BN(j);
  } else {
    this._value = NaN;
  }

  this._update();
  return this;
};

// XXX Probably not needed anymore?
/*
Currency.prototype.parse_bytes = function(byte_array) {
  if (Array.isArray(byte_array) && byte_array.length === 20) {
    var result;
    // is it 0 everywhere except 12, 13, 14?
    var isZeroExceptInStandardPositions = true;

    for (var i=0; i<20; i++) {
      isZeroExceptInStandardPositions = isZeroExceptInStandardPositions
      && (i===12 || i===13 || i===14 || byte_array[0]===0)
    }

    if (isZeroExceptInStandardPositions) {
      var currencyCode = String.fromCharCode(byte_array[12])
      + String.fromCharCode(byte_array[13])
      + String.fromCharCode(byte_array[14]);
      if (/^[A-Z0-9]{3}$/.test(currencyCode) && currencyCode !== 'XRP' ) {
        this._value = currencyCode;
      } else if (currencyCode === '\0\0\0') {
        this._value = 0;
      } else {
        this._value = NaN;
      }
    } else {
      // XXX Should support non-standard currency codes
      this._value = NaN;
    }
  } else {
    this._value = NaN;
  }
  return this;
};
*/

Currency.prototype.is_native = function() {
  return this._native;
};

/**
 * @return {Boolean} whether this currency is an interest-bearing currency
 */

Currency.prototype.has_interest = function() {
  return this._type === 1
  && !isNaN(this._interest_start)
  && !isNaN(this._interest_period);
};

/**
 *
 * @param {number} referenceDate_ number of seconds since the Ripple Epoch
 * (0:00 on January 1, 2000 UTC) used to calculate the
 * interest over provided interval pass in one years
 * worth of seconds to ge the yearly interest
 * @returns {number} interest for provided interval, can be negative for
 * demurred currencies
 */
Currency.prototype.get_interest_at = function(referenceDate_) {
  if (!this.has_interest()) {
    return 0;
  }

  let referenceDate = referenceDate_;

  // use one year as a default period
  if (!referenceDate) {
    referenceDate = this._interest_start + 3600 * 24 * 365;
  }

  if (referenceDate instanceof Date) {
    referenceDate = utils.fromTimestamp(referenceDate.getTime());
  }

  // calculate interest by e-fold number
  return Math.exp((referenceDate - this._interest_start)
                / this._interest_period);
};

Currency.prototype.get_interest_percentage_at = function(referenceDate,
  decimals
) {
  let interest = this.get_interest_at(referenceDate, decimals);

  // convert to percentage
  interest = (interest * 100) - 100;
  const decimalMultiplier = decimals ? Math.pow(10, decimals) : 100;

  // round to two decimals behind the dot
  return Math.round(interest * decimalMultiplier) / decimalMultiplier;
};

// XXX Currently we inherit UInt.prototype.is_valid, which is mostly fine.
//
//     We could be doing further checks into the internal format of the
//     currency data, since there are some values that are invalid.
//
// Currency.prototype.is_valid = function() {
//  return UInt.prototype.is_valid() && ...;
// };

Currency.prototype.to_json = function(opts = {}) {
  if (!this.is_valid()) {
    // XXX This is backwards compatible behavior, but probably not very good.
    return 'XRP';
  }

  let currency;
  const fullName = opts && opts.full_name ? ' - ' + opts.full_name : '';
  opts.show_interest = opts.show_interest !== undefined
  ? opts.show_interest
  : this.has_interest();

  if (!opts.force_hex && /^[A-Z0-9]{3}$/.test(this._iso_code)) {
    currency = this._iso_code + fullName;
    if (opts.show_interest) {
      const decimals = !isNaN(opts.decimals) ? opts.decimals : undefined;
      const interestPercentage = this.has_interest()
      ? this.get_interest_percentage_at(
          this._interest_start + 3600 * 24 * 365, decimals
        )
      : 0;
      currency += ' (' + interestPercentage + '%pa)';
    }

  } else {
    // Fallback to returning the raw currency hex
    currency = this.to_hex();

    // XXX This is to maintain backwards compatibility, but it is very, very
    // odd behavior, so we should deprecate it and get rid of it as soon as
    //  possible.
    if (currency === Currency.HEX_ONE) {
      currency = 1;
    }
  }

  return currency;
};

Currency.prototype.to_human = function(opts) {
  // to_human() will always print the human-readable currency code if available.
  return this.to_json(opts);
};

Currency.prototype.get_iso = function() {
  return this._iso_code;
};

Currency.is_valid = function(j) {
  return this.from_json(j).is_valid();
};

exports.Currency = Currency;
