'use strict';

window.jQuery = window.$ = require('jquery');
window.moment = require('moment');
window.store = require('store');
window.Spinner = require('spin');
window.RippleAPI = require('ripple-lib').RippleAPI;
window.OrderBook = require('ripple-lib-orderbook').OrderBook;
window.IOUValue = require('ripple-lib-value').IOUValue;
window.XRPValue = require('ripple-lib-value').XRPValue;
window.deprecated = require('../deprecated');
window.RippleAddressCodec = require('ripple-address-codec');
window.RippleBinaryCodec = require('ripple-binary-codec');
window._ = require('lodash');
window.sjcl = require('sjcl');
require('../../../deps/sjcl-custom');

require('angular');
require('angular-route');
require('angular-messages');
require('angular-ui-bootstrap');
require('ng-sortable/dist/ng-sortable');
require('bootstrap');
